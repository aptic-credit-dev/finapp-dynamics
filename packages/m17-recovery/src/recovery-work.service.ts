/**
 * RecoveryWorkService — the structured working entities of a recovery case: enforceable instruments, demands,
 * negotiations, repayment arrangements (maker-checker) + their installment schedules (metadata only), enforcement
 * actions, security/collateral (single-winner realization), external agents + their reports, recovery receipts
 * (REFERENCES only), waivers, write-off RECOMMENDATIONS (maker-checker), outcomes, deterministic deadlines/limitation,
 * cost references, notes, relationships, SLA materialization, escalation and analytics. Every mutating method
 * enforces its permission (default deny), runs inside `db.withTenant`, records audit + a recovery.lifecycle event
 * (where one exists) in the same tx, and is optimistic-lock/CAS guarded. Debtor contacts, negotiation strategy,
 * settlement terms, bank/payment details, security valuations and privileged notes are RLS-stored, redacted on read,
 * and never in events/audit (ADR-072). FINANCE BOUNDARY (ADR-071): ALL amounts are REFERENCES only — no cash
 * application, ledger posting, AR, payment execution, reconciliation, or accounting write-off.
 */
import { randomUUID } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { RecoveryLifecycleEventType } from '@finapp/contracts';
import { M17_PERMISSIONS } from './permissions.ts';
import { M17_AUDIT_CODES } from './audit-codes.ts';
import {
  isConfidentiality,
  isInstrumentType,
  isDemandType,
  isArrangementType,
  isEnforcementActionType,
  isSecurityType,
  isReceiptType,
  isWriteOffReason,
  isOutcomeType,
  isDeadlineType,
  isCostType,
  isNoteType,
  isRestrictedNote,
  RECOVERY_LIMITS,
} from './domain/limits.ts';
import { isRelationshipKind, isSelfRelation } from './domain/closure.ts';
import {
  computeDeadlineDueMs,
  deadlineState,
  isLimitationSafe,
  type DeadlineRule,
} from './domain/deadlines.ts';
import { computeDueDates, type RecoverySlaPolicySpec } from './domain/sla.ts';
import {
  RecoveryRepository,
  type InstrumentRow,
  type DemandRow,
  type NegotiationRow,
  type ArrangementRow,
  type InstallmentRow,
  type EnforcementActionRow,
  type SecurityRow,
  type AgentRow,
  type AgentReportRow,
  type ReceiptRow,
  type WaiverRow,
  type WriteoffRow,
  type OutcomeRow,
  type DeadlineRow,
  type CostRow,
  type NoteRow,
  type RelationshipRow,
} from './repository.ts';
import type { M17Emitter } from './emit.ts';
import type { Clock } from './ports.ts';
import { SystemClock } from './ports.ts';
import { badRequest } from './errors.ts';

const iso = (ms: number): string => new Date(ms).toISOString();

function assertAmounts(values: (number | null | undefined)[], correlationId: string): void {
  for (const v of values)
    if (v != null && (!Number.isInteger(v) || v < 0))
      throw badRequest('amounts must be non-negative integer minor units', correlationId);
}

export class RecoveryWorkService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M17Emitter;
  private readonly repo: RecoveryRepository;
  private readonly clock: Clock;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M17Emitter,
    repo: RecoveryRepository = new RecoveryRepository(),
    clock: Clock = new SystemClock(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.clock = clock;
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
  private async publish(
    tx: Parameters<Parameters<Db['withTenant']>[1]>[0],
    ctx: RequestContext,
    actor: string | null,
    type: RecoveryLifecycleEventType,
    payload: Record<string, unknown> & { recoveryId: string },
  ): Promise<void> {
    await this.emitter.publish(tx, {
      type,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor !== null ? { actor } : {}),
      payload,
    });
  }

  // --- instruments ------------------------------------------------------------------------------
  async registerInstrument(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: {
      instrumentType: string;
      reference?: string | null;
      issuingForum?: string | null;
      issueDate?: string | null;
      maturityDate?: string | null;
      faceAmountMinor?: number | null;
      currency?: string | null;
      enforceable?: boolean;
      enforceabilityNote?: string | null;
      documentRef?: string | null;
      sourceProceedingId?: string | null;
      confidentiality?: string;
    },
  ): Promise<InstrumentRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.instrumentManage);
    if (!isInstrumentType(input.instrumentType))
      throw badRequest('invalid instrument type', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    assertAmounts([input.faceAmountMinor], ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const inst = await this.repo.insertInstrument(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        instrumentType: input.instrumentType,
        reference: input.reference ?? null,
        issuingForum: input.issuingForum ?? null,
        issueDate: input.issueDate ?? null,
        maturityDate: input.maturityDate ?? null,
        faceAmountMinor: input.faceAmountMinor ?? null,
        currency: input.currency ?? null,
        enforceable: input.enforceable !== false,
        enforceabilityNote: input.enforceabilityNote ?? null,
        documentRef: input.documentRef ?? null,
        sourceProceedingId: input.sourceProceedingId ?? null,
        confidentiality: conf,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.instrumentRegistered,
        entityType: 'recovery_instrument',
        entityId: inst.id,
        detail: { instrumentType: input.instrumentType },
      });
      await this.publish(tx, ctx, actor, 'InstrumentRegistered', {
        recoveryId,
        instrumentType: input.instrumentType,
      });
      return inst;
    });
  }
  async updateInstrument(
    ctx: RequestContext,
    actor: string | null,
    instrumentId: string,
    input: {
      expectedVersion: number;
      reference?: string | null;
      issuingForum?: string | null;
      enforceable?: boolean | null;
      enforceabilityNote?: string | null;
      documentRef?: string | null;
    },
  ): Promise<InstrumentRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.instrumentManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateInstrument(tx, {
        id: instrumentId,
        expectedVersion: input.expectedVersion,
        reference: input.reference ?? null,
        issuingForum: input.issuingForum ?? null,
        enforceable: input.enforceable ?? null,
        enforceabilityNote: input.enforceabilityNote ?? null,
        documentRef: input.documentRef ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Instrument modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.instrumentUpdated,
        entityType: 'recovery_instrument',
        entityId: instrumentId,
        detail: {},
      });
      return upd;
    });
  }
  async listInstruments(ctx: RequestContext, recoveryId: string): Promise<InstrumentRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.instrumentRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listInstruments(tx, recoveryId));
  }

  // --- demands ----------------------------------------------------------------------------------
  async issueDemand(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: {
      demandType: string;
      partyRef?: string | null;
      amountDemandedMinor?: number | null;
      currency?: string | null;
      issuedDate?: string | null;
      responseDue?: string | null;
      deliveryMethod?: string | null;
      documentRef?: string | null;
      status?: string;
      confidentiality?: string;
    },
  ): Promise<DemandRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.demandManage);
    if (!isDemandType(input.demandType)) throw badRequest('invalid demand type', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    assertAmounts([input.amountDemandedMinor], ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const d = await this.repo.insertDemand(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        demandType: input.demandType,
        partyRef: input.partyRef ?? null,
        amountDemandedMinor: input.amountDemandedMinor ?? null,
        currency: input.currency ?? null,
        issuedDate: input.issuedDate ?? null,
        responseDue: input.responseDue ?? null,
        deliveryMethod: input.deliveryMethod ?? null,
        documentRef: input.documentRef ?? null,
        status: input.status ?? 'issued',
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.demandIssued,
        entityType: 'recovery_demand',
        entityId: d.id,
        detail: { demandType: input.demandType },
      });
      await this.publish(tx, ctx, actor, 'DemandIssued', {
        recoveryId,
        ...(input.amountDemandedMinor != null ? { amountMinor: input.amountDemandedMinor } : {}),
        ...(input.responseDue != null ? { dueAt: input.responseDue } : {}),
      });
      return d;
    });
  }
  async respondDemand(
    ctx: RequestContext,
    actor: string | null,
    demandId: string,
    input: {
      expectedVersion: number;
      responseStatus?: string | null;
      responseDate?: string | null;
      responseSummary?: string | null;
      status?: string | null;
    },
  ): Promise<DemandRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.demandManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.respondDemand(tx, {
        id: demandId,
        expectedVersion: input.expectedVersion,
        responseStatus: input.responseStatus ?? null,
        responseDate: input.responseDate ?? null,
        responseSummary: input.responseSummary ?? null,
        status: input.status ?? 'responded',
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Demand modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.demandResponded,
        entityType: 'recovery_demand',
        entityId: demandId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'DemandResponded', { recoveryId: upd.recovery_id });
      return upd;
    });
  }
  async listDemands(ctx: RequestContext, recoveryId: string): Promise<DemandRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.demandRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listDemands(tx, recoveryId));
  }

  // --- negotiations -----------------------------------------------------------------------------
  async openNegotiation(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: {
      partyRef?: string | null;
      openedDate?: string | null;
      positionSummary?: string | null;
      offeredAmountMinor?: number | null;
      currency?: string | null;
      confidentiality?: string;
    },
  ): Promise<NegotiationRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.negotiationManage);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    assertAmounts([input.offeredAmountMinor], ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const n = await this.repo.insertNegotiation(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        partyRef: input.partyRef ?? null,
        openedDate: input.openedDate ?? null,
        positionSummary: input.positionSummary ?? null,
        offeredAmountMinor: input.offeredAmountMinor ?? null,
        currency: input.currency ?? null,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.negotiationOpened,
        entityType: 'recovery_negotiation',
        entityId: n.id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'NegotiationOpened', { recoveryId });
      return n;
    });
  }
  async updateNegotiation(
    ctx: RequestContext,
    actor: string | null,
    negotiationId: string,
    input: {
      expectedVersion: number;
      positionSummary?: string | null;
      counterPosition?: string | null;
      offeredAmountMinor?: number | null;
      status?: string | null;
    },
  ): Promise<NegotiationRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.negotiationManage);
    assertAmounts([input.offeredAmountMinor], ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateNegotiation(tx, {
        id: negotiationId,
        expectedVersion: input.expectedVersion,
        positionSummary: input.positionSummary ?? null,
        counterPosition: input.counterPosition ?? null,
        offeredAmountMinor: input.offeredAmountMinor ?? null,
        status: input.status ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Negotiation not updatable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.negotiationOpened,
        entityType: 'recovery_negotiation',
        entityId: negotiationId,
        detail: {},
      });
      return upd;
    });
  }
  async closeNegotiation(
    ctx: RequestContext,
    actor: string | null,
    negotiationId: string,
    input: { expectedVersion: number; status?: string; outcome?: string | null; closedDate?: string | null },
  ): Promise<NegotiationRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.negotiationManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.closeNegotiation(tx, {
        id: negotiationId,
        expectedVersion: input.expectedVersion,
        status: input.status ?? 'closed',
        outcome: input.outcome ?? null,
        closedDate: input.closedDate ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Negotiation not closable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.negotiationClosed,
        entityType: 'recovery_negotiation',
        entityId: negotiationId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'NegotiationClosed', {
        recoveryId: upd.recovery_id,
        reasonCode: upd.status,
      });
      return upd;
    });
  }
  async listNegotiations(ctx: RequestContext, recoveryId: string): Promise<NegotiationRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.negotiationRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listNegotiations(tx, recoveryId));
  }

  // --- arrangements (maker-checker) -------------------------------------------------------------
  async proposeArrangement(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: {
      arrangementType: string;
      totalAmountMinor?: number | null;
      currency?: string | null;
      installmentCount?: number | null;
      installmentAmountMinor?: number | null;
      frequency?: string | null;
      startDate?: string | null;
      endDate?: string | null;
      termsSummary?: string | null;
      documentRef?: string | null;
      confidentiality?: string;
    },
  ): Promise<ArrangementRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.arrangementManage);
    if (!isArrangementType(input.arrangementType))
      throw badRequest('invalid arrangement type', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    assertAmounts([input.totalAmountMinor, input.installmentAmountMinor], ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const a = await this.repo.insertArrangement(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        arrangementType: input.arrangementType,
        totalAmountMinor: input.totalAmountMinor ?? null,
        currency: input.currency ?? null,
        installmentCount: input.installmentCount ?? null,
        installmentAmountMinor: input.installmentAmountMinor ?? null,
        frequency: input.frequency ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        termsSummary: input.termsSummary ?? null,
        proposedBy: actor,
        documentRef: input.documentRef ?? null,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.arrangementCreated,
        entityType: 'recovery_arrangement',
        entityId: a.id,
        detail: { arrangementType: input.arrangementType },
      });
      await this.publish(tx, ctx, actor, 'ArrangementCreated', { recoveryId });
      return a;
    });
  }
  async approveArrangement(
    ctx: RequestContext,
    actor: string | null,
    arrangementId: string,
    expectedVersion: number,
  ): Promise<ArrangementRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.arrangementApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const a = await this.repo.findArrangement(tx, arrangementId);
      if (a === null) throw ProblemError.notFound('Arrangement not found.', ctx.correlationId);
      if (a.proposed_by !== null && actor !== null && a.proposed_by === actor)
        throw ProblemError.conflict(
          'The arrangement proposer cannot approve it (segregation of duties).',
          ctx.correlationId,
        );
      const upd = await this.repo.approveArrangement(tx, {
        id: arrangementId,
        expectedVersion,
        approvedBy: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Arrangement not approvable or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.arrangementApproved,
        entityType: 'recovery_arrangement',
        entityId: arrangementId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'ArrangementActivated', { recoveryId: upd.recovery_id });
      return upd;
    });
  }
  async defaultArrangement(
    ctx: RequestContext,
    actor: string | null,
    arrangementId: string,
    input: { expectedVersion: number; reason?: string | null },
  ): Promise<ArrangementRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.arrangementManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.defaultArrangement(tx, {
        id: arrangementId,
        expectedVersion: input.expectedVersion,
        defaultReason: input.reason ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Arrangement not defaultable or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.arrangementDefaulted,
        entityType: 'recovery_arrangement',
        entityId: arrangementId,
        ...(input.reason != null ? { reason: input.reason } : {}),
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'ArrangementDefaulted', {
        recoveryId: upd.recovery_id,
        reasonCode: 'default',
      });
      return upd;
    });
  }
  async completeArrangement(
    ctx: RequestContext,
    actor: string | null,
    arrangementId: string,
    expectedVersion: number,
  ): Promise<ArrangementRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.arrangementManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.completeArrangement(tx, { id: arrangementId, expectedVersion, by: actor });
      if (upd === null)
        throw ProblemError.conflict(
          'Arrangement not completable or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.arrangementCompleted,
        entityType: 'recovery_arrangement',
        entityId: arrangementId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'ArrangementCompleted', { recoveryId: upd.recovery_id });
      return upd;
    });
  }
  async listArrangements(ctx: RequestContext, recoveryId: string): Promise<ArrangementRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.arrangementRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listArrangements(tx, recoveryId));
  }

  // --- installments (schedule metadata only; NO cash application) --------------------------------
  async addInstallment(
    ctx: RequestContext,
    actor: string | null,
    arrangementId: string,
    input: {
      recoveryId: string;
      sequenceNumber: number;
      dueDate?: string | null;
      expectedAmountMinor?: number | null;
      currency?: string | null;
    },
  ): Promise<InstallmentRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.installmentManage);
    assertAmounts([input.expectedAmountMinor], ctx.correlationId);
    if (!Number.isInteger(input.sequenceNumber) || input.sequenceNumber < 1)
      throw badRequest('sequenceNumber must be a positive integer', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireRecovery(tx, input.recoveryId, ctx.correlationId);
      const item = await this.repo.insertInstallment(tx, {
        tenantId: ctx.tenantId,
        arrangementId,
        recoveryId: input.recoveryId,
        sequenceNumber: input.sequenceNumber,
        dueDate: input.dueDate ?? null,
        expectedAmountMinor: input.expectedAmountMinor ?? null,
        currency: input.currency ?? null,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.installmentRecorded,
        entityType: 'recovery_installment',
        entityId: item.id,
        detail: { arrangementId, sequenceNumber: input.sequenceNumber },
      });
      return item;
    });
  }
  /** Records an installment as met/missed and links a receipt REFERENCE — NO cash application (ADR-071). */
  async recordInstallment(
    ctx: RequestContext,
    actor: string | null,
    installmentId: string,
    input: {
      expectedVersion: number;
      status: 'met' | 'missed';
      receiptRef?: string | null;
      paidDate?: string | null;
      note?: string | null;
    },
  ): Promise<InstallmentRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.installmentManage);
    if (input.status !== 'met' && input.status !== 'missed')
      throw badRequest("installment status must be 'met' or 'missed'", ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.recordInstallment(tx, {
        id: installmentId,
        expectedVersion: input.expectedVersion,
        status: input.status,
        receiptRef: input.receiptRef ?? null,
        paidDate: input.paidDate ?? null,
        note: input.note ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Installment not recordable or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.installmentRecorded,
        entityType: 'recovery_installment',
        entityId: installmentId,
        detail: { status: input.status },
      });
      await this.publish(tx, ctx, actor, 'InstallmentRecorded', {
        recoveryId: upd.recovery_id,
        reasonCode: input.status,
      });
      return upd;
    });
  }
  async listInstallments(ctx: RequestContext, arrangementId: string): Promise<InstallmentRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.installmentRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listInstallments(tx, arrangementId));
  }

  // --- enforcement actions ----------------------------------------------------------------------
  async initiateEnforcement(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: {
      actionType: string;
      forum?: string | null;
      reference?: string | null;
      initiatedDate?: string | null;
      targetAssetRef?: string | null;
      targetPartyRef?: string | null;
      expectedAmountMinor?: number | null;
      currency?: string | null;
      agentRef?: string | null;
      confidentiality?: string;
    },
  ): Promise<EnforcementActionRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.enforcementManage);
    if (!isEnforcementActionType(input.actionType))
      throw badRequest('invalid enforcement action type', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    assertAmounts([input.expectedAmountMinor], ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const e = await this.repo.insertEnforcement(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        actionType: input.actionType,
        forum: input.forum ?? null,
        reference: input.reference ?? null,
        initiatedDate: input.initiatedDate ?? null,
        targetAssetRef: input.targetAssetRef ?? null,
        targetPartyRef: input.targetPartyRef ?? null,
        expectedAmountMinor: input.expectedAmountMinor ?? null,
        currency: input.currency ?? null,
        agentRef: input.agentRef ?? null,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.enforcementInitiated,
        entityType: 'recovery_enforcement_action',
        entityId: e.id,
        detail: { actionType: input.actionType },
      });
      await this.publish(tx, ctx, actor, 'EnforcementActionInitiated', {
        recoveryId,
        enforcementStage: input.actionType,
      });
      return e;
    });
  }
  async updateEnforcement(
    ctx: RequestContext,
    actor: string | null,
    enforcementId: string,
    input: {
      expectedVersion: number;
      status?: string | null;
      reference?: string | null;
      outcome?: string | null;
    },
  ): Promise<EnforcementActionRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.enforcementManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateEnforcement(tx, {
        id: enforcementId,
        expectedVersion: input.expectedVersion,
        status: input.status ?? null,
        reference: input.reference ?? null,
        outcome: input.outcome ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Enforcement not updatable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.enforcementUpdated,
        entityType: 'recovery_enforcement_action',
        entityId: enforcementId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'EnforcementActionUpdated', {
        recoveryId: upd.recovery_id,
        enforcementStage: upd.action_type,
      });
      return upd;
    });
  }
  async completeEnforcement(
    ctx: RequestContext,
    actor: string | null,
    enforcementId: string,
    input: { expectedVersion: number; outcome?: string | null },
  ): Promise<EnforcementActionRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.enforcementManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.completeEnforcement(tx, {
        id: enforcementId,
        expectedVersion: input.expectedVersion,
        outcome: input.outcome ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Enforcement not completable or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.enforcementCompleted,
        entityType: 'recovery_enforcement_action',
        entityId: enforcementId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'EnforcementActionCompleted', {
        recoveryId: upd.recovery_id,
        enforcementStage: upd.action_type,
      });
      return upd;
    });
  }
  async listEnforcements(ctx: RequestContext, recoveryId: string): Promise<EnforcementActionRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.enforcementRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listEnforcements(tx, recoveryId));
  }

  // --- security (single-winner realize) ---------------------------------------------------------
  async registerSecurity(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: {
      securityType: string;
      description?: string | null;
      assetRef?: string | null;
      registrationReference?: string | null;
      chargePriority?: string | null;
      estimatedValueMinor?: number | null;
      forcedSaleValueMinor?: number | null;
      currency?: string | null;
      valuationDate?: string | null;
      valuationRef?: string | null;
      confidentiality?: string;
    },
  ): Promise<SecurityRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.securityManage);
    if (!isSecurityType(input.securityType)) throw badRequest('invalid security type', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    assertAmounts([input.estimatedValueMinor, input.forcedSaleValueMinor], ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const s = await this.repo.insertSecurity(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        securityType: input.securityType,
        description: input.description ?? null,
        assetRef: input.assetRef ?? null,
        registrationReference: input.registrationReference ?? null,
        chargePriority: input.chargePriority ?? null,
        estimatedValueMinor: input.estimatedValueMinor ?? null,
        forcedSaleValueMinor: input.forcedSaleValueMinor ?? null,
        currency: input.currency ?? null,
        valuationDate: input.valuationDate ?? null,
        valuationRef: input.valuationRef ?? null,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.securityRegistered,
        entityType: 'recovery_security',
        entityId: s.id,
        detail: { securityType: input.securityType },
      });
      await this.publish(tx, ctx, actor, 'SecurityRegistered', { recoveryId });
      return s;
    });
  }
  /** Records a realized amount as a REFERENCE (single-winner). No cash application/reconciliation (ADR-071). */
  async realizeSecurity(
    ctx: RequestContext,
    actor: string | null,
    securityId: string,
    input: { expectedVersion: number; realizedAmountMinor?: number | null; realizedDate?: string | null },
  ): Promise<SecurityRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.securityRealize);
    assertAmounts([input.realizedAmountMinor], ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.realizeSecurity(tx, {
        id: securityId,
        expectedVersion: input.expectedVersion,
        realizedAmountMinor: input.realizedAmountMinor ?? null,
        realizedDate: input.realizedDate ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Security not realizable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.securityRealized,
        entityType: 'recovery_security',
        entityId: securityId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'SecurityRealized', {
        recoveryId: upd.recovery_id,
        ...(input.realizedAmountMinor != null ? { amountMinor: input.realizedAmountMinor } : {}),
      });
      return upd;
    });
  }
  async listSecurities(ctx: RequestContext, recoveryId: string): Promise<SecurityRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.securityRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listSecurities(tx, recoveryId));
  }

  // --- external agents --------------------------------------------------------------------------
  async instructAgent(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: {
      agentRef?: string | null;
      agentType?: string | null;
      engagementReference?: string | null;
      instructionScope?: string | null;
      feeArrangementReference?: string | null;
      reportingFrequency?: string | null;
      nextReportDue?: string | null;
      confidentiality?: string;
    },
  ): Promise<AgentRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.agentManage);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const a = await this.repo.insertAgent(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        agentRef: input.agentRef ?? null,
        agentType: input.agentType ?? null,
        engagementReference: input.engagementReference ?? null,
        instructionScope: input.instructionScope ?? null,
        feeArrangementReference: input.feeArrangementReference ?? null,
        reportingFrequency: input.reportingFrequency ?? null,
        nextReportDue: input.nextReportDue ?? null,
        internalOwner: actor,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.agentInstructed,
        entityType: 'recovery_agent',
        entityId: a.id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'AgentInstructed', { recoveryId });
      return a;
    });
  }
  async updateAgent(
    ctx: RequestContext,
    actor: string | null,
    agentId: string,
    input: {
      expectedVersion: number;
      status?: string | null;
      reportingFrequency?: string | null;
      nextReportDue?: string | null;
      performanceNote?: string | null;
    },
  ): Promise<AgentRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.agentManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateAgent(tx, {
        id: agentId,
        expectedVersion: input.expectedVersion,
        status: input.status ?? null,
        reportingFrequency: input.reportingFrequency ?? null,
        nextReportDue: input.nextReportDue ?? null,
        performanceNote: input.performanceNote ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Agent not updatable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.agentInstructed,
        entityType: 'recovery_agent',
        entityId: agentId,
        detail: {},
      });
      return upd;
    });
  }
  async terminateAgent(
    ctx: RequestContext,
    actor: string | null,
    agentId: string,
    expectedVersion: number,
  ): Promise<AgentRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.agentManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.terminateAgent(tx, { id: agentId, expectedVersion, by: actor });
      if (upd === null)
        throw ProblemError.conflict('Agent not terminable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.agentTerminated,
        entityType: 'recovery_agent',
        entityId: agentId,
        detail: {},
      });
      return upd;
    });
  }
  async listAgents(ctx: RequestContext, recoveryId: string): Promise<AgentRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.agentRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listAgents(tx, recoveryId));
  }

  // --- agent reports (append-only) --------------------------------------------------------------
  async addAgentReport(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: {
      agentId?: string | null;
      reportingPeriod?: string | null;
      statusSummary?: string | null;
      actionTaken?: string | null;
      nextAction?: string | null;
      amountCollectedMinor?: number | null;
      currency?: string | null;
      reportDate?: string | null;
      documentRef?: string | null;
      confidentiality?: string;
    },
  ): Promise<AgentReportRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.agentReportManage);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    assertAmounts([input.amountCollectedMinor], ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const r = await this.repo.insertAgentReport(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        agentId: input.agentId ?? null,
        reportingPeriod: input.reportingPeriod ?? null,
        statusSummary: input.statusSummary ?? null,
        actionTaken: input.actionTaken ?? null,
        nextAction: input.nextAction ?? null,
        amountCollectedMinor: input.amountCollectedMinor ?? null,
        currency: input.currency ?? null,
        reportDate: input.reportDate ?? null,
        documentRef: input.documentRef ?? null,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.agentReportReceived,
        entityType: 'recovery_agent_report',
        entityId: r.id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'AgentReportReceived', {
        recoveryId,
        ...(input.amountCollectedMinor != null ? { amountMinor: input.amountCollectedMinor } : {}),
      });
      return r;
    });
  }
  async listAgentReports(ctx: RequestContext, recoveryId: string): Promise<AgentReportRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.agentReportRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listAgentReports(tx, recoveryId));
  }

  // --- receipts (append-only, REFERENCE only) ---------------------------------------------------
  async recordReceipt(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: {
      receiptType: string;
      externalReference?: string | null;
      amountMinor?: number | null;
      currency?: string | null;
      receivedDate?: string | null;
      partyRef?: string | null;
      arrangementRef?: string | null;
      enforcementActionRef?: string | null;
      securityRef?: string | null;
      financeReference?: string | null;
      documentRef?: string | null;
      confidentiality?: string;
      recoveredAmountMinor?: number | null;
      outstandingAmountMinor?: number | null;
      expectedVersion?: number;
    },
  ): Promise<ReceiptRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.receiptManage);
    if (!isReceiptType(input.receiptType)) throw badRequest('invalid receipt type', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    assertAmounts(
      [input.amountMinor, input.recoveredAmountMinor, input.outstandingAmountMinor],
      ctx.correlationId,
    );
    return this.db.withTenant(ctx, async (tx) => {
      const rec = await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const r = await this.repo.insertReceipt(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        receiptType: input.receiptType,
        externalReference: input.externalReference ?? null,
        amountMinor: input.amountMinor ?? null,
        currency: input.currency ?? null,
        receivedDate: input.receivedDate ?? null,
        partyRef: input.partyRef ?? null,
        arrangementRef: input.arrangementRef ?? null,
        enforcementActionRef: input.enforcementActionRef ?? null,
        securityRef: input.securityRef ?? null,
        financeReference: input.financeReference ?? null,
        documentRef: input.documentRef ?? null,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      // Optional REFERENCE tallies only — never a ledger posting / cash application (ADR-071).
      if (input.recoveredAmountMinor != null || input.outstandingAmountMinor != null)
        await this.repo.patchRecovery(tx, {
          id: recoveryId,
          expectedVersion: input.expectedVersion ?? rec.version,
          recoveredAmountMinor: input.recoveredAmountMinor ?? null,
          outstandingAmountMinor: input.outstandingAmountMinor ?? null,
          by: actor,
        });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.receiptRecorded,
        entityType: 'recovery_receipt',
        entityId: r.id,
        detail: { receiptType: input.receiptType },
      });
      await this.publish(tx, ctx, actor, 'ReceiptRecorded', {
        recoveryId,
        ...(input.amountMinor != null ? { amountMinor: input.amountMinor } : {}),
      });
      return r;
    });
  }
  async listReceipts(ctx: RequestContext, recoveryId: string): Promise<ReceiptRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.receiptRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listReceipts(tx, recoveryId));
  }

  // --- waivers (append-only) --------------------------------------------------------------------
  async grantWaiver(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: {
      waiverType?: string | null;
      amountMinor?: number | null;
      currency?: string | null;
      reason?: string | null;
      authority?: string | null;
      grantedDate?: string | null;
      documentRef?: string | null;
      confidentiality?: string;
    },
  ): Promise<WaiverRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.waiverGrant);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    assertAmounts([input.amountMinor], ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const w = await this.repo.insertWaiver(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        waiverType: input.waiverType ?? null,
        amountMinor: input.amountMinor ?? null,
        currency: input.currency ?? null,
        reason: input.reason ?? null,
        grantedBy: actor,
        authority: input.authority ?? null,
        grantedDate: input.grantedDate ?? null,
        documentRef: input.documentRef ?? null,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.waiverGranted,
        entityType: 'recovery_waiver',
        entityId: w.id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'WaiverGranted', {
        recoveryId,
        ...(input.amountMinor != null ? { amountMinor: input.amountMinor } : {}),
      });
      return w;
    });
  }
  async listWaivers(ctx: RequestContext, recoveryId: string): Promise<WaiverRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.waiverRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listWaivers(tx, recoveryId));
  }

  // --- write-off recommendations (maker-checker; RECOMMENDATION only, NO accounting) ------------
  async recommendWriteOff(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: {
      reasonCode: string;
      amountMinor?: number | null;
      currency?: string | null;
      narrative?: string | null;
      recommendedDate?: string | null;
      documentRef?: string | null;
      confidentiality?: string;
    },
  ): Promise<WriteoffRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.writeoffRecommend);
    if (!isWriteOffReason(input.reasonCode)) throw badRequest('invalid write-off reason', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    assertAmounts([input.amountMinor], ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const rec = await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const w = await this.repo.insertWriteOff(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        reasonCode: input.reasonCode,
        amountMinor: input.amountMinor ?? null,
        currency: input.currency ?? null,
        narrative: input.narrative ?? null,
        recommendedBy: actor,
        recommendedDate: input.recommendedDate ?? null,
        documentRef: input.documentRef ?? null,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.patchRecovery(tx, {
        id: recoveryId,
        expectedVersion: rec.version,
        writeOffRecommended: true,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.writeoffRecommended,
        entityType: 'recovery_writeoff_recommendation',
        entityId: w.id,
        detail: { reasonCode: input.reasonCode },
      });
      await this.publish(tx, ctx, actor, 'WriteOffRecommended', {
        recoveryId,
        reasonCode: input.reasonCode,
        ...(input.amountMinor != null ? { amountMinor: input.amountMinor } : {}),
      });
      return w;
    });
  }
  /** Maker-checker approval of a write-off RECOMMENDATION — approver <> recommender. No accounting posting. */
  async approveWriteOff(
    ctx: RequestContext,
    actor: string | null,
    writeoffId: string,
    input: { expectedVersion: number; decision?: 'approved' | 'rejected'; financeReference?: string | null },
  ): Promise<WriteoffRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.writeoffApprove);
    const decision = input.decision ?? 'approved';
    return this.db.withTenant(ctx, async (tx) => {
      const w = await this.repo.findWriteOff(tx, writeoffId);
      if (w === null) throw ProblemError.notFound('Write-off recommendation not found.', ctx.correlationId);
      if (w.recommended_by !== null && actor !== null && w.recommended_by === actor)
        throw ProblemError.conflict(
          'The write-off recommender cannot approve it (segregation of duties).',
          ctx.correlationId,
        );
      const upd = await this.repo.approveWriteOff(tx, {
        id: writeoffId,
        expectedVersion: input.expectedVersion,
        decision,
        approvedBy: actor,
        financeReference: input.financeReference ?? null,
      });
      if (upd === null)
        throw ProblemError.conflict('Write-off not approvable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.writeoffApproved,
        entityType: 'recovery_writeoff_recommendation',
        entityId: writeoffId,
        detail: { decision },
      });
      await this.publish(tx, ctx, actor, 'WriteOffApproved', {
        recoveryId: upd.recovery_id,
        reasonCode: decision,
      });
      return upd;
    });
  }
  async listWriteOffs(ctx: RequestContext, recoveryId: string): Promise<WriteoffRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.writeoffRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listWriteOffs(tx, recoveryId));
  }

  // --- outcomes (append-only) -------------------------------------------------------------------
  async recordOutcome(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: {
      outcomeType: string;
      outcomeDate?: string | null;
      summary?: string | null;
      recoveredAmountMinor?: number | null;
      waivedAmountMinor?: number | null;
      writtenOffAmountMinor?: number | null;
      outstandingAmountMinor?: number | null;
      currency?: string | null;
      documentRef?: string | null;
      confidentiality?: string;
    },
  ): Promise<OutcomeRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.outcomeManage);
    if (!isOutcomeType(input.outcomeType)) throw badRequest('invalid outcome type', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    assertAmounts(
      [
        input.recoveredAmountMinor,
        input.waivedAmountMinor,
        input.writtenOffAmountMinor,
        input.outstandingAmountMinor,
      ],
      ctx.correlationId,
    );
    return this.db.withTenant(ctx, async (tx) => {
      const rec = await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const o = await this.repo.insertOutcome(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        outcomeType: input.outcomeType,
        outcomeDate: input.outcomeDate ?? null,
        summary: input.summary ?? null,
        recoveredAmountMinor: input.recoveredAmountMinor ?? null,
        waivedAmountMinor: input.waivedAmountMinor ?? null,
        writtenOffAmountMinor: input.writtenOffAmountMinor ?? null,
        outstandingAmountMinor: input.outstandingAmountMinor ?? null,
        currency: input.currency ?? null,
        documentRef: input.documentRef ?? null,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.patchRecovery(tx, {
        id: recoveryId,
        expectedVersion: rec.version,
        finalOutcome: input.outcomeType,
        ...(input.recoveredAmountMinor != null ? { recoveredAmountMinor: input.recoveredAmountMinor } : {}),
        ...(input.outstandingAmountMinor != null
          ? { outstandingAmountMinor: input.outstandingAmountMinor }
          : {}),
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.outcomeRecorded,
        entityType: 'recovery_outcome',
        entityId: o.id,
        detail: { outcomeType: input.outcomeType },
      });
      await this.publish(tx, ctx, actor, 'OutcomeRecorded', {
        recoveryId,
        reasonCode: input.outcomeType,
        ...(input.recoveredAmountMinor != null ? { amountMinor: input.recoveredAmountMinor } : {}),
      });
      return o;
    });
  }
  async listOutcomes(ctx: RequestContext, recoveryId: string): Promise<OutcomeRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.outcomeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listOutcomes(tx, recoveryId));
  }

  // --- deadlines (deterministic; limitation is high-risk) ---------------------------------------
  async addDeadline(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: {
      deadlineType: string;
      rule: DeadlineRule;
      startAt?: string | null;
      source?: string | null;
      authority?: string | null;
      warnWindowMs?: number | null;
      relatedDemand?: string | null;
      relatedArrangement?: string | null;
      relatedEnforcement?: string | null;
    },
  ): Promise<DeadlineRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.deadlineManage);
    if (!isDeadlineType(input.deadlineType)) throw badRequest('invalid deadline type', ctx.correlationId);
    const startMs = input.startAt != null ? Date.parse(input.startAt) : this.clock.now();
    const dueMs = computeDeadlineDueMs({ type: input.deadlineType, startMs, rule: input.rule });
    if (!isLimitationSafe(input.deadlineType, dueMs, this.clock.now()))
      throw badRequest('a limitation deadline cannot be in the past', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const rec = await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const d = await this.repo.insertDeadline(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        deadlineType: input.deadlineType,
        startAt: iso(startMs),
        dueAt: iso(dueMs),
        rule: input.rule,
        source: input.source ?? null,
        authority: input.authority ?? null,
        warnWindowMs: input.warnWindowMs ?? null,
        relatedDemand: input.relatedDemand ?? null,
        relatedArrangement: input.relatedArrangement ?? null,
        relatedEnforcement: input.relatedEnforcement ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      if (input.deadlineType === 'limitation')
        await this.repo.patchRecovery(tx, {
          id: recoveryId,
          expectedVersion: rec.version,
          limitationAt: iso(dueMs),
          by: actor,
        });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.deadlineCreated,
        entityType: 'recovery_deadline',
        entityId: d.id,
        detail: { deadlineType: input.deadlineType },
      });
      await this.publish(tx, ctx, actor, 'DeadlineCreated', { recoveryId, dueAt: iso(dueMs) });
      return d;
    });
  }
  async extendDeadline(
    ctx: RequestContext,
    actor: string | null,
    deadlineId: string,
    input: { expectedVersion: number; extensionTo: string; reason?: string | null },
  ): Promise<DeadlineRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.deadlineManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.extendDeadline(tx, {
        id: deadlineId,
        expectedVersion: input.expectedVersion,
        extensionTo: input.extensionTo,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Deadline not extendable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.deadlineExtended,
        entityType: 'recovery_deadline',
        entityId: deadlineId,
        ...(input.reason != null ? { reason: input.reason } : {}),
        detail: {},
      });
      return upd;
    });
  }
  async evaluateDeadline(
    ctx: RequestContext,
    actor: string | null,
    deadlineId: string,
  ): Promise<{ breached: boolean }> {
    await this.authz.require(ctx, M17_PERMISSIONS.deadlineManage);
    return this.db.withTenant(ctx, async (tx) => {
      const d = await this.repo.findDeadline(tx, deadlineId);
      if (d === null) throw ProblemError.notFound('Deadline not found.', ctx.correlationId);
      if (d.status !== 'open' && d.status !== 'extended') return { breached: d.status === 'breached' };
      const state = deadlineState({
        dueMs: Date.parse(d.due_at),
        nowMs: this.clock.now(),
        warnWindowMs: d.warn_window_ms != null ? Number(d.warn_window_ms) : 0,
      });
      if (!state.breached) return { breached: false };
      const upd = await this.repo.markDeadlineBreach(tx, deadlineId);
      if (upd === null) return { breached: true };
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.deadlineBreached,
        entityType: 'recovery_deadline',
        entityId: deadlineId,
        detail: { deadlineType: d.deadline_type },
      });
      await this.publish(tx, ctx, actor, 'DeadlineBreached', {
        recoveryId: d.recovery_id,
        reasonCode: d.deadline_type,
      });
      return { breached: true };
    });
  }
  async listDeadlines(ctx: RequestContext, recoveryId: string): Promise<DeadlineRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.deadlineRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listDeadlines(tx, recoveryId));
  }

  // --- cost references (references only) --------------------------------------------------------
  async recordCost(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: {
      costType?: string | null;
      description?: string | null;
      amountMinor?: number | null;
      currency?: string | null;
      agentReference?: string | null;
      invoiceReference?: string | null;
      recoverable?: boolean;
    },
  ): Promise<CostRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.costManage);
    if (input.costType != null && !isCostType(input.costType))
      throw badRequest('invalid cost type', ctx.correlationId);
    assertAmounts([input.amountMinor], ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const c = await this.repo.insertCost(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        costType: input.costType ?? null,
        description: input.description ?? null,
        amountMinor: input.amountMinor ?? null,
        currency: input.currency ?? null,
        agentReference: input.agentReference ?? null,
        invoiceReference: input.invoiceReference ?? null,
        recoverable: input.recoverable === true,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.costRecorded,
        entityType: 'recovery_cost_reference',
        entityId: c.id,
        detail: {},
      });
      return c;
    });
  }
  async listCosts(ctx: RequestContext, recoveryId: string): Promise<CostRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.costRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listCosts(tx, recoveryId));
  }

  // --- notes (privileged redaction) -------------------------------------------------------------
  async addNote(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: { noteType?: string; headline?: string | null; content: string; confidentiality?: string },
  ): Promise<NoteRow> {
    const noteType = input.noteType ?? 'general';
    if (!isNoteType(noteType)) throw badRequest('invalid note type', ctx.correlationId);
    const restricted = isRestrictedNote(noteType);
    await this.authz.require(
      ctx,
      restricted ? M17_PERMISSIONS.privilegedCreate : M17_PERMISSIONS.recoveryUpdate,
    );
    if (input.content.trim() === '' || input.content.length > RECOVERY_LIMITS.maxNoteChars)
      throw badRequest('note content is required and must be bounded', ctx.correlationId);
    const conf = input.confidentiality ?? (restricted ? 'privileged' : 'standard');
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const n = await this.repo.insertNote(tx, {
        tenantId: ctx.tenantId,
        recoveryId,
        noteType,
        headline: input.headline ?? null,
        content: input.content,
        privileged: restricted,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      // Note CONTENT never enters the event/audit payload (ADR-072).
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.noteCreated,
        entityType: 'recovery_note',
        entityId: n.id,
        detail: { noteType, restricted },
      });
      return n;
    });
  }
  async listNotes(
    ctx: RequestContext,
    recoveryId: string,
  ): Promise<{ notes: NoteRow[]; canReadPrivileged: boolean }> {
    await this.authz.require(ctx, M17_PERMISSIONS.recoveryRead);
    const canReadPrivileged = await this.authz.can(ctx, M17_PERMISSIONS.privilegedRead);
    const all = await this.db.withTenant(ctx, (tx) => this.repo.listNotes(tx, recoveryId));
    const notes = canReadPrivileged ? all : all.filter((n) => !n.privileged);
    if (canReadPrivileged && all.some((n) => n.privileged))
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M17_AUDIT_CODES.privilegedAccessed,
          entityType: 'recovery_note',
          entityId: recoveryId,
          detail: {},
        }),
      );
    return { notes, canReadPrivileged };
  }

  // --- relationships ----------------------------------------------------------------------------
  async link(
    ctx: RequestContext,
    actor: string | null,
    input: { fromRecoveryId: string; toRecoveryId: string; kind: string },
  ): Promise<RelationshipRow> {
    await this.authz.require(ctx, M17_PERMISSIONS.recoveryUpdate);
    if (!isRelationshipKind(input.kind)) throw badRequest('invalid relationship kind', ctx.correlationId);
    if (isSelfRelation(input.fromRecoveryId, input.toRecoveryId))
      throw badRequest('a recovery cannot relate to itself', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const from = await this.repo.findRecovery(tx, input.fromRecoveryId);
      const to = await this.repo.findRecovery(tx, input.toRecoveryId);
      if (from === null || to === null)
        throw ProblemError.notFound('Both recoveries must exist in this tenant.', ctx.correlationId);
      if (
        input.kind === 'duplicate_of' ||
        input.kind === 'consolidated_with' ||
        input.kind === 'parent_of' ||
        input.kind === 'child_of'
      ) {
        const reverse = await this.repo.findReverseRelationship(
          tx,
          input.fromRecoveryId,
          input.toRecoveryId,
          input.kind === 'parent_of' ? 'child_of' : input.kind === 'child_of' ? 'parent_of' : input.kind,
        );
        if (reverse !== null)
          throw ProblemError.conflict(
            'The reverse relationship already exists (cycle rejected).',
            ctx.correlationId,
          );
      }
      const row = await this.repo.insertRelationship(tx, {
        tenantId: ctx.tenantId,
        fromId: input.fromRecoveryId,
        toId: input.toRecoveryId,
        kind: input.kind,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.relationshipCreated,
        entityType: 'recovery_relationship',
        entityId: row.id,
        detail: { kind: input.kind },
      });
      return row;
    });
  }
  async listRelationships(ctx: RequestContext, recoveryId: string): Promise<RelationshipRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.recoveryRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRelationships(tx, recoveryId));
  }

  // --- deterministic SLA (materializes stage deadlines) -----------------------------------------
  async startSla(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    policyCode: string,
  ): Promise<DeadlineRow[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.deadlineManage);
    return this.db.withTenant(ctx, async (tx) => {
      const rec = await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const policy = await this.repo.findActiveSlaPolicy(tx, policyCode);
      if (policy === null)
        throw ProblemError.conflict('No active SLA policy for that code.', ctx.correlationId);
      const spec = policy.spec as RecoverySlaPolicySpec;
      const startMs = this.clock.now();
      const due = computeDueDates(spec, startMs);
      const stages: { type: string; ms: number }[] = [
        { type: 'internal_action', ms: due.ackAtMs },
        { type: 'review', ms: due.strategyAtMs },
        { type: 'demand_response', ms: due.demandAtMs },
        { type: 'statutory_period', ms: due.responseAtMs },
        { type: 'arrangement_review', ms: due.arrangementReviewAtMs },
        { type: 'enforcement_filing', ms: due.enforcementFilingAtMs },
        { type: 'agent_report', ms: due.agentReportAtMs },
        { type: 'review', ms: due.reviewAtMs },
        { type: 'closure', ms: due.closureAtMs },
      ];
      const rows: DeadlineRow[] = [];
      for (const st of stages) {
        rows.push(
          await this.repo.insertDeadline(tx, {
            tenantId: ctx.tenantId,
            recoveryId,
            deadlineType: st.type,
            startAt: iso(startMs),
            dueAt: iso(st.ms),
            rule: { kind: 'explicit', dueMs: st.ms },
            source: policyCode,
            authority: null,
            warnWindowMs: null,
            relatedDemand: null,
            relatedArrangement: null,
            relatedEnforcement: null,
            correlationId: ctx.correlationId,
            by: actor,
          }),
        );
      }
      await this.repo.patchRecovery(tx, {
        id: recoveryId,
        expectedVersion: rec.version,
        slaPolicyCode: policyCode,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.slaStarted,
        entityType: 'recovery_case',
        entityId: recoveryId,
        detail: { policyCode },
      });
      return rows;
    });
  }

  // --- escalation (reuses m08 via an event; m17 builds no second escalation engine) -------------
  async triggerEscalation(
    ctx: RequestContext,
    actor: string | null,
    recoveryId: string,
    input: { reason: string },
  ): Promise<string> {
    await this.authz.require(ctx, M17_PERMISSIONS.recoveryUpdate);
    if (input.reason.trim() === '') throw badRequest('a reason is required to escalate', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const rec = await this.requireRecovery(tx, recoveryId, ctx.correlationId);
      const escalationRef = rec.escalation_ref ?? randomUUID();
      await this.repo.patchRecovery(tx, {
        id: recoveryId,
        expectedVersion: rec.version,
        escalationRef,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.escalationTriggered,
        entityType: 'recovery_case',
        entityId: recoveryId,
        reason: input.reason,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'RecoveryEscalated', {
        recoveryId,
        ...(rec.recovery_risk != null ? { riskRating: rec.recovery_risk } : {}),
        reasonCode: 'manual',
      });
      return escalationRef;
    });
  }

  // --- analytics --------------------------------------------------------------------------------
  async analytics(ctx: RequestContext, dimension: string): Promise<{ dim: string | null; count: string }[]> {
    await this.authz.require(ctx, M17_PERMISSIONS.analyticsRead);
    return this.db.withTenant(ctx, (tx) => this.repo.analyticsByDimension(tx, dimension));
  }
}
