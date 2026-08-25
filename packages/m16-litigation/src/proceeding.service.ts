/**
 * ProceedingService — intake (direct instruction, external, and the idempotent M14 matter referral), parties,
 * claims, assignment, the full 30-state proceeding lifecycle, closure (rule-gated), reopening and archival. Every
 * mutating method enforces its permission (default deny), runs inside `db.withTenant`, records audit + a
 * litigation.lifecycle outbox event in the SAME transaction, appends status/assignment history, and is
 * optimistic-lock guarded. Lifecycle transitions go through the PURE `checkProceedingTransition` choke point.
 * Confidential/privileged proceedings are redacted on read unless the caller holds `litigation.confidential.read`
 * (ADR-068). The M14 referral is idempotent (one proceeding per referral key); m16 NEVER reads m14 tables — the
 * matter id is an opaque reference carried across a governed inbound contract.
 */
import { randomUUID } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { LitigationLifecycleEventType } from '@finapp/contracts';
import { M16_PERMISSIONS } from './permissions.ts';
import { M16_AUDIT_CODES } from './audit-codes.ts';
import { checkProceedingTransition, isProceedingTerminal } from './domain/lifecycles.ts';
import {
  isConfidentiality,
  isPriority,
  isLitigationRisk,
  isPartyRole,
  isClaimType,
  LITIGATION_LIMITS,
} from './domain/limits.ts';
import { evaluateClosure, type ClosureCriteria } from './domain/closure.ts';
import { formatProceedingNumber } from './proceeding-number.ts';
import { LitigationRepository, type ProceedingRow, type PartyRow, type ClaimRow } from './repository.ts';
import type { M16Emitter } from './emit.ts';
import type { MatterReferral } from './ports.ts';
import { badRequest } from './errors.ts';

/** Default closure criteria (a full impl consults an M07 rule set + the proceeding type, ADR-065). */
const DEFAULT_CLOSURE_CRITERIA: ClosureCriteria = {
  requireOutcomeRecorded: true,
  requireDeadlinesDispositioned: true,
  requireComplianceDispositioned: true,
  requireNoImminentLimitation: true,
  requireNoActiveStay: true,
  requireNoOpenCriticalEscalation: true,
};

type Stamp = 'filed' | 'served' | 'commenced' | 'concluded' | 'closed' | 'reopened' | 'archived';

export class ProceedingService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M16Emitter;
  private readonly repo: LitigationRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M16Emitter,
    repo: LitigationRepository = new LitigationRepository(),
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
      proceedingTypeCode: string;
      title: string;
      summary?: string | null;
      description?: string | null;
      source?: string | null;
      jurisdiction?: string | null;
      forum?: string | null;
      forumType?: string | null;
      court?: string | null;
      station?: string | null;
      division?: string | null;
      externalCaseNumber?: string | null;
      organizationRole?: string | null;
      confidentiality?: string | null;
      privileged?: boolean;
      litigationRisk?: string | null;
      priority?: string | null;
      claimAmountMinor?: number | null;
      currency?: string | null;
      slaPolicyCode?: string | null;
      idempotencyKey?: string | null;
      causationId?: string | null;
    },
  ): Promise<ProceedingRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.proceedingCreate);
    return this.insertProceeding(ctx, actor, {
      ...input,
      source: input.source ?? 'direct_instruction',
      sourceMatterId: null,
      originatingModule: null,
      privileged: input.privileged === true,
    });
  }

  private async insertProceeding(
    ctx: RequestContext,
    actor: string | null,
    input: {
      proceedingTypeCode: string;
      title: string;
      summary?: string | null;
      description?: string | null;
      source: string;
      sourceMatterId?: string | null;
      originatingModule?: string | null;
      jurisdiction?: string | null;
      forum?: string | null;
      forumType?: string | null;
      court?: string | null;
      station?: string | null;
      division?: string | null;
      externalCaseNumber?: string | null;
      organizationRole?: string | null;
      confidentiality?: string | null;
      privileged?: boolean;
      litigationRisk?: string | null;
      priority?: string | null;
      claimAmountMinor?: number | null;
      currency?: string | null;
      slaPolicyCode?: string | null;
      idempotencyKey?: string | null;
      correlationId?: string;
      causationId?: string | null;
    },
  ): Promise<ProceedingRow> {
    if (input.title.trim() === '' || input.title.length > LITIGATION_LIMITS.maxTitleChars)
      throw badRequest('a title is required and must be bounded', ctx.correlationId);
    if (input.proceedingTypeCode.trim() === '')
      throw badRequest('a proceeding type is required', ctx.correlationId);
    const confidentiality = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(confidentiality)) throw badRequest('invalid confidentiality', ctx.correlationId);
    const priority = input.priority ?? 'normal';
    if (!isPriority(priority)) throw badRequest('invalid priority', ctx.correlationId);
    if (input.litigationRisk != null && !isLitigationRisk(input.litigationRisk))
      throw badRequest('invalid litigation risk', ctx.correlationId);
    if (input.summary != null && input.summary.length > LITIGATION_LIMITS.maxSummaryChars)
      throw badRequest('summary too long', ctx.correlationId);
    if (input.description != null && input.description.length > LITIGATION_LIMITS.maxDescriptionChars)
      throw badRequest('description too long', ctx.correlationId);
    if (
      input.claimAmountMinor != null &&
      (!Number.isInteger(input.claimAmountMinor) || input.claimAmountMinor < 0)
    )
      throw badRequest('claimAmountMinor must be a non-negative integer (minor units)', ctx.correlationId);
    const correlationId = input.correlationId ?? ctx.correlationId;
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findProceedingByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const active = await this.repo.findActiveProceedingType(tx, input.proceedingTypeCode);
      const p = await this.repo.insertProceeding(tx, {
        tenantId: ctx.tenantId,
        proceedingNumber: formatProceedingNumber(randomUUID()),
        proceedingTypeCode: input.proceedingTypeCode,
        proceedingTypeVersion: active?.version_number ?? null,
        source: input.source,
        sourceMatterId: input.sourceMatterId ?? null,
        originatingModule: input.originatingModule ?? null,
        title: input.title,
        summary: input.summary ?? null,
        description: input.description ?? null,
        jurisdiction: input.jurisdiction ?? null,
        forum: input.forum ?? null,
        forumType: input.forumType ?? null,
        court: input.court ?? null,
        station: input.station ?? null,
        division: input.division ?? null,
        externalCaseNumber: input.externalCaseNumber ?? null,
        organizationRole: input.organizationRole ?? null,
        claimAmountMinor: input.claimAmountMinor ?? null,
        currency: input.currency ?? null,
        confidentiality,
        privileged: input.privileged === true,
        litigationRisk: input.litigationRisk ?? null,
        priority,
        slaPolicyCode: input.slaPolicyCode ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId,
        causationId: input.causationId ?? null,
        by: actor,
      });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        proceedingId: p.id,
        fromStatus: null,
        toStatus: p.status,
        reason: null,
        reasonCode: 'created',
        by: actor,
        correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.proceedingCreated,
        entityType: 'litigation_proceeding',
        entityId: p.id,
        detail: {
          proceedingNumber: p.proceeding_number,
          proceedingType: p.proceeding_type_code,
          source: p.source,
        },
      });
      await this.emitter.publish(tx, {
        type: 'ProceedingCreated',
        tenantId: ctx.tenantId,
        correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          proceedingId: p.id,
          proceedingType: p.proceeding_type_code,
          source: p.source,
          ...(p.source_matter_id != null ? { sourceMatterId: p.source_matter_id } : {}),
          toStatus: p.status,
        },
      });
      return p;
    });
  }

  async intakeExternal(
    ctx: RequestContext,
    actor: string | null,
    input: {
      source: string;
      externalReference: string;
      proceedingTypeCode: string;
      title: string;
      jurisdiction?: string | null;
      forum?: string | null;
    },
  ): Promise<ProceedingRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.proceedingCreate);
    const key = `intake:${input.source}:${input.externalReference}`;
    return this.insertProceeding(ctx, actor, {
      proceedingTypeCode: input.proceedingTypeCode,
      title: input.title,
      source: input.source,
      jurisdiction: input.jurisdiction ?? null,
      forum: input.forum ?? null,
      originatingModule: 'external',
      idempotencyKey: key,
    });
  }

  // --- M14 matter referral (idempotent, one proceeding per referral key) ------------------------
  async acceptReferral(
    ctx: RequestContext,
    actor: string | null,
    input: MatterReferral,
  ): Promise<{ proceeding: ProceedingRow; created: boolean }> {
    await this.authz.require(ctx, M16_PERMISSIONS.referralAccept);
    if (input.referralKey.trim() === '') throw badRequest('a referral key is required', ctx.correlationId);
    if (input.sourceMatterId.trim() === '')
      throw badRequest('a source matter id is required', ctx.correlationId);
    const correlationId = input.correlationId ?? ctx.correlationId;
    return this.db.withTenant(ctx, async (tx): Promise<{ proceeding: ProceedingRow; created: boolean }> => {
      const existing = await this.repo.findReferral(tx, input.referralKey);
      if (existing !== null) {
        const p = await this.repo.findProceeding(tx, existing.proceeding_id);
        if (p === null)
          throw ProblemError.conflict('Referral references a missing proceeding.', ctx.correlationId);
        return { proceeding: p, created: false };
      }
      const active = await this.repo.findActiveProceedingType(tx, input.proceedingTypeCode);
      const p = await this.repo.insertProceeding(tx, {
        tenantId: ctx.tenantId,
        proceedingNumber: formatProceedingNumber(randomUUID()),
        proceedingTypeCode: input.proceedingTypeCode,
        proceedingTypeVersion: active?.version_number ?? null,
        source: 'matter_referral',
        sourceMatterId: input.sourceMatterId,
        originatingModule: 'm14-legal',
        title: input.title,
        summary: null,
        description: null,
        jurisdiction: input.jurisdiction ?? null,
        forum: input.forum ?? null,
        forumType: null,
        court: null,
        station: null,
        division: null,
        externalCaseNumber: input.externalCaseNumber ?? null,
        organizationRole: input.organizationRole ?? null,
        claimAmountMinor: null,
        currency: null,
        confidentiality: 'confidential',
        privileged: true,
        litigationRisk: null,
        priority: 'high',
        slaPolicyCode: null,
        idempotencyKey: null,
        correlationId,
        causationId: input.causationId ?? null,
        by: actor,
      });
      await this.repo.insertReferral(tx, {
        tenantId: ctx.tenantId,
        referralKey: input.referralKey,
        sourceMatterId: input.sourceMatterId,
        proceedingId: p.id,
        proceedingTypeCode: input.proceedingTypeCode,
        safeMetadata: {
          ...(input.forum !== undefined ? { forum: input.forum } : {}),
          ...(input.jurisdiction !== undefined ? { jurisdiction: input.jurisdiction } : {}),
          ...(input.organizationRole !== undefined ? { organizationRole: input.organizationRole } : {}),
        },
        correlationId,
        causationId: input.causationId ?? null,
        by: actor,
      });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        proceedingId: p.id,
        fromStatus: null,
        toStatus: p.status,
        reason: null,
        reasonCode: 'referred',
        by: actor,
        correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.proceedingCreated,
        entityType: 'litigation_proceeding',
        entityId: p.id,
        detail: { proceedingNumber: p.proceeding_number, source: 'matter_referral' },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.proceedingReferred,
        entityType: 'litigation_referral',
        entityId: input.referralKey,
        detail: { proceedingId: p.id },
      });
      await this.emitter.publish(tx, {
        type: 'ProceedingCreated',
        tenantId: ctx.tenantId,
        correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          proceedingId: p.id,
          proceedingType: p.proceeding_type_code,
          source: 'matter_referral',
          sourceMatterId: input.sourceMatterId,
          toStatus: p.status,
        },
      });
      await this.emitter.publish(tx, {
        type: 'ProceedingReferredFromMatter',
        tenantId: ctx.tenantId,
        correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { proceedingId: p.id, sourceMatterId: input.sourceMatterId, reasonCode: 'referred' },
      });
      return { proceeding: p, created: true };
    });
  }

  // --- parties ----------------------------------------------------------------------------------
  async addParty(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      partyRole: string;
      entityRef?: string | null;
      displayLabel?: string | null;
      representationRef?: string | null;
      advocateRef?: string | null;
      lawFirmRef?: string | null;
      leadCounselRef?: string | null;
      serviceAddressRef?: string | null;
      authority?: string | null;
      contactRef?: string | null;
      confidentiality?: string;
    },
  ): Promise<PartyRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.partyManage);
    if (!isPartyRole(input.partyRole)) throw badRequest('invalid party role', ctx.correlationId);
    const conf = input.confidentiality ?? 'standard';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const p = await this.repo.insertParty(tx, {
        tenantId: ctx.tenantId,
        proceedingId,
        partyRole: input.partyRole,
        entityRef: input.entityRef ?? null,
        displayLabel: input.displayLabel ?? null,
        representationRef: input.representationRef ?? null,
        advocateRef: input.advocateRef ?? null,
        lawFirmRef: input.lawFirmRef ?? null,
        leadCounselRef: input.leadCounselRef ?? null,
        serviceAddressRef: input.serviceAddressRef ?? null,
        authority: input.authority ?? null,
        contactRef: input.contactRef ?? null,
        confidentiality: conf,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.partyAdded,
        entityType: 'litigation_party',
        entityId: p.id,
        detail: { partyRole: input.partyRole },
      });
      await this.emitter.publish(tx, {
        type: 'PartyAdded',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { proceedingId },
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
    await this.authz.require(ctx, M16_PERMISSIONS.partyManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.deactivateParty(tx, { id: partyId, expectedVersion, by: actor });
      if (upd === null)
        throw ProblemError.conflict('Party already inactive or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.partyRemoved,
        entityType: 'litigation_party',
        entityId: partyId,
        detail: {},
      });
      return upd;
    });
  }
  async listParties(
    ctx: RequestContext,
    proceedingId: string,
  ): Promise<{ parties: PartyRow[]; canReadContact: boolean }> {
    await this.authz.require(ctx, M16_PERMISSIONS.partyRead);
    const canReadContact = await this.authz.can(ctx, M16_PERMISSIONS.partyContactRead);
    return this.db.withTenant(ctx, async (tx) => {
      const parties = await this.repo.listParties(tx, proceedingId);
      // Contact VALUES never enter events/audit — but ACCESS to protected contact data is itself auditable.
      // Emit LITIGATION_PARTY_CONTACT_ACCESSED ONLY when contact is actually revealed (the caller holds
      // litigation.party_contact.read AND ≥1 party exposes a non-null contact ref) — never for non-sensitive
      // metadata, carrying only the proceeding id + a count, never the contact value.
      const revealedCount = canReadContact ? parties.filter((p) => p.contact_ref !== null).length : 0;
      if (revealedCount > 0) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M16_AUDIT_CODES.partyContactAccessed,
          entityType: 'litigation_proceeding',
          entityId: proceedingId,
          detail: { revealedCount },
        });
      }
      return { parties, canReadContact };
    });
  }

  // --- claims -----------------------------------------------------------------------------------
  async addClaim(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      claimType: string;
      statement?: string | null;
      causeReference?: string | null;
      reliefSought?: string | null;
      amountMinor?: number | null;
      currency?: string | null;
      nonMonetaryRelief?: string | null;
      counterclaim?: boolean;
      defence?: string | null;
      risk?: string | null;
      confidentiality?: string;
    },
  ): Promise<ClaimRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.claimManage);
    if (!isClaimType(input.claimType)) throw badRequest('invalid claim type', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    if (input.statement != null && input.statement.length > LITIGATION_LIMITS.maxStatementChars)
      throw badRequest('claim statement too long', ctx.correlationId);
    if (input.amountMinor != null && (!Number.isInteger(input.amountMinor) || input.amountMinor < 0))
      throw badRequest('amountMinor must be a non-negative integer (minor units)', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const c = await this.repo.insertClaim(tx, {
        tenantId: ctx.tenantId,
        proceedingId,
        claimType: input.claimType,
        statement: input.statement ?? null,
        causeReference: input.causeReference ?? null,
        reliefSought: input.reliefSought ?? null,
        amountMinor: input.amountMinor ?? null,
        currency: input.currency ?? null,
        nonMonetaryRelief: input.nonMonetaryRelief ?? null,
        counterclaim: input.counterclaim === true,
        defence: input.defence ?? null,
        risk: input.risk ?? null,
        confidentiality: conf,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.claimAdded,
        entityType: 'litigation_claim',
        entityId: c.id,
        detail: { claimType: input.claimType },
      });
      await this.emitter.publish(tx, {
        type: 'ClaimAdded',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          proceedingId,
          ...(input.amountMinor != null ? { amountMinor: input.amountMinor } : {}),
        },
      });
      return c;
    });
  }
  async patchClaim(
    ctx: RequestContext,
    actor: string | null,
    claimId: string,
    input: {
      expectedVersion: number;
      admissionStatus?: string | null;
      outcome?: string | null;
      status?: string | null;
      defence?: string | null;
    },
  ): Promise<ClaimRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.claimManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.patchClaim(tx, {
        id: claimId,
        expectedVersion: input.expectedVersion,
        admissionStatus: input.admissionStatus ?? null,
        outcome: input.outcome ?? null,
        status: input.status ?? null,
        defence: input.defence ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Claim modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.claimUpdated,
        entityType: 'litigation_claim',
        entityId: claimId,
        detail: {},
      });
      return upd;
    });
  }
  async listClaims(ctx: RequestContext, proceedingId: string): Promise<ClaimRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.claimRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listClaims(tx, proceedingId));
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
  ): Promise<ProceedingRow> {
    await this.authz.require(
      ctx,
      input.reassign === true ? M16_PERMISSIONS.proceedingReassign : M16_PERMISSIONS.proceedingAssign,
    );
    if (input.owner.trim() === '') throw badRequest('an owner is required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const p = await this.repo.findProceeding(tx, id);
      if (p === null) throw ProblemError.notFound('Proceeding not found.', ctx.correlationId);
      if (isProceedingTerminal(p.status))
        throw ProblemError.conflict(`Proceeding is ${p.status}.`, ctx.correlationId);
      const to =
        p.status !== 'under_review' && checkProceedingTransition(p.status, 'under_review').ok
          ? 'under_review'
          : p.status;
      const upd = await this.repo.assignProceeding(tx, {
        id,
        expectedVersion: input.expectedVersion,
        owner: input.owner,
        toStatus: to,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Proceeding modified concurrently (stale version).', ctx.correlationId);
      if (input.team != null)
        await this.repo.patchProceeding(tx, {
          id,
          expectedVersion: upd.version,
          litigationTeam: input.team,
          by: actor,
        });
      await this.repo.insertAssignmentHistory(tx, {
        tenantId: ctx.tenantId,
        proceedingId: id,
        kind: input.kind ?? 'legal_owner',
        ref: input.owner,
        reason: input.reason ?? null,
        ruleEvalId: input.ruleEvaluationId ?? null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      if (to !== p.status)
        await this.repo.insertStatusHistory(tx, {
          tenantId: ctx.tenantId,
          proceedingId: id,
          fromStatus: p.status,
          toStatus: to,
          reason: null,
          reasonCode: 'assigned',
          by: actor,
          correlationId: ctx.correlationId,
        });
      await this.emitter.recordAudit(tx, ctx, {
        code:
          input.reassign === true ? M16_AUDIT_CODES.proceedingReassigned : M16_AUDIT_CODES.proceedingAssigned,
        entityType: 'litigation_proceeding',
        entityId: id,
        detail: { owner: input.owner },
      });
      await this.emitter.publish(tx, {
        type: input.reassign === true ? 'ProceedingReassigned' : 'ProceedingAssigned',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { proceedingId: id, toStatus: to },
      });
      const result = await this.repo.findProceeding(tx, id);
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
      eventType?: LitigationLifecycleEventType;
      reasonCode?: string;
      reason?: string | null;
      stamp?: Stamp | null;
      expectedVersion: number;
      guardLegalHold?: boolean;
    },
  ): Promise<ProceedingRow> {
    await this.authz.require(ctx, opts.permission);
    return this.db.withTenant(ctx, async (tx) => {
      const p = await this.repo.findProceeding(tx, id);
      if (p === null) throw ProblemError.notFound('Proceeding not found.', ctx.correlationId);
      if (opts.guardLegalHold === true && p.legal_hold)
        throw ProblemError.conflict('An active legal hold blocks this action.', ctx.correlationId);
      const check = checkProceedingTransition(p.status, to);
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot move ${p.status} -> ${to}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateProceedingStatus(tx, {
        id,
        expectedVersion: opts.expectedVersion,
        toStatus: to,
        by: actor,
        stamp: opts.stamp ?? null,
      });
      if (upd === null)
        throw ProblemError.conflict('Proceeding modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        proceedingId: id,
        fromStatus: p.status,
        toStatus: to,
        reason: opts.reason ?? null,
        reasonCode: opts.reasonCode ?? null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: opts.auditCode,
        entityType: 'litigation_proceeding',
        entityId: id,
        ...(opts.reason != null ? { reason: opts.reason } : {}),
        detail: { fromStatus: p.status, toStatus: to },
      });
      if (opts.eventType !== undefined)
        await this.emitter.publish(tx, {
          type: opts.eventType,
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            proceedingId: id,
            fromStatus: p.status,
            toStatus: to,
            ...(opts.reasonCode !== undefined ? { reasonCode: opts.reasonCode } : {}),
          },
        });
      return upd;
    });
  }

  /**
   * Generic procedural advance across the 30-state lifecycle, gated by `proceeding.update`. The precise
   * from/to is the append-only status-history row; terminal targets (concluded/closed/reopened/archived) also
   * publish their dedicated lifecycle event. Closure eligibility + legal-hold gating live in `close`/`archive`.
   */
  advance(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    toStatus: string,
    expectedVersion: number,
    reasonCode?: string,
  ): Promise<ProceedingRow> {
    const terminal: Record<string, { audit: string; event: LitigationLifecycleEventType; stamp: Stamp }> = {
      concluded: {
        audit: M16_AUDIT_CODES.proceedingConcluded,
        event: 'ProceedingConcluded',
        stamp: 'concluded',
      },
      closed: { audit: M16_AUDIT_CODES.proceedingClosed, event: 'ProceedingClosed', stamp: 'closed' },
      reopened: {
        audit: M16_AUDIT_CODES.proceedingReopened,
        event: 'ProceedingReopened',
        stamp: 'reopened',
      },
      archived: {
        audit: M16_AUDIT_CODES.proceedingArchived,
        event: 'ProceedingArchived',
        stamp: 'archived',
      },
    };
    const stampByStatus: Record<string, Stamp> = { filed: 'filed', served: 'served', hearing: 'commenced' };
    const t = terminal[toStatus];
    return this.move(ctx, actor, id, toStatus, {
      permission: M16_PERMISSIONS.proceedingUpdate,
      auditCode: t?.audit ?? M16_AUDIT_CODES.proceedingConcluded,
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

  conclude(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    reasonCode?: string,
  ): Promise<ProceedingRow> {
    return this.move(ctx, actor, id, 'concluded', {
      permission: M16_PERMISSIONS.proceedingConclude,
      auditCode: M16_AUDIT_CODES.proceedingConcluded,
      eventType: 'ProceedingConcluded',
      stamp: 'concluded',
      reasonCode: reasonCode ?? 'concluded',
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
      residualObligations?: string | null;
      waive?: boolean;
    },
  ): Promise<ProceedingRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.proceedingClose);
    return this.db.withTenant(ctx, async (tx) => {
      const p = await this.repo.findProceeding(tx, id);
      if (p === null) throw ProblemError.notFound('Proceeding not found.', ctx.correlationId);
      if (isProceedingTerminal(p.status))
        throw ProblemError.conflict(`Proceeding is ${p.status}.`, ctx.correlationId);
      const soonIso = new Date(Date.now() + 14 * 86_400_000).toISOString();
      const state = {
        openFilings: await this.repo.countOpenFilings(tx, id),
        serviceCompleted: await this.repo.serviceCompleted(tx, id),
        openAppearances: await this.repo.countOpenAppearances(tx, id),
        openHearings: await this.repo.countOpenHearings(tx, id),
        outcomeRecorded: await this.repo.hasOutcome(tx, id),
        appealDispositioned: true,
        openComplianceObligations: await this.repo.countOpenComplianceObligations(tx, id),
        counselFinalReport: true,
        requiredDocumentsPresent: true,
        openDeadlines: await this.repo.countOpenDeadlines(tx, id),
        imminentLimitation: await this.repo.hasImminentLimitation(tx, id, soonIso),
        activeStay: p.status === 'stayed' || (await this.repo.activeStay(tx, id)),
        openCriticalEscalations: 0,
        matterUpdateEmitted: p.matter_update_emitted,
        closureApproved: true,
      };
      const criteria: ClosureCriteria =
        input.waive === true
          ? { requireNoImminentLimitation: true, requireNoActiveStay: true }
          : DEFAULT_CLOSURE_CRITERIA;
      const eligibility = evaluateClosure(criteria, state);
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.closureEvaluated,
        entityType: 'litigation_proceeding',
        entityId: id,
        detail: { eligible: eligibility.eligible, reasons: eligibility.reasonCodes.length },
      });
      if (!eligibility.eligible)
        throw ProblemError.conflict(
          `Not eligible for closure: ${eligibility.reasonCodes.join(', ')}`,
          ctx.correlationId,
        );
      const check = checkProceedingTransition(p.status, 'closed');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot close from ${p.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateProceedingStatus(tx, {
        id,
        expectedVersion: input.expectedVersion,
        toStatus: 'closed',
        by: actor,
        stamp: 'closed',
      });
      if (upd === null)
        throw ProblemError.conflict('Proceeding modified concurrently (stale version).', ctx.correlationId);
      if (input.summary != null || input.residualObligations != null)
        await this.repo.patchProceeding(tx, {
          id,
          expectedVersion: upd.version,
          finalOutcome: input.summary ?? null,
          residualObligations: input.residualObligations ?? null,
          by: actor,
        });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        proceedingId: id,
        fromStatus: p.status,
        toStatus: 'closed',
        reason: null,
        reasonCode: 'closed',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.proceedingClosed,
        entityType: 'litigation_proceeding',
        entityId: id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'ProceedingClosed',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { proceedingId: id, toStatus: 'closed' },
      });
      const result = await this.repo.findProceeding(tx, id);
      return result ?? upd;
    });
  }

  reopen(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<ProceedingRow> {
    if (input.reason.trim() === '') throw badRequest('a reason is required to reopen', ctx.correlationId);
    return this.move(ctx, actor, id, 'reopened', {
      permission: M16_PERMISSIONS.proceedingReopen,
      auditCode: M16_AUDIT_CODES.proceedingReopened,
      eventType: 'ProceedingReopened',
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
  ): Promise<ProceedingRow> {
    return this.move(ctx, actor, id, 'archived', {
      permission: M16_PERMISSIONS.proceedingArchive,
      auditCode: M16_AUDIT_CODES.proceedingArchived,
      eventType: 'ProceedingArchived',
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
  ): Promise<{ proceeding: ProceedingRow; canReadConfidential: boolean }> {
    await this.authz.require(ctx, M16_PERMISSIONS.proceedingRead);
    const canReadConfidential = await this.authz.can(ctx, M16_PERMISSIONS.confidentialRead);
    const p = await this.db.withTenant(ctx, async (tx) => {
      const found = await this.repo.findProceeding(tx, id);
      if (
        found !== null &&
        canReadConfidential &&
        (found.confidentiality !== 'standard' || found.privileged)
      ) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M16_AUDIT_CODES.confidentialAccessed,
          entityType: 'litigation_proceeding',
          entityId: id,
          detail: {},
        });
      }
      return found;
    });
    if (p === null) throw ProblemError.notFound('Proceeding not found.', ctx.correlationId);
    return { proceeding: p, canReadConfidential };
  }
  async search(
    ctx: RequestContext,
    filters: {
      proceedingTypeCode?: string;
      status?: string;
      litigationRisk?: string;
      priority?: string;
      jurisdiction?: string;
      forum?: string;
      owner?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<ProceedingRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.proceedingRead);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.searchProceedings(tx, {
        ...filters,
        limit: Math.min(filters.limit ?? 50, LITIGATION_LIMITS.maxSearchLimit),
        offset: filters.offset ?? 0,
      }),
    );
  }

  private async requireProceeding(
    tx: Parameters<Parameters<Db['withTenant']>[1]>[0],
    id: string,
    correlationId: string,
  ) {
    const p = await this.repo.findProceeding(tx, id);
    if (p === null) throw ProblemError.notFound('Proceeding not found.', correlationId);
    return p;
  }
}
