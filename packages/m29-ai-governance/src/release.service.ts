/**
 * AiReleaseService — the human-approved RELEASE lifecycle for an M24 asset version (model/prompt/provider/policy/
 * use-case). THE LOAD-BEARING RULE: AI NEVER APPROVES ITS OWN RELEASE. Final approval requires a HUMAN who is not the
 * proposer (`evaluateReleaseGate`: SoD proposer != approver, human approver) AND a passing evaluation (evidence gate);
 * a restricted provider is blocked unless the policy allows it (the DB forbids that, so it is always blocked). Enforced
 * in three layers: the pure gate, this service (non-null human actor + gate), and DB CHECKs
 * (ai_governance_release_human_ck / _sod_ck / _evidence_ck). All transitions run through a single choke point
 * (`moveRelease`) that records append-only history + a human decision and emits ai.governance_lifecycle. M29 records
 * the governed DECISION and emits the event; it performs NO deployment/runtime control.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M29_PERMISSIONS } from './permissions.ts';
import { M29_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden } from './errors.ts';
import {
  checkReleaseTransition,
  clampPage,
  evaluateReleaseGate,
  isHumanActor,
  isRiskTier,
  isSubjectKind,
  isWaiver,
  REASON_CODES,
  type ReleaseStatus,
} from './domain.ts';
import { AiGovernanceRepository, type ReleaseRow } from './repository.ts';
import type { M29Emitter } from './emit.ts';

export class AiReleaseService {
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

  async proposeRelease(
    ctx: RequestContext,
    actor: string | null,
    input: {
      useCaseId?: string | null;
      subjectKind: string;
      subjectRef?: string | null;
      riskTier?: string;
      providerRestricted?: boolean;
      idempotencyKey?: string | null;
    },
  ): Promise<ReleaseRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceManage);
    if (!isHumanActor(actor)) throw badRequest('a human proposer is required.', ctx.correlationId);
    if (!isSubjectKind(input.subjectKind) || isWaiver(input.subjectKind))
      throw badRequest('unknown release subject kind.', ctx.correlationId);
    const riskTier = input.riskTier ?? 'medium';
    if (!isRiskTier(riskTier)) throw badRequest('unknown risk tier.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findReleaseByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const release = await this.repo.insertRelease(tx, {
        tenantId: ctx.tenantId,
        useCaseId: input.useCaseId ?? null,
        subjectKind: input.subjectKind,
        subjectRef: input.subjectRef ?? null,
        riskTier,
        proposedBy: actor,
        providerRestricted: input.providerRestricted ?? false,
        expiresAt: null,
        compensatingControlRef: null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      if (input.idempotencyKey != null && input.idempotencyKey !== '')
        await this.repo.insertIdempotency(tx, {
          tenantId: ctx.tenantId,
          idempotencyKey: input.idempotencyKey,
          releaseId: release.id,
          correlationId: ctx.correlationId,
          by: actor,
        });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'release',
        targetId: release.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: REASON_CODES.releaseProposed,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M29_AUDIT_CODES.releaseProposed,
        entityType: 'ai_governance_release',
        entityId: release.id,
        detail: { subjectKind: input.subjectKind, riskTier },
      });
      await this.emitter.publishGovernance(tx, {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor,
        payload: {
          recordId: release.id,
          recordType: 'release',
          subjectType: input.subjectKind,
          toStatus: 'draft',
          reasonCode: REASON_CODES.releaseProposed,
        },
      });
      return release;
    });
  }

  /** Move a draft release through assessment -> evaluation_pending -> review_pending (evidence must already be passing). */
  async submitForReview(
    ctx: RequestContext,
    actor: string | null,
    releaseId: string,
    expectedVersion: number,
  ): Promise<ReleaseRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceManage);
    return this.db.withTenant(ctx, async (tx) => {
      let release = await this.repo.findRelease(tx, releaseId);
      if (release === null) throw ProblemError.notFound('Release not found.', ctx.correlationId);
      if (release.version !== expectedVersion)
        throw ProblemError.conflict('Release modified concurrently.', ctx.correlationId);
      if (release.status !== 'draft')
        throw badRequest(`a ${release.status} release cannot be submitted for review.`, ctx.correlationId);
      if (!isWaiver(release.subject_kind) && !release.evaluation_passed)
        throw governanceForbidden(REASON_CODES.evaluationRequired, ctx.correlationId);
      release = await this.moveRelease(
        ctx,
        tx,
        release,
        'assessment',
        REASON_CODES.assessmentStarted,
        actor,
        null,
        null,
      );
      release = await this.moveRelease(
        ctx,
        tx,
        release,
        'evaluation_pending',
        REASON_CODES.evaluationRecorded,
        actor,
        null,
        null,
      );
      release = await this.moveRelease(
        ctx,
        tx,
        release,
        'review_pending',
        REASON_CODES.reviewRequested,
        actor,
        null,
        null,
      );
      await this.emitter.recordAudit(tx, ctx, {
        code: M29_AUDIT_CODES.approvalRequested,
        entityType: 'ai_governance_release',
        entityId: releaseId,
        detail: { status: 'review_pending' },
      });
      return release;
    });
  }

  async approveRelease(
    ctx: RequestContext,
    actor: string | null,
    releaseId: string,
    expectedVersion: number,
    input?: { reason?: string | null },
  ): Promise<ReleaseRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceApprove);
    // No AI self-approval: the final approver must be a HUMAN (never null/system) — checked before the gate too.
    if (!isHumanActor(actor))
      throw governanceForbidden(REASON_CODES.aiSelfApprovalForbidden, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const release = await this.repo.findRelease(tx, releaseId);
      if (release === null) throw ProblemError.notFound('Release not found.', ctx.correlationId);
      if (release.version !== expectedVersion)
        throw ProblemError.conflict('Release modified concurrently.', ctx.correlationId);
      const active = await this.repo.findActivePolicy(tx, 'default');
      // THE NO-AI-SELF-APPROVAL / SoD / EVIDENCE gate (fail closed before the DB CHECK).
      const gate = evaluateReleaseGate({
        subjectKind: release.subject_kind,
        proposedBy: release.proposed_by,
        approverId: actor,
        evaluationPassed: release.evaluation_passed,
        providerRestricted: release.provider_restricted,
        policyAllowsRestrictedProvider: active?.allow_restricted_provider ?? false,
      });
      if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      const t = checkReleaseTransition(release.status, 'approved');
      if (!t.ok) throw badRequest(`a ${release.status} release cannot be approved.`, ctx.correlationId);
      const updated = await this.moveRelease(
        ctx,
        tx,
        release,
        'approved',
        REASON_CODES.releaseApproved,
        actor,
        actor,
        input?.reason ?? null,
      );
      await this.repo.insertDecision(tx, {
        tenantId: ctx.tenantId,
        targetType: 'release',
        targetId: releaseId,
        decision: 'approve',
        decider: actor,
        reason: input?.reason ?? null,
        reasonCode: REASON_CODES.releaseApproved,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M29_AUDIT_CODES.releaseApproved,
        entityType: 'ai_governance_release',
        entityId: releaseId,
        detail: { subjectKind: release.subject_kind },
      });
      return updated;
    });
  }

  async rejectRelease(
    ctx: RequestContext,
    actor: string | null,
    releaseId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<ReleaseRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceApprove);
    if (!isHumanActor(actor))
      throw governanceForbidden(REASON_CODES.humanApproverRequired, ctx.correlationId);
    if (reason.trim() === '') throw badRequest('a rejection reason is required.', ctx.correlationId);
    return this.decideTerminal(
      ctx,
      actor,
      releaseId,
      expectedVersion,
      'rejected',
      'reject',
      REASON_CODES.releaseRejected,
      reason,
      M29_AUDIT_CODES.releaseRejected,
    );
  }

  async releaseRelease(
    ctx: RequestContext,
    actor: string | null,
    releaseId: string,
    expectedVersion: number,
  ): Promise<ReleaseRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceApprove);
    if (!isHumanActor(actor))
      throw governanceForbidden(REASON_CODES.humanApproverRequired, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const release = await this.repo.findRelease(tx, releaseId);
      if (release === null) throw ProblemError.notFound('Release not found.', ctx.correlationId);
      if (release.version !== expectedVersion)
        throw ProblemError.conflict('Release modified concurrently.', ctx.correlationId);
      const t = checkReleaseTransition(release.status, 'released');
      if (!t.ok) throw badRequest(`a ${release.status} release cannot be released.`, ctx.correlationId);
      const updated = await this.moveRelease(
        ctx,
        tx,
        release,
        'released',
        REASON_CODES.releaseReleased,
        actor,
        null,
        null,
      );
      await this.repo.insertDecision(tx, {
        tenantId: ctx.tenantId,
        targetType: 'release',
        targetId: releaseId,
        decision: 'release',
        decider: actor,
        reason: null,
        reasonCode: REASON_CODES.releaseReleased,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M29_AUDIT_CODES.releaseReleased,
        entityType: 'ai_governance_release',
        entityId: releaseId,
        detail: {},
      });
      return updated;
    });
  }

  async suspendRelease(
    ctx: RequestContext,
    actor: string | null,
    releaseId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<ReleaseRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceApprove);
    if (!isHumanActor(actor))
      throw governanceForbidden(REASON_CODES.humanApproverRequired, ctx.correlationId);
    if (reason.trim() === '') throw badRequest('a suspension reason is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const release = await this.repo.findRelease(tx, releaseId);
      if (release === null) throw ProblemError.notFound('Release not found.', ctx.correlationId);
      if (release.version !== expectedVersion)
        throw ProblemError.conflict('Release modified concurrently.', ctx.correlationId);
      const t = checkReleaseTransition(release.status, 'suspended');
      if (!t.ok) throw badRequest(`a ${release.status} release cannot be suspended.`, ctx.correlationId);
      const updated = await this.moveRelease(
        ctx,
        tx,
        release,
        'suspended',
        REASON_CODES.releaseSuspended,
        actor,
        null,
        reason,
      );
      await this.repo.insertDecision(tx, {
        tenantId: ctx.tenantId,
        targetType: 'release',
        targetId: releaseId,
        decision: 'suspend',
        decider: actor,
        reason,
        reasonCode: REASON_CODES.releaseSuspended,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M29_AUDIT_CODES.releaseSuspended,
        entityType: 'ai_governance_release',
        entityId: releaseId,
        detail: {},
      });
      return updated;
    });
  }

  async withdrawRelease(
    ctx: RequestContext,
    actor: string | null,
    releaseId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<ReleaseRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceManage);
    if (reason.trim() === '') throw badRequest('a withdrawal reason is required.', ctx.correlationId);
    return this.decideTerminal(
      ctx,
      actor,
      releaseId,
      expectedVersion,
      'withdrawn',
      'withdraw',
      REASON_CODES.releaseWithdrawn,
      reason,
      M29_AUDIT_CODES.releaseWithdrawn,
    );
  }

  // --- reads ------------------------------------------------------------------------------------
  async getRelease(ctx: RequestContext, id: string): Promise<ReleaseRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceRead);
    const release = await this.db.withTenant(ctx, (tx) => this.repo.findRelease(tx, id));
    if (release === null) throw ProblemError.notFound('Release not found.', ctx.correlationId);
    return release;
  }
  async listReleases(
    ctx: RequestContext,
    useCaseId: string | null,
    page: { limit?: number; offset?: number },
  ): Promise<ReleaseRow[]> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceRead);
    const p = clampPage(page.limit, page.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listReleases(tx, useCaseId, p.limit, p.offset));
  }

  // --- helpers ----------------------------------------------------------------------------------
  private async decideTerminal(
    ctx: RequestContext,
    actor: string | null,
    releaseId: string,
    expectedVersion: number,
    to: ReleaseStatus,
    decision: string,
    reasonCode: string,
    reason: string,
    auditCode: string,
  ): Promise<ReleaseRow> {
    return this.db.withTenant(ctx, async (tx) => {
      const release = await this.repo.findRelease(tx, releaseId);
      if (release === null) throw ProblemError.notFound('Release not found.', ctx.correlationId);
      if (release.version !== expectedVersion)
        throw ProblemError.conflict('Release modified concurrently.', ctx.correlationId);
      const t = checkReleaseTransition(release.status, to);
      if (!t.ok) throw badRequest(`a ${release.status} release cannot be ${decision}ed.`, ctx.correlationId);
      const updated = await this.moveRelease(ctx, tx, release, to, reasonCode, actor, null, reason);
      await this.repo.insertDecision(tx, {
        tenantId: ctx.tenantId,
        targetType: 'release',
        targetId: releaseId,
        decision,
        decider: actor ?? 'system',
        reason,
        reasonCode,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: 'ai_governance_release',
        entityId: releaseId,
        detail: { decision },
      });
      return updated;
    });
  }

  private async moveRelease(
    ctx: RequestContext,
    tx: Tx,
    release: ReleaseRow,
    to: ReleaseStatus,
    reasonCode: string,
    actor: string | null,
    approvedBy: string | null,
    reason: string | null,
  ): Promise<ReleaseRow> {
    const t = checkReleaseTransition(release.status, to);
    if (!t.ok) throw badRequest(`cannot move a ${release.status} release to ${to}.`, ctx.correlationId);
    const updated = await this.repo.updateRelease(tx, {
      id: release.id,
      expectedVersion: release.version,
      status: to,
      ...(approvedBy !== null ? { approvedBy } : {}),
      decisionReasonCode: reasonCode,
      ...(reason !== null ? { reason } : {}),
      by: actor,
    });
    if (updated === null) throw ProblemError.conflict('Release modified concurrently.', ctx.correlationId);
    await this.repo.insertHistory(tx, {
      tenantId: ctx.tenantId,
      targetType: 'release',
      targetId: release.id,
      fromStatus: release.status,
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
        recordId: release.id,
        recordType: 'release',
        subjectType: release.subject_kind,
        fromStatus: release.status,
        toStatus: to,
        reasonCode,
      },
    });
    return updated;
  }
}
