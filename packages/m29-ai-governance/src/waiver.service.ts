/**
 * AiWaiverService — controlled EXCEPTION / OVERRIDE governance. A waiver is a governed release-exception
 * (subject_kind='waiver_exception') with a requester, a scope, an expiry and a compensating control. THE RULES: an
 * ABSOLUTE control (no-production-provider, no-secret, no-restricted-data, no-AI-controlled-action, no-AI-self-approval,
 * human-review) can NEVER be waived — the request is refused and audited (AI_GOVERNANCE_OVERRIDE_BLOCKED); the requester
 * cannot self-approve and AI can never approve (`evaluateWaiverGate` — SoD, human, fail closed). Approval requires the
 * privileged ai.governance.override. A waiver never bypasses an absolute control and an expired waiver has no effect.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M29_PERMISSIONS } from './permissions.ts';
import { M29_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden } from './errors.ts';
import {
  checkReleaseTransition,
  evaluateWaiverGate,
  isAbsoluteControl,
  isHumanActor,
  isRiskTier,
  REASON_CODES,
  type ReleaseStatus,
} from './domain.ts';
import { AiGovernanceRepository, type ReleaseRow } from './repository.ts';
import type { M29Emitter } from './emit.ts';

export class AiWaiverService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M29Emitter;
  private readonly repo: AiGovernanceRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M29Emitter,
    repo: AiGovernanceRepository = new AiGovernanceRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async requestWaiver(
    ctx: RequestContext,
    actor: string | null,
    input: {
      controlCode: string;
      useCaseId?: string | null;
      subjectRef?: string | null;
      riskTier?: string;
      reason: string;
      expiresAt?: string | null;
      compensatingControlRef?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<ReleaseRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceOverride);
    if (!isHumanActor(actor)) throw badRequest('a human requester is required.', ctx.correlationId);
    if (input.reason.trim() === '') throw badRequest('a waiver reason is required.', ctx.correlationId);
    const riskTier = input.riskTier ?? 'high';
    if (!isRiskTier(riskTier)) throw badRequest('unknown risk tier.', ctx.correlationId);

    // ABSOLUTE controls can NEVER be waived — refuse the request (durably audited) and fail closed.
    if (isAbsoluteControl(input.controlCode)) {
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M29_AUDIT_CODES.overrideBlocked,
          entityType: 'ai_governance_release',
          entityId: input.controlCode,
          detail: { controlCode: input.controlCode, reasonCode: REASON_CODES.absoluteControlNotWaivable },
        }),
      );
      throw governanceForbidden(REASON_CODES.absoluteControlNotWaivable, ctx.correlationId);
    }

    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findReleaseByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      let waiver = await this.repo.insertRelease(tx, {
        tenantId: ctx.tenantId,
        useCaseId: input.useCaseId ?? null,
        subjectKind: 'waiver_exception',
        subjectRef: input.subjectRef ?? null,
        riskTier,
        proposedBy: actor,
        providerRestricted: false,
        expiresAt: input.expiresAt ?? null,
        compensatingControlRef: input.compensatingControlRef ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      if (input.idempotencyKey != null && input.idempotencyKey !== '')
        await this.repo.insertIdempotency(tx, {
          tenantId: ctx.tenantId,
          idempotencyKey: input.idempotencyKey,
          releaseId: waiver.id,
          correlationId: ctx.correlationId,
          by: actor,
        });
      // draft -> review_pending (a waiver carries no model evaluation; it is judged on its compensating control).
      waiver = await this.moveWaiver(
        ctx,
        tx,
        waiver,
        'assessment',
        REASON_CODES.waiverRequested,
        actor,
        null,
        input.reason,
      );
      waiver = await this.moveWaiver(
        ctx,
        tx,
        waiver,
        'evaluation_pending',
        REASON_CODES.waiverRequested,
        actor,
        null,
        null,
      );
      waiver = await this.moveWaiver(
        ctx,
        tx,
        waiver,
        'review_pending',
        REASON_CODES.waiverRequested,
        actor,
        null,
        null,
      );
      await this.emitter.recordAudit(tx, ctx, {
        code: M29_AUDIT_CODES.waiverRequested,
        entityType: 'ai_governance_release',
        entityId: waiver.id,
        detail: { controlCode: input.controlCode, riskTier },
      });
      return waiver;
    });
  }

  async approveWaiver(
    ctx: RequestContext,
    actor: string | null,
    waiverId: string,
    expectedVersion: number,
    input?: { reason?: string | null },
  ): Promise<ReleaseRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceOverride);
    // No AI self-approval: the waiver approver must be a HUMAN (never null/system) — checked before the gate too.
    if (!isHumanActor(actor))
      throw governanceForbidden(REASON_CODES.aiSelfApprovalForbidden, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const waiver = await this.repo.findRelease(tx, waiverId);
      if (waiver === null) throw ProblemError.notFound('Waiver not found.', ctx.correlationId);
      if (waiver.subject_kind !== 'waiver_exception') throw badRequest('not a waiver.', ctx.correlationId);
      if (waiver.version !== expectedVersion)
        throw ProblemError.conflict('Waiver modified concurrently.', ctx.correlationId);
      // SoD: the requester cannot self-approve; AI can never approve (fail closed before the DB CHECK).
      const gate = evaluateWaiverGate({
        requestedBy: waiver.proposed_by,
        approverId: actor,
        targetsAbsoluteControl: false,
      });
      if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      const t = checkReleaseTransition(waiver.status, 'approved');
      if (!t.ok) throw badRequest(`a ${waiver.status} waiver cannot be approved.`, ctx.correlationId);
      const updated = await this.moveWaiver(
        ctx,
        tx,
        waiver,
        'approved',
        REASON_CODES.waiverApproved,
        actor,
        actor,
        input?.reason ?? null,
      );
      await this.repo.insertDecision(tx, {
        tenantId: ctx.tenantId,
        targetType: 'waiver',
        targetId: waiverId,
        decision: 'approve',
        decider: actor,
        reason: input?.reason ?? null,
        reasonCode: REASON_CODES.waiverApproved,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M29_AUDIT_CODES.waiverApproved,
        entityType: 'ai_governance_release',
        entityId: waiverId,
        detail: {},
      });
      return updated;
    });
  }

  async rejectWaiver(
    ctx: RequestContext,
    actor: string | null,
    waiverId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<ReleaseRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceOverride);
    if (!isHumanActor(actor))
      throw governanceForbidden(REASON_CODES.humanApproverRequired, ctx.correlationId);
    if (reason.trim() === '') throw badRequest('a rejection reason is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const waiver = await this.repo.findRelease(tx, waiverId);
      if (waiver === null) throw ProblemError.notFound('Waiver not found.', ctx.correlationId);
      if (waiver.subject_kind !== 'waiver_exception') throw badRequest('not a waiver.', ctx.correlationId);
      if (waiver.version !== expectedVersion)
        throw ProblemError.conflict('Waiver modified concurrently.', ctx.correlationId);
      const t = checkReleaseTransition(waiver.status, 'rejected');
      if (!t.ok) throw badRequest(`a ${waiver.status} waiver cannot be rejected.`, ctx.correlationId);
      const updated = await this.moveWaiver(
        ctx,
        tx,
        waiver,
        'rejected',
        REASON_CODES.waiverRejected,
        actor,
        null,
        reason,
      );
      await this.repo.insertDecision(tx, {
        tenantId: ctx.tenantId,
        targetType: 'waiver',
        targetId: waiverId,
        decision: 'reject',
        decider: actor,
        reason,
        reasonCode: REASON_CODES.waiverRejected,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M29_AUDIT_CODES.waiverRejected,
        entityType: 'ai_governance_release',
        entityId: waiverId,
        detail: {},
      });
      return updated;
    });
  }

  private async moveWaiver(
    ctx: RequestContext,
    tx: Tx,
    waiver: ReleaseRow,
    to: ReleaseStatus,
    reasonCode: string,
    actor: string | null,
    approvedBy: string | null,
    reason: string | null,
  ): Promise<ReleaseRow> {
    const t = checkReleaseTransition(waiver.status, to);
    if (!t.ok) throw badRequest(`cannot move a ${waiver.status} waiver to ${to}.`, ctx.correlationId);
    const updated = await this.repo.updateRelease(tx, {
      id: waiver.id,
      expectedVersion: waiver.version,
      status: to,
      ...(approvedBy !== null ? { approvedBy } : {}),
      decisionReasonCode: reasonCode,
      ...(reason !== null ? { reason } : {}),
      by: actor,
    });
    if (updated === null) throw ProblemError.conflict('Waiver modified concurrently.', ctx.correlationId);
    await this.repo.insertHistory(tx, {
      tenantId: ctx.tenantId,
      targetType: 'waiver',
      targetId: waiver.id,
      fromStatus: waiver.status,
      toStatus: to,
      reason,
      reasonCode,
      by: actor,
      correlationId: ctx.correlationId,
    });
    await this.emitter.publishGovernance(tx, {
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor !== null ? { actor } : {}),
      payload: {
        recordId: waiver.id,
        recordType: 'waiver',
        fromStatus: waiver.status,
        toStatus: to,
        reasonCode,
      },
    });
    return updated;
  }
}
