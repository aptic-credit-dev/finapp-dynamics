/**
 * DecisionService — where controlled decisions land on a pending/escalated request: approve, reject, return-for-changes,
 * abstain, escalate, and (privileged) override. THIS is the maker-checker + Segregation-of-Duties choke point. Before
 * any APPROVING act the pure SoD engine is consulted with the request's maker, preparer, the actor, and — if the actor
 * acts under a delegation — the delegator; a block is AUDITED (APPROVAL_SOD_BLOCKED), recorded as SoD evidence, and
 * refused with a clear reason (fail closed). An allowed approval is recorded, advances its step, increments the
 * distinct-approver quorum, and only when the quorum is met does the request become 'approved' — naming a final
 * approver who is provably not the maker (DB CHECK) and releasing the approval reference downstream modules gate on.
 * m22 NEVER approves on behalf of a human: a human actor decides; this service records + enforces.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M22_PERMISSIONS, type M22Permission } from './permissions.ts';
import { M22_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, sodForbidden } from './errors.ts';
import { checkRequestTransition, checkStepTransition, isRequestActionable } from './domain/lifecycles.ts';
import { REASON_CODES, isDecisionKind, type DecisionKind, type OverrideType } from './domain/vocab.ts';
import { evaluateSod, checkQuorum, type SodResult } from './engine.ts';
import { ApprovalRepository, type ApprovalRequestRow, type ApprovalDecisionRow } from './repository.ts';
import type { M22Emitter } from './emit.ts';

/** The permission each decision kind requires (default deny; SoD is a SECOND, orthogonal gate on top of this). */
const DECISION_PERMISSION: Record<string, M22Permission> = {
  approve: M22_PERMISSIONS.decisionApprove,
  reject: M22_PERMISSIONS.decisionReject,
  return: M22_PERMISSIONS.decisionReturn,
  abstain: M22_PERMISSIONS.decisionAbstain,
  escalate: M22_PERMISSIONS.decisionEscalate,
};

export interface DecisionResult {
  readonly request: ApprovalRequestRow;
  readonly decision: ApprovalDecisionRow;
  readonly sod: SodResult;
}

export class DecisionService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M22Emitter;
  private readonly repo: ApprovalRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M22Emitter,
    repo: ApprovalRepository = new ApprovalRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  /**
   * Record a decision on a request. `actor` is the deciding human (never null for a decision). `onBehalfOf`, when set,
   * names the delegator the actor acts for — the delegation must be active AND must not launder SoD.
   */
  async recordDecision(
    ctx: RequestContext,
    actor: string,
    id: string,
    expectedVersion: number,
    input: {
      decision: string;
      reason?: string | null;
      reasonCode?: string | null;
      onBehalfOf?: string | null;
    },
  ): Promise<DecisionResult> {
    if (!isDecisionKind(input.decision) || input.decision.startsWith('override'))
      throw badRequest('unknown or non-recordable decision.', ctx.correlationId);
    const decision: DecisionKind = input.decision;
    const permission = DECISION_PERMISSION[decision];
    if (permission === undefined) throw badRequest('unknown decision.', ctx.correlationId);
    await this.authz.require(ctx, permission);
    if (actor.trim() === '') throw badRequest('a deciding actor is required.', ctx.correlationId);

    return this.db.withTenant(ctx, async (tx) => {
      const request = await this.repo.findRequest(tx, id);
      if (request === null) throw ProblemError.notFound('Request not found.', ctx.correlationId);
      if (!isRequestActionable(request.status))
        throw badRequest(`A ${request.status} request cannot receive a decision.`, ctx.correlationId);

      // Resolve the SoD inputs. delegatorOf is set only when the actor acts under an active delegation.
      let delegatorOf: string | null = null;
      if (input.onBehalfOf != null && input.onBehalfOf !== '') {
        const deleg = await this.repo.findActiveDelegationFor(tx, actor, request.subject_type, request.scope);
        if (deleg === null) throw sodForbidden(REASON_CODES.unauthorizedActor.code, ctx.correlationId);
        if (deleg.delegator !== input.onBehalfOf)
          throw sodForbidden(REASON_CODES.unauthorizedActor.code, ctx.correlationId);
        delegatorOf = deleg.delegator;
      }
      const priorApprovers = await this.repo.priorApprovers(tx, id);
      const sod = evaluateSod({
        actor,
        maker: request.requested_by,
        preparer: request.prepared_by,
        delegatorOf,
        priorApprovers,
        requireDistinctSecondApprover: request.required_approvals > 1,
      });

      // APPROVING decisions are SoD-gated. A block is audited + recorded, then refused (fail closed).
      if (decision === 'approve' && !sod.allowed) {
        for (const f of sod.findings)
          await this.repo.insertSodCheck(tx, {
            tenantId: ctx.tenantId,
            requestId: id,
            decisionId: null,
            actor,
            maker: request.requested_by,
            rule: f.rule,
            verdict: 'blocked',
            reasonCode: f.reasonCode,
            correlationId: ctx.correlationId,
          });
        await this.emitter.recordAudit(tx, ctx, {
          code: M22_AUDIT_CODES.sodBlocked,
          entityType: 'approval_request',
          entityId: id,
          detail: { actor, reasonCodes: sod.findings.map((f) => f.reasonCode) },
        });
        throw sodForbidden(
          sod.findings[0]?.reasonCode ?? REASON_CODES.makerIsChecker.code,
          ctx.correlationId,
        );
      }
      if (decision === 'approve')
        await this.repo.insertSodCheck(tx, {
          tenantId: ctx.tenantId,
          requestId: id,
          decisionId: null,
          actor,
          maker: request.requested_by,
          rule: 'maker_checker',
          verdict: 'allowed',
          reasonCode: null,
          correlationId: ctx.correlationId,
        });

      // Record the decision (append-only; the DB CHECK is the last line of the SoD defence).
      const decisionRow = await this.repo.insertDecision(tx, {
        tenantId: ctx.tenantId,
        requestId: id,
        stepId: null,
        level: request.current_level,
        decision,
        actor,
        maker: request.requested_by,
        onBehalfOf: delegatorOf,
        reasonCode: input.reasonCode ?? null,
        reason: input.reason ?? null,
        isFinal: false,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.decisionRecorded,
        entityType: 'approval_decision',
        entityId: decisionRow.id,
        detail: { requestId: id, decision },
      });
      await this.emitter.publish(tx, {
        type: 'DecisionRecorded',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor,
        payload: {
          recordId: decisionRow.id,
          recordType: 'decision',
          requestId: id,
          decision,
          level: request.current_level,
        },
      });

      // Dispatch on the decision kind.
      let updated: ApprovalRequestRow | null = request;
      if (decision === 'approve') {
        await this.repo.recordParticipant(tx, {
          tenantId: ctx.tenantId,
          requestId: id,
          actor,
          role: 'approver',
          by: actor,
          correlationId: ctx.correlationId,
        });
        await this.advanceCurrentStep(ctx, tx, id, request.current_level, 'approved', actor);
        const distinct = await this.repo.countDistinctApprovers(tx, id);
        const quorum = checkQuorum({
          approvalsCount: distinct,
          requiredApprovals: request.required_approvals,
        });
        if (quorum.met) {
          updated = await this.repo.updateRequest(tx, {
            id,
            expectedVersion,
            status: 'approved',
            approvalsCount: distinct,
            finalApprover: actor,
            by: actor,
          });
          if (updated === null)
            throw ProblemError.conflict('Request modified concurrently.', ctx.correlationId);
          await this.recordTerminal(ctx, tx, request, 'approved', actor, actor, true);
        } else {
          updated = await this.repo.updateRequest(tx, {
            id,
            expectedVersion,
            status: request.status,
            approvalsCount: distinct,
            by: actor,
          });
          if (updated === null)
            throw ProblemError.conflict('Request modified concurrently.', ctx.correlationId);
        }
      } else if (decision === 'reject') {
        await this.advanceCurrentStep(ctx, tx, id, request.current_level, 'rejected', actor);
        updated = await this.transitionRequest(ctx, tx, request, 'rejected', expectedVersion, actor);
        await this.recordTerminal(ctx, tx, request, 'rejected', null, actor, false);
      } else if (decision === 'return') {
        updated = await this.transitionRequest(ctx, tx, request, 'returned', expectedVersion, actor);
        await this.repo.insertOutcome(tx, {
          tenantId: ctx.tenantId,
          requestId: id,
          outcome: 'returned',
          subjectType: request.subject_type,
          subjectRef: request.subject_ref,
          finalApprover: null,
          released: false,
          reasonCode: REASON_CODES.returned.code,
          by: actor,
          correlationId: ctx.correlationId,
        });
        await this.emitter.publish(tx, {
          type: 'RequestReturned',
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          actor,
          payload: {
            recordId: id,
            recordType: 'request',
            requestId: id,
            toStatus: 'returned',
            outcome: 'returned',
          },
        });
      } else if (decision === 'escalate') {
        updated = await this.escalate(ctx, tx, request, expectedVersion, actor);
      }
      // 'abstain' records the decision only — no state change.

      return { request: updated, decision: decisionRow, sod };
    });
  }

  /**
   * A privileged OVERRIDE — a justified act by an authorised actor that forces a request terminal out of band.
   * Segregation of Duties STILL applies: the overriding actor is never the maker (engine + DB CHECK). An override
   * cannot launder maker-checker.
   */
  async overrideDecision(
    ctx: RequestContext,
    actor: string,
    id: string,
    expectedVersion: number,
    input: { overrideType: string; justification: string; reasonCode?: string | null },
  ): Promise<DecisionResult> {
    await this.authz.require(ctx, M22_PERMISSIONS.decisionOverride);
    const overrideType = input.overrideType as OverrideType;
    if (!['override_request', 'override_approve', 'override_reject'].includes(overrideType))
      throw badRequest('unknown override type.', ctx.correlationId);
    if (input.justification.trim() === '')
      throw badRequest('an override justification is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const request = await this.repo.findRequest(tx, id);
      if (request === null) throw ProblemError.notFound('Request not found.', ctx.correlationId);
      if (!isRequestActionable(request.status))
        throw badRequest(`A ${request.status} request cannot be overridden.`, ctx.correlationId);

      // SoD applies to overrides too — the overriding actor is never the maker (fail closed before the DB CHECK).
      const sod = evaluateSod({ actor, maker: request.requested_by, preparer: request.prepared_by });
      if (overrideType === 'override_approve' && !sod.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M22_AUDIT_CODES.sodBlocked,
          entityType: 'approval_request',
          entityId: id,
          detail: { actor, override: overrideType, reasonCodes: sod.findings.map((f) => f.reasonCode) },
        });
        throw sodForbidden(
          sod.findings[0]?.reasonCode ?? REASON_CODES.makerIsChecker.code,
          ctx.correlationId,
        );
      }

      const decisionRow = await this.repo.insertDecision(tx, {
        tenantId: ctx.tenantId,
        requestId: id,
        stepId: null,
        level: request.current_level,
        decision: overrideType,
        actor,
        maker: request.requested_by,
        onBehalfOf: null,
        reasonCode: input.reasonCode ?? REASON_CODES.overrideApplied.code,
        reason: input.justification,
        isFinal: overrideType !== 'override_request',
        correlationId: ctx.correlationId,
      });
      await this.repo.insertOverride(tx, {
        tenantId: ctx.tenantId,
        requestId: id,
        decisionId: decisionRow.id,
        overrideType,
        actor,
        maker: request.requested_by,
        justification: input.justification,
        reasonCode: input.reasonCode ?? REASON_CODES.overrideApplied.code,
        correlationId: ctx.correlationId,
      });

      let updated: ApprovalRequestRow | null = request;
      if (overrideType === 'override_approve') {
        updated = await this.repo.updateRequest(tx, {
          id,
          expectedVersion,
          status: 'approved',
          approvalsCount: request.required_approvals,
          finalApprover: actor,
          by: actor,
        });
        if (updated === null)
          throw ProblemError.conflict('Request modified concurrently.', ctx.correlationId);
        await this.recordTerminal(ctx, tx, request, 'approved', actor, actor, true);
      } else if (overrideType === 'override_reject') {
        updated = await this.transitionRequest(ctx, tx, request, 'rejected', expectedVersion, actor);
        await this.recordTerminal(ctx, tx, request, 'rejected', null, actor, false);
      }

      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.overrideApplied,
        entityType: 'approval_override',
        entityId: decisionRow.id,
        detail: { requestId: id, overrideType },
      });
      await this.emitter.publish(tx, {
        type: 'Overridden',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor,
        payload: {
          recordId: id,
          recordType: 'request',
          requestId: id,
          decision: overrideType,
          reasonCode: REASON_CODES.overrideApplied.code,
        },
      });
      return { request: updated, decision: decisionRow, sod };
    });
  }

  // --- helpers ----------------------------------------------------------------------------------
  private async transitionRequest(
    ctx: RequestContext,
    tx: Tx,
    request: ApprovalRequestRow,
    to: string,
    expectedVersion: number,
    actor: string,
  ): Promise<ApprovalRequestRow> {
    const t = checkRequestTransition(request.status, to);
    if (!t.ok) throw badRequest(`cannot move a ${request.status} request to ${to}.`, ctx.correlationId);
    const updated = await this.repo.updateRequest(tx, {
      id: request.id,
      expectedVersion,
      status: to,
      by: actor,
    });
    if (updated === null) throw ProblemError.conflict('Request modified concurrently.', ctx.correlationId);
    await this.repo.insertStatusHistory(tx, {
      tenantId: ctx.tenantId,
      requestId: request.id,
      fromStatus: request.status,
      toStatus: to,
      reason: null,
      reasonCode: null,
      by: actor,
      correlationId: ctx.correlationId,
    });
    return updated;
  }

  private async advanceCurrentStep(
    ctx: RequestContext,
    tx: Tx,
    requestId: string,
    level: number,
    to: string,
    actor: string,
  ): Promise<void> {
    const step = await this.repo.findStepByLevel(tx, requestId, level);
    if (step === null) return;
    const t = checkStepTransition(step.status, to);
    if (!t.ok) return;
    const updated = await this.repo.setStepStatus(tx, {
      id: step.id,
      expectedVersion: step.version,
      status: to,
      decidedBy: actor,
      by: actor,
    });
    if (updated === null) throw ProblemError.conflict('Step modified concurrently.', ctx.correlationId);
    await this.repo.insertStepHistory(tx, {
      tenantId: ctx.tenantId,
      stepId: step.id,
      requestId,
      fromStatus: step.status,
      toStatus: to,
      reason: null,
      reasonCode: null,
      by: actor,
      correlationId: ctx.correlationId,
    });
    await this.emitter.recordAudit(tx, ctx, {
      code: to === 'approved' ? M22_AUDIT_CODES.stepApproved : M22_AUDIT_CODES.stepRejected,
      entityType: 'approval_request_step',
      entityId: step.id,
      detail: { requestId, level },
    });
    await this.emitter.publish(tx, {
      type: to === 'approved' ? 'StepApproved' : 'StepRejected',
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      actor,
      payload: { recordId: step.id, recordType: 'step', requestId, stepId: step.id, level, toStatus: to },
    });
  }

  private async recordTerminal(
    ctx: RequestContext,
    tx: Tx,
    request: ApprovalRequestRow,
    outcome: 'approved' | 'rejected',
    finalApprover: string | null,
    actor: string,
    released: boolean,
  ): Promise<void> {
    if (outcome === 'approved') {
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        requestId: request.id,
        fromStatus: request.status,
        toStatus: 'approved',
        reason: null,
        reasonCode: REASON_CODES.approved.code,
        by: actor,
        correlationId: ctx.correlationId,
      });
    }
    const outcomeRow = await this.repo.insertOutcome(tx, {
      tenantId: ctx.tenantId,
      requestId: request.id,
      outcome,
      subjectType: request.subject_type,
      subjectRef: request.subject_ref,
      finalApprover,
      released,
      reasonCode: outcome === 'approved' ? REASON_CODES.approved.code : REASON_CODES.rejected.code,
      by: actor,
      correlationId: ctx.correlationId,
    });
    await this.emitter.recordAudit(tx, ctx, {
      code: outcome === 'approved' ? M22_AUDIT_CODES.requestApproved : M22_AUDIT_CODES.requestRejected,
      entityType: 'approval_request',
      entityId: request.id,
      detail: { outcome, ...(finalApprover !== null ? { finalApprover } : {}) },
    });
    await this.emitter.publish(tx, {
      type: outcome === 'approved' ? 'RequestApproved' : 'RequestRejected',
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      actor,
      payload: {
        recordId: request.id,
        recordType: 'request',
        requestId: request.id,
        subjectType: request.subject_type,
        ...(request.subject_ref !== null ? { subjectRef: request.subject_ref } : {}),
        toStatus: outcome,
        outcome,
        approvalRef: outcomeRow.id,
        isControlled: true,
      },
    });
    if (released) {
      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.outcomeReleased,
        entityType: 'approval_outcome',
        entityId: outcomeRow.id,
        detail: { requestId: request.id, subjectType: request.subject_type },
      });
      await this.emitter.publish(tx, {
        type: 'OutcomeReleased',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor,
        payload: {
          recordId: outcomeRow.id,
          recordType: 'outcome',
          requestId: request.id,
          subjectType: request.subject_type,
          ...(request.subject_ref !== null ? { subjectRef: request.subject_ref } : {}),
          approvalRef: outcomeRow.id,
          outcome: 'approved',
          isControlled: true,
        },
      });
    }
  }

  private async escalate(
    ctx: RequestContext,
    tx: Tx,
    request: ApprovalRequestRow,
    expectedVersion: number,
    actor: string,
  ): Promise<ApprovalRequestRow> {
    const nextDepth = request.escalation_depth + 1;
    if (nextDepth > 20)
      throw badRequest('escalation depth exceeded (bounded escalation).', ctx.correlationId);
    const updated = await this.repo.updateRequest(tx, {
      id: request.id,
      expectedVersion,
      status: 'escalated',
      escalationDepth: nextDepth,
      by: actor,
    });
    if (updated === null) throw ProblemError.conflict('Request modified concurrently.', ctx.correlationId);
    await this.repo.insertStatusHistory(tx, {
      tenantId: ctx.tenantId,
      requestId: request.id,
      fromStatus: request.status,
      toStatus: 'escalated',
      reason: null,
      reasonCode: REASON_CODES.escalationTimeout.code,
      by: actor,
      correlationId: ctx.correlationId,
    });
    await this.repo.insertEscalation(tx, {
      tenantId: ctx.tenantId,
      requestId: request.id,
      stepId: null,
      fromLevel: request.current_level,
      toLevel: request.current_level + 1,
      targetRef: null,
      mode: 'notify_only',
      depth: nextDepth,
      timerRef: null,
      reasonCode: REASON_CODES.escalationTimeout.code,
      by: actor,
      correlationId: ctx.correlationId,
    });
    await this.emitter.recordAudit(tx, ctx, {
      code: M22_AUDIT_CODES.requestEscalated,
      entityType: 'approval_request',
      entityId: request.id,
      detail: { depth: nextDepth },
    });
    await this.emitter.publish(tx, {
      type: 'RequestEscalated',
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      actor,
      payload: {
        recordId: request.id,
        recordType: 'request',
        requestId: request.id,
        toStatus: 'escalated',
        escalationDepth: nextDepth,
      },
    });
    return updated;
  }

  // --- reads ------------------------------------------------------------------------------------
  async listDecisions(ctx: RequestContext, requestId: string): Promise<ApprovalDecisionRow[]> {
    await this.authz.require(ctx, M22_PERMISSIONS.requestRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listDecisions(tx, requestId));
  }
}
