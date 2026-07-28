/**
 * RecoveryService — intake (direct instruction, external, and the idempotent M16 enforcement referral), debtor
 * parties, strategy selection, assignment, the full 29-state recovery lifecycle, closure (rule-gated), reopening
 * and archival. Every mutating method enforces its permission (default deny), runs inside `db.withTenant`, records
 * audit + a recovery.lifecycle outbox event in the SAME transaction, appends status/assignment history, and is
 * optimistic-lock guarded. Lifecycle transitions go through the PURE `checkRecoveryTransition` choke point.
 * Confidential/privileged recoveries are redacted on read unless the caller holds `recovery.confidential.read`
 * (ADR-072). The M16 enforcement referral is idempotent (one recovery per referral key); m17 NEVER reads m16/m14
 * tables — the proceeding/matter ids are opaque references carried across a governed inbound contract. ALL amounts
 * are REFERENCES only — no cash application, ledger posting, or accounting write-off (ADR-071).
 */
import { randomUUID } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { RecoveryLifecycleEventType } from '@finapp/contracts';
import { M17_PERMISSIONS } from './permissions.ts';
import { M17_AUDIT_CODES } from './audit-codes.ts';
import { checkRecoveryTransition, isRecoveryTerminal } from './domain/lifecycles.ts';
import {
  isConfidentiality,
  isPriority,
  isRecoveryRisk,
  isPartyRole,
  isRecoveryStrategy,
  RECOVERY_LIMITS,
} from './domain/limits.ts';
import { evaluateClosure, type ClosureCriteria } from './domain/closure.ts';
import { formatRecoveryNumber } from './recovery-number.ts';
import { RecoveryRepository, type RecoveryRow, type PartyRow, type StrategyRow } from './repository.ts';
import type { M17Emitter } from './emit.ts';
import type { EnforcementReferral } from './ports.ts';
import { badRequest } from './errors.ts';

/** Default closure criteria (a full impl consults an M07 rule set + the recovery type, ADR-069). */
const DEFAULT_CLOSURE_CRITERIA: ClosureCriteria = {
  requireOutcomeRecorded: true,
  requireDeadlinesDispositioned: true,
  requireNoOpenEnforcementAction: true,
  requireNoActiveArrangement: true,
  requireWriteOffDispositioned: true,
  requireNoImminentLimitation: true,
  requireNoOpenCriticalEscalation: true,
};

type Stamp = 'referred' | 'resolved' | 'closed' | 'reopened' | 'archived';

export class RecoveryService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M17Emitter;
  private readonly repo: RecoveryRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M17Emitter,
    repo: RecoveryRepository = new RecoveryRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  // --- direct + external intake -----------------------------------------------------------------
  async create(
    ctx: RequestContext,
    actor: string | null,
    input: {
      recoveryTypeCode: string;
      title: string;
      summary?: string | null;
      description?: string | null;
      source?: string | null;
      instrumentType?: string | null;
      jurisdiction?: string | null;
      forum?: string | null;
      sourceProceedingId?: string | null;
      sourceMatterId?: string | null;
      sourceReference?: string | null;
      confidentiality?: string | null;
      privileged?: boolean;
      recoveryRisk?: string | null;
      priority?: string | null;
      principalAmountMinor?: number | null;
      interestAmountMinor?: number | null;
      costAmountMinor?: number | null;
      recoverableAmountMinor?: number | null;
      currency?: string | null;
      slaPolicyCode?: string | null;
      idempotencyKey?: string | null;
      causationId?: string | null;
    },
  ): Promise<RecoveryRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.recoveryCreate);
    return this.insertRecovery(ctx, actor, {
      ...input,
      source: input.source ?? 'direct_instruction',
      originatingModule: null,
      privileged: input.privileged === true,
    });
  }

  private async insertRecovery(
    ctx: RequestContext,
    actor: string | null,
    input: {
      recoveryTypeCode: string;
      title: string;
      summary?: string | null;
      description?: string | null;
      source: string;
      instrumentType?: string | null;
      jurisdiction?: string | null;
      forum?: string | null;
      sourceProceedingId?: string | null;
      sourceMatterId?: string | null;
      sourceReference?: string | null;
      originatingModule?: string | null;
      confidentiality?: string | null;
      privileged?: boolean;
      recoveryRisk?: string | null;
      priority?: string | null;
      principalAmountMinor?: number | null;
      interestAmountMinor?: number | null;
      costAmountMinor?: number | null;
      recoverableAmountMinor?: number | null;
      currency?: string | null;
      slaPolicyCode?: string | null;
      idempotencyKey?: string | null;
      correlationId?: string;
      causationId?: string | null;
    },
  ): Promise<RecoveryRow> {
    if (input.title.trim() === '' || input.title.length > RECOVERY_LIMITS.maxTitleChars)
      throw badRequest('a title is required and must be bounded', ctx.correlationId);
    if (input.recoveryTypeCode.trim() === '')
      throw badRequest('a recovery type is required', ctx.correlationId);
    const confidentiality = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(confidentiality)) throw badRequest('invalid confidentiality', ctx.correlationId);
    const priority = input.priority ?? 'normal';
    if (!isPriority(priority)) throw badRequest('invalid priority', ctx.correlationId);
    if (input.recoveryRisk != null && !isRecoveryRisk(input.recoveryRisk))
      throw badRequest('invalid recovery risk', ctx.correlationId);
    if (input.summary != null && input.summary.length > RECOVERY_LIMITS.maxSummaryChars)
      throw badRequest('summary too long', ctx.correlationId);
    if (input.description != null && input.description.length > RECOVERY_LIMITS.maxDescriptionChars)
      throw badRequest('description too long', ctx.correlationId);
    for (const v of [
      input.principalAmountMinor,
      input.interestAmountMinor,
      input.costAmountMinor,
      input.recoverableAmountMinor,
    ])
      if (v != null && (!Number.isInteger(v) || v < 0))
        throw badRequest('amounts must be non-negative integer minor units', ctx.correlationId);
    const correlationId = input.correlationId ?? ctx.correlationId;
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const active = await this.repo.findActiveRecoveryType(tx, input.recoveryTypeCode);
      const rec = await this.repo.insertRecovery(tx, {
        tenantId: ctx.tenantId,
        recoveryNumber: formatRecoveryNumber(randomUUID()),
        recoveryTypeCode: input.recoveryTypeCode,
        recoveryTypeVersion: active?.version_number ?? null,
        source: input.source,
        sourceProceedingId: input.sourceProceedingId ?? null,
        sourceMatterId: input.sourceMatterId ?? null,
        sourceReference: input.sourceReference ?? null,
        originatingModule: input.originatingModule ?? null,
        title: input.title,
        summary: input.summary ?? null,
        description: input.description ?? null,
        instrumentType: input.instrumentType ?? null,
        jurisdiction: input.jurisdiction ?? null,
        forum: input.forum ?? null,
        principalAmountMinor: input.principalAmountMinor ?? null,
        interestAmountMinor: input.interestAmountMinor ?? null,
        costAmountMinor: input.costAmountMinor ?? null,
        recoverableAmountMinor: input.recoverableAmountMinor ?? null,
        currency: input.currency ?? null,
        confidentiality,
        privileged: input.privileged === true,
        recoveryRisk: input.recoveryRisk ?? null,
        priority,
        strategy: null,
        slaPolicyCode: input.slaPolicyCode ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId,
        causationId: input.causationId ?? null,
        by: actor,
      });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        recoveryId: rec.id,
        fromStatus: null,
        toStatus: rec.status,
        reason: null,
        reasonCode: 'created',
        by: actor,
        correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.recoveryCreated,
        entityType: 'recovery_case',
        entityId: rec.id,
        detail: {
          recoveryNumber: rec.recovery_number,
          recoveryType: rec.recovery_type_code,
          source: rec.source,
        },
      });
      await this.emitter.publish(tx, {
        type: 'RecoveryCreated',
        tenantId: ctx.tenantId,
        correlationId,
        ...(input.causationId != null ? { causationId: input.causationId } : {}),
        ...(actor !== null ? { actor } : {}),
        payload: {
          recoveryId: rec.id,
          recoveryType: rec.recovery_type_code,
          source: rec.source,
          ...(rec.source_proceeding_id != null ? { sourceProceedingId: rec.source_proceeding_id } : {}),
          ...(rec.source_matter_id != null ? { sourceMatterId: rec.source_matter_id } : {}),
          toStatus: rec.status,
        },
      });
      return rec;
    });
  }

  async intakeExternal(
    ctx: RequestContext,
    actor: string | null,
    input: {
      source: string;
      externalReference: string;
      recoveryTypeCode: string;
      title: string;
      instrumentType?: string | null;
      jurisdiction?: string | null;
    },
  ): Promise<RecoveryRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.recoveryCreate);
    const key = `intake:${input.source}:${input.externalReference}`;
    return this.insertRecovery(ctx, actor, {
      recoveryTypeCode: input.recoveryTypeCode,
      title: input.title,
      source: input.source,
      instrumentType: input.instrumentType ?? null,
      jurisdiction: input.jurisdiction ?? null,
      originatingModule: 'external',
      idempotencyKey: key,
    });
  }

  // --- M16 enforcement referral (idempotent, one recovery per referral key) ---------------------
  async acceptReferral(
    ctx: RequestContext,
    actor: string | null,
    input: EnforcementReferral,
  ): Promise<{ recovery: RecoveryRow; created: boolean }> {
    await this.authz.require(ctx, M17_PERMISSIONS.referralAccept);
    if (input.referralKey.trim() === '') throw badRequest('a referral key is required', ctx.correlationId);
    if (input.sourceProceedingId.trim() === '')
      throw badRequest('a source proceeding id is required', ctx.correlationId);
    const correlationId = input.correlationId ?? ctx.correlationId;
    // causation_id is a uuid column — carry only a caller-supplied uuid, NEVER the (text) referral key.
    const causationId = input.causationId ?? null;
    return this.db.withTenant(ctx, async (tx): Promise<{ recovery: RecoveryRow; created: boolean }> => {
      const existing = await this.repo.findReferral(tx, input.referralKey);
      if (existing !== null) {
        const rec = await this.repo.findRecovery(tx, existing.recovery_id);
        if (rec === null)
          throw ProblemError.conflict('Referral references a missing recovery.', ctx.correlationId);
        return { recovery: rec, created: false };
      }
      const active = await this.repo.findActiveRecoveryType(tx, input.recoveryTypeCode);
      const rec = await this.repo.insertRecovery(tx, {
        tenantId: ctx.tenantId,
        recoveryNumber: formatRecoveryNumber(randomUUID()),
        recoveryTypeCode: input.recoveryTypeCode,
        recoveryTypeVersion: active?.version_number ?? null,
        source: 'enforcement_referral',
        sourceProceedingId: input.sourceProceedingId,
        sourceMatterId: input.sourceMatterId ?? null,
        sourceReference: null,
        originatingModule: 'm16-litigation',
        title: input.title,
        summary: null,
        description: null,
        instrumentType: input.instrumentType ?? null,
        jurisdiction: input.jurisdiction ?? null,
        forum: null,
        principalAmountMinor: input.principalAmountMinor ?? null,
        interestAmountMinor: null,
        costAmountMinor: null,
        recoverableAmountMinor: input.principalAmountMinor ?? null,
        currency: input.currency ?? null,
        confidentiality: 'confidential',
        privileged: true,
        recoveryRisk: null,
        priority: 'high',
        strategy: null,
        slaPolicyCode: null,
        idempotencyKey: null,
        correlationId,
        causationId,
        by: actor,
      });
      await this.repo.insertReferral(tx, {
        tenantId: ctx.tenantId,
        referralKey: input.referralKey,
        sourceProceedingId: input.sourceProceedingId,
        sourceMatterId: input.sourceMatterId ?? null,
        recoveryId: rec.id,
        recoveryTypeCode: input.recoveryTypeCode,
        safeMetadata: {
          ...(input.instrumentType !== undefined ? { instrumentType: input.instrumentType } : {}),
          ...(input.jurisdiction !== undefined ? { jurisdiction: input.jurisdiction } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
        },
        correlationId,
        causationId,
        by: actor,
      });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        recoveryId: rec.id,
        fromStatus: null,
        toStatus: rec.status,
        reason: null,
        reasonCode: 'referred',
        by: actor,
        correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.recoveryCreated,
        entityType: 'recovery_case',
        entityId: rec.id,
        detail: { recoveryNumber: rec.recovery_number, source: 'enforcement_referral' },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.recoveryReferred,
        entityType: 'recovery_referral',
        entityId: input.referralKey,
        detail: { recoveryId: rec.id },
      });
      await this.emitter.publish(tx, {
        type: 'RecoveryCreated',
        tenantId: ctx.tenantId,
        correlationId,
        ...(causationId != null ? { causationId } : {}),
        ...(actor !== null ? { actor } : {}),
        payload: {
          recoveryId: rec.id,
          recoveryType: rec.recovery_type_code,
          source: 'enforcement_referral',
          sourceProceedingId: input.sourceProceedingId,
          ...(input.sourceMatterId !== undefined ? { sourceMatterId: input.sourceMatterId } : {}),
          toStatus: rec.status,
        },
      });
      await this.emitter.publish(tx, {
        type: 'RecoveryReferredFromProceeding',
        tenantId: ctx.tenantId,
        correlationId,
        ...(causationId != null ? { causationId } : {}),
        ...(actor !== null ? { actor } : {}),
        payload: {
          recoveryId: rec.id,
          sourceProceedingId: input.sourceProceedingId,
          ...(input.sourceMatterId !== undefined ? { sourceMatterId: input.sourceMatterId } : {}),
          reasonCode: 'referred',
        },
      });
      return { recovery: rec, created: true };
    });
  }

  // --- parties ----------------------------------------------------------------------------------
  async addParty(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: {
      partyRole: string;
      entityRef?: string | null;
      displayLabel?: string | null;
      liabilityBasis?: string | null;
      liabilityAmountMinor?: number | null;
      contactRef?: string | null;
      addressRef?: string | null;
      authority?: string | null;
      confidentiality?: string;
    },
  ): Promise<PartyRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.partyManage);
    if (!isPartyRole(input.partyRole)) throw badRequest('invalid party role', ctx.correlationId);
    const conf = input.confidentiality ?? 'standard';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    if (
      input.liabilityAmountMinor != null &&
      (!Number.isInteger(input.liabilityAmountMinor) || input.liabilityAmountMinor < 0)
    )
      throw badRequest(
        'liabilityAmountMinor must be a non-negative integer (minor units)',
        ctx.correlationId,
      );
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const p = await this.repo.insertParty(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        partyRole: input.partyRole,
        entityRef: input.entityRef ?? null,
        displayLabel: input.displayLabel ?? null,
        liabilityBasis: input.liabilityBasis ?? null,
        liabilityAmountMinor: input.liabilityAmountMinor ?? null,
        contactRef: input.contactRef ?? null,
        addressRef: input.addressRef ?? null,
        authority: input.authority ?? null,
        confidentiality: conf,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.partyAdded,
        entityType: 'recovery_party',
        entityId: p.id,
        detail: { partyRole: input.partyRole },
      });
      await this.emitter.publish(tx, {
        type: 'DebtorAdded',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { recoveryId },
      });
      return p;
    });
  }
  async removeParty(
    ctx: RequestContext,
    actor: string | null,
    partyId: string,
    expectedVersion: number,
  ): Promise<PartyRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.partyManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.deactivateParty(tx, { id: partyId, expectedVersion, by: actor });
      if (upd === null)
        throw ProblemError.conflict('Party already inactive or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.partyRemoved,
        entityType: 'recovery_party',
        entityId: partyId,
        detail: {},
      });
      return upd;
    });
  }
  async listParties(
    ctx: RequestContext,
    recoveryId: string,
  ): Promise<{ parties: PartyRow[]; canReadContact: boolean }> {
    await this.authz.require(ctx, M17_PERMISSIONS.partyRead);
    const canReadContact = await this.authz.can(ctx, M17_PERMISSIONS.partyContactRead);
    const parties = await this.db.withTenant(ctx, (tx) => this.repo.listParties(tx, recoveryId));
    return { parties, canReadContact };
  }

  // --- strategy (append-only history + current strategy on the case) ----------------------------
  async selectStrategy(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: {
      expectedVersion: number;
      strategy: string;
      rationale?: string | null;
      ruleEvaluationId?: string | null;
      ruleVersion?: string | null;
      confidentiality?: string;
    },
  ): Promise<StrategyRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.strategyManage);
    if (!isRecoveryStrategy(input.strategy)) throw badRequest('invalid strategy', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const s = await this.repo.insertStrategy(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        strategy: input.strategy,
        rationale: input.rationale ?? null,
        selectedBy: actor,
        ruleEvaluationId: input.ruleEvaluationId ?? null,
        ruleVersion: input.ruleVersion ?? null,
        confidentiality: conf,
        correlationId: ctx.correlationId,
      });
      const upd = await this.repo.patchRecovery(tx, {
        id: recoveryId,
        expectedVersion: input.expectedVersion,
        strategy: input.strategy,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Recovery modified concurrently (stale version).', ctx.correlationId);
      // Strategy narrative is SENSITIVE — only the strategy code + safe rule reference reach audit (ADR-072).
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.strategySelected,
        entityType: 'recovery_case',
        entityId: recoveryId,
        detail: {
          strategy: input.strategy,
          ...(input.ruleEvaluationId != null ? { ruleEvaluationId: input.ruleEvaluationId } : {}),
        },
      });
      return s;
    });
  }

  // --- assignment -------------------------------------------------------------------------------
  async assign(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      owner: string;
      kind?: string;
      team?: string | null;
      reason?: string | null;
      reassign?: boolean;
      ruleEvaluationId?: string | null;
    },
  ): Promise<RecoveryRow> {
    await this.authz.require(
      ctx,
      input.reassign === true ? M17_PERMISSIONS.recoveryReassign : M17_PERMISSIONS.recoveryAssign,
    );
    if (input.owner.trim() === '') throw badRequest('an owner is required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const rec = await this.repo.findRecovery(tx, id);
      if (rec === null) throw ProblemError.notFound('Recovery not found.', ctx.correlationId);
      if (isRecoveryTerminal(rec.status))
        throw ProblemError.conflict(`Recovery is ${rec.status}.`, ctx.correlationId);
      const to =
        rec.status !== 'under_review' && checkRecoveryTransition(rec.status, 'under_review').ok
          ? 'under_review'
          : rec.status;
      const upd = await this.repo.assignRecovery(tx, {
        id,
        expectedVersion: input.expectedVersion,
        owner: input.owner,
        toStatus: to,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Recovery modified concurrently (stale version).', ctx.correlationId);
      if (input.team != null)
        await this.repo.patchRecovery(tx, {
          id,
          expectedVersion: upd.version,
          recoveryTeam: input.team,
          by: actor,
        });
      await this.repo.insertAssignmentHistory(tx, {
        tenantId: ctx.tenantId,
        recoveryId: id,
        kind: input.kind ?? 'legal_owner',
        ref: input.owner,
        reason: input.reason ?? null,
        ruleEvalId: input.ruleEvaluationId ?? null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      if (to !== rec.status)
        await this.repo.insertStatusHistory(tx, {
          tenantId: ctx.tenantId,
          recoveryId: id,
          fromStatus: rec.status,
          toStatus: to,
          reason: null,
          reasonCode: 'assigned',
          by: actor,
          correlationId: ctx.correlationId,
        });
      await this.emitter.recordAudit(tx, ctx, {
        code: input.reassign === true ? M17_AUDIT_CODES.recoveryReassigned : M17_AUDIT_CODES.recoveryAssigned,
        entityType: 'recovery_case',
        entityId: id,
        detail: { owner: input.owner },
      });
      await this.emitter.publish(tx, {
        type: input.reassign === true ? 'RecoveryReassigned' : 'RecoveryAssigned',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { recoveryId: id, toStatus: to },
      });
      const result = await this.repo.findRecovery(tx, id);
      return result ?? upd;
    });
  }

  // --- lifecycle --------------------------------------------------------------------------------
  private async move(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    to: string,
    opts: {
      permission: string;
      auditCode: string;
      eventType?: RecoveryLifecycleEventType;
      reasonCode?: string;
      reason?: string | null;
      stamp?: Stamp | null;
      expectedVersion: number;
      guardLegalHold?: boolean;
    },
  ): Promise<RecoveryRow> {
    await this.authz.require(ctx, opts.permission);
    return this.db.withTenant(ctx, async (tx) => {
      const rec = await this.repo.findRecovery(tx, id);
      if (rec === null) throw ProblemError.notFound('Recovery not found.', ctx.correlationId);
      if (opts.guardLegalHold === true && rec.legal_hold)
        throw ProblemError.conflict('An active legal hold blocks this action.', ctx.correlationId);
      const check = checkRecoveryTransition(rec.status, to);
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot move ${rec.status} -> ${to}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateRecoveryStatus(tx, {
        id,
        expectedVersion: opts.expectedVersion,
        toStatus: to,
        by: actor,
        stamp: opts.stamp ?? null,
      });
      if (upd === null)
        throw ProblemError.conflict('Recovery modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        recoveryId: id,
        fromStatus: rec.status,
        toStatus: to,
        reason: opts.reason ?? null,
        reasonCode: opts.reasonCode ?? null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: opts.auditCode,
        entityType: 'recovery_case',
        entityId: id,
        ...(opts.reason != null ? { reason: opts.reason } : {}),
        detail: { fromStatus: rec.status, toStatus: to },
      });
      if (opts.eventType !== undefined)
        await this.emitter.publish(tx, {
          type: opts.eventType,
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            recoveryId: id,
            fromStatus: rec.status,
            toStatus: to,
            ...(opts.reasonCode !== undefined ? { reasonCode: opts.reasonCode } : {}),
          },
        });
      return upd;
    });
  }

  /**
   * Generic procedural advance across the 29-state lifecycle, gated by `recovery.case.update`. The precise
   * from/to is the append-only status-history row; terminal targets (resolved/closed/reopened/archived) also
   * publish their dedicated lifecycle event. Closure eligibility + legal-hold gating live in `close`/`archive`.
   */
  advance(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    toStatus: string,
    expectedVersion: number,
    reasonCode?: string,
  ): Promise<RecoveryRow> {
    const terminal: Record<string, { audit: string; event: RecoveryLifecycleEventType; stamp: Stamp }> = {
      resolved: { audit: M17_AUDIT_CODES.recoveryResolved, event: 'RecoveryResolved', stamp: 'resolved' },
      closed: { audit: M17_AUDIT_CODES.recoveryClosed, event: 'RecoveryClosed', stamp: 'closed' },
      reopened: { audit: M17_AUDIT_CODES.recoveryReopened, event: 'RecoveryReopened', stamp: 'reopened' },
      archived: { audit: M17_AUDIT_CODES.recoveryArchived, event: 'RecoveryArchived', stamp: 'archived' },
    };
    const stampByStatus: Record<string, Stamp> = { referred: 'referred' };
    const t = terminal[toStatus];
    return this.move(ctx, actor, id, toStatus, {
      permission: M17_PERMISSIONS.recoveryUpdate,
      auditCode: t?.audit ?? M17_AUDIT_CODES.recoveryAssigned,
      ...(t !== undefined ? { eventType: t.event } : {}),
      ...(t !== undefined
        ? { stamp: t.stamp }
        : stampByStatus[toStatus] !== undefined
          ? { stamp: stampByStatus[toStatus] }
          : {}),
      ...(reasonCode !== undefined ? { reasonCode } : {}),
      expectedVersion,
    });
  }

  resolve(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    reasonCode?: string,
  ): Promise<RecoveryRow> {
    return this.move(ctx, actor, id, 'resolved', {
      permission: M17_PERMISSIONS.recoveryResolve,
      auditCode: M17_AUDIT_CODES.recoveryResolved,
      eventType: 'RecoveryResolved',
      stamp: 'resolved',
      reasonCode: reasonCode ?? 'resolved',
      expectedVersion,
    });
  }

  async close(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      summary?: string | null;
      residualNote?: string | null;
      waive?: boolean;
    },
  ): Promise<RecoveryRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.recoveryClose);
    return this.db.withTenant(ctx, async (tx) => {
      const rec = await this.repo.findRecovery(tx, id);
      if (rec === null) throw ProblemError.notFound('Recovery not found.', ctx.correlationId);
      if (isRecoveryTerminal(rec.status))
        throw ProblemError.conflict(`Recovery is ${rec.status}.`, ctx.correlationId);
      const soonIso = new Date(Date.now() + 14 * 86_400_000).toISOString();
      const state = {
        outcomeRecorded: await this.repo.hasOutcome(tx, id),
        openDeadlines: await this.repo.countOpenDeadlines(tx, id),
        openEnforcementActions: await this.repo.countOpenEnforcementActions(tx, id),
        activeArrangement: await this.repo.activeArrangement(tx, id),
        writeOffDispositioned: await this.repo.writeOffDispositioned(tx, id),
        imminentLimitation: await this.repo.hasImminentLimitation(tx, id, soonIso),
        agentFinalReport: await this.repo.agentFinalReport(tx, id),
        openCriticalEscalations: 0,
        sourceUpdateEmitted: rec.source_update_emitted,
        closureApproved: true,
      };
      const criteria: ClosureCriteria =
        input.waive === true
          ? { requireNoImminentLimitation: true, requireNoOpenEnforcementAction: true }
          : DEFAULT_CLOSURE_CRITERIA;
      const eligibility = evaluateClosure(criteria, state);
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.closureEvaluated,
        entityType: 'recovery_case',
        entityId: id,
        detail: { eligible: eligibility.eligible, reasons: eligibility.reasonCodes.length },
      });
      if (!eligibility.eligible)
        throw ProblemError.conflict(
          `Not eligible for closure: ${eligibility.reasonCodes.join(', ')}`,
          ctx.correlationId,
        );
      const check = checkRecoveryTransition(rec.status, 'closed');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot close from ${rec.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateRecoveryStatus(tx, {
        id,
        expectedVersion: input.expectedVersion,
        toStatus: 'closed',
        by: actor,
        stamp: 'closed',
      });
      if (upd === null)
        throw ProblemError.conflict('Recovery modified concurrently (stale version).', ctx.correlationId);
      if (input.summary != null || input.residualNote != null)
        await this.repo.patchRecovery(tx, {
          id,
          expectedVersion: upd.version,
          finalOutcome: input.summary ?? null,
          residualNote: input.residualNote ?? null,
          by: actor,
        });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        recoveryId: id,
        fromStatus: rec.status,
        toStatus: 'closed',
        reason: null,
        reasonCode: 'closed',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.recoveryClosed,
        entityType: 'recovery_case',
        entityId: id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'RecoveryClosed',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { recoveryId: id, toStatus: 'closed' },
      });
      const result = await this.repo.findRecovery(tx, id);
      return result ?? upd;
    });
  }

  reopen(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<RecoveryRow> {
    if (input.reason.trim() === '') throw badRequest('a reason is required to reopen', ctx.correlationId);
    return this.move(ctx, actor, id, 'reopened', {
      permission: M17_PERMISSIONS.recoveryReopen,
      auditCode: M17_AUDIT_CODES.recoveryReopened,
      eventType: 'RecoveryReopened',
      stamp: 'reopened',
      reasonCode: 'reopened',
      reason: input.reason,
      expectedVersion: input.expectedVersion,
    });
  }

  archive(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<RecoveryRow> {
    return this.move(ctx, actor, id, 'archived', {
      permission: M17_PERMISSIONS.recoveryArchive,
      auditCode: M17_AUDIT_CODES.recoveryArchived,
      eventType: 'RecoveryArchived',
      stamp: 'archived',
      reasonCode: 'archived',
      guardLegalHold: true,
      expectedVersion,
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async get(
    ctx: RequestContext,
    id: string,
  ): Promise<{ recovery: RecoveryRow; canReadConfidential: boolean }> {
    await this.authz.require(ctx, M17_PERMISSIONS.recoveryRead);
    const canReadConfidential = await this.authz.can(ctx, M17_PERMISSIONS.confidentialRead);
    const rec = await this.db.withTenant(ctx, async (tx) => {
      const found = await this.repo.findRecovery(tx, id);
      if (
        found !== null &&
        canReadConfidential &&
        (found.confidentiality !== 'standard' || found.privileged)
      ) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M17_AUDIT_CODES.confidentialAccessed,
          entityType: 'recovery_case',
          entityId: id,
          detail: {},
        });
      }
      return found;
    });
    if (rec === null) throw ProblemError.notFound('Recovery not found.', ctx.correlationId);
    return { recovery: rec, canReadConfidential };
  }
  async search(
    ctx: RequestContext,
    filters: {
      recoveryTypeCode?: string;
      status?: string;
      recoveryRisk?: string;
      priority?: string;
      jurisdiction?: string;
      strategy?: string;
      owner?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<RecoveryRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.recoveryRead);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.searchRecoveries(tx, {
        ...filters,
        limit: Math.min(filters.limit ?? 50, RECOVERY_LIMITS.maxSearchLimit),
        offset: filters.offset ?? 0,
      }),
    );
  }

  private async requireRecovery(
    tx: Parameters<Parameters<Db['withTenant']>[1]>[0],
    id: string,
    correlationId: string,
  ) {
    const rec = await this.repo.findRecovery(tx, id);
    if (rec === null) throw ProblemError.notFound('Recovery not found.', correlationId);
    return rec;
  }
}
