/**
 * RequestService — the lifecycle of the approval REQUEST aggregate up to the point decisions land: create (idempotent),
 * submit for approval (draft -> pending, with the m06 workflow + SLA-timer hooks and the m08 notify hook recorded as
 * evidence), controlled cancellation, and controlled resubmission of a returned request. It resolves the active policy
 * for the subject, instantiates the per-request steps from the policy steps, and records the maker (and preparer, when
 * distinct) as participants — the immutable basis every later SoD check reads. No direct status mutation happens
 * anywhere else: every transition goes through the lifecycle machine + append-only history + version CAS. m22 never
 * approves here.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M22_PERMISSIONS } from './permissions.ts';
import { M22_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { checkRequestTransition, isRequestTerminal } from './domain/lifecycles.ts';
import { isSubjectType } from './domain/vocab.ts';
import type { Clock } from './ports.ts';
import { SystemClock } from './ports.ts';
import { ApprovalRepository, type ApprovalRequestRow, type ApprovalRequestStepRow } from './repository.ts';
import type { M22Emitter } from './emit.ts';

export class RequestService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M22Emitter;
  private readonly repo: ApprovalRepository;
  private readonly clock: Clock;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M22Emitter,
    repo: ApprovalRepository = new ApprovalRepository(),
    clock: Clock = new SystemClock(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.clock = clock;
  }

  /**
   * Create an approval request for a controlled action (subject_type + opaque subject_ref). Idempotent per key: a
   * retried create with the same idempotency key returns the existing request (no duplicate request). Resolves the
   * active policy, instantiates the per-request steps, and records the maker + preparer participants.
   */
  async createRequest(
    ctx: RequestContext,
    actor: string | null,
    input: {
      subjectType: string;
      subjectRef?: string | null;
      scope?: string;
      title?: string | null;
      amountMinor?: number;
      currencyRef?: string | null;
      preparedBy?: string | null;
      requiredApprovals?: number;
      idempotencyKey?: string | null;
    },
  ): Promise<{ request: ApprovalRequestRow; steps: ApprovalRequestStepRow[] }> {
    await this.authz.require(ctx, M22_PERMISSIONS.requestCreate);
    if (!isSubjectType(input.subjectType)) throw badRequest('unknown subject type.', ctx.correlationId);
    const amount = input.amountMinor ?? 0;
    if (!Number.isInteger(amount) || amount < 0)
      throw badRequest('amount must be a non-negative integer (minor units).', ctx.correlationId);
    const scope = input.scope ?? 'default';
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findRequestByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) {
          const steps = await this.repo.listRequestSteps(tx, existing.id);
          return { request: existing, steps }; // idempotent create
        }
      }
      const policy = await this.repo.findActivePolicy(tx, input.subjectType, scope);
      const requiredApprovals = input.requiredApprovals ?? policy?.required_approvals ?? 1;

      const request = await this.repo.insertRequest(tx, {
        tenantId: ctx.tenantId,
        subjectType: input.subjectType,
        subjectRef: input.subjectRef ?? null,
        policyId: policy?.id ?? null,
        scope,
        title: input.title ?? null,
        amountMinor: amount,
        currencyRef: input.currencyRef ?? null,
        requestedBy: actor,
        preparedBy: input.preparedBy ?? null,
        requiredApprovals,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });

      // Instantiate the per-request steps from the policy (default a single maker-checker step if no policy).
      const policySteps = policy !== null ? await this.repo.listPolicySteps(tx, policy.id) : [];
      const steps: ApprovalRequestStepRow[] = [];
      if (policySteps.length === 0) {
        steps.push(
          await this.repo.insertRequestStep(tx, {
            tenantId: ctx.tenantId,
            requestId: request.id,
            level: 1,
            requiredPermission: M22_PERMISSIONS.decisionApprove,
            sodConstraint: 'maker_checker',
            escalationTarget: null,
            correlationId: ctx.correlationId,
            by: actor,
          }),
        );
      } else {
        for (const ps of policySteps) {
          steps.push(
            await this.repo.insertRequestStep(tx, {
              tenantId: ctx.tenantId,
              requestId: request.id,
              level: ps.level,
              requiredPermission: ps.required_permission,
              sodConstraint: ps.sod_constraint,
              escalationTarget: ps.escalation_target,
              correlationId: ctx.correlationId,
              by: actor,
            }),
          );
        }
      }

      // Record participants — the immutable SoD basis. The maker is the requester; the preparer, when distinct.
      if (actor !== null)
        await this.repo.recordParticipant(tx, {
          tenantId: ctx.tenantId,
          requestId: request.id,
          actor,
          role: 'maker',
          by: actor,
          correlationId: ctx.correlationId,
        });
      if (input.preparedBy != null && input.preparedBy !== '')
        await this.repo.recordParticipant(tx, {
          tenantId: ctx.tenantId,
          requestId: request.id,
          actor: input.preparedBy,
          role: 'preparer',
          by: actor,
          correlationId: ctx.correlationId,
        });

      if (input.idempotencyKey != null && input.idempotencyKey !== '')
        await this.repo.insertIdempotency(tx, {
          tenantId: ctx.tenantId,
          idempotencyKey: input.idempotencyKey,
          purpose: 'request',
          requestId: request.id,
          decisionId: null,
          correlationId: ctx.correlationId,
          by: actor,
        });

      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        requestId: request.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.requestCreated,
        entityType: 'approval_request',
        entityId: request.id,
        detail: { subjectType: request.subject_type },
      });
      await this.emitter.publish(tx, {
        type: 'RequestCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: request.id,
          recordType: 'request',
          requestId: request.id,
          subjectType: request.subject_type,
          ...(request.subject_ref !== null ? { subjectRef: request.subject_ref } : {}),
          ...(policy !== null ? { policyRef: policy.id } : {}),
          amountMinor: request.amount_minor,
          requiredApprovals: request.required_approvals,
          toStatus: 'draft',
          isControlled: true,
        },
      });
      return { request, steps };
    });
  }

  /**
   * Submit a draft request for approval (draft -> pending). Records the m06 workflow-instance hook and, when the active
   * policy enables escalation, registers an m06 SLA timer (opaque ref) and dispatches an m08 notification (opaque ref)
   * — both as evidence. m22 stands up NO workflow / timer / notification engine of its own.
   */
  async submitRequest(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    hooks?: { workflowRef?: string | null; timerRef?: string | null; notificationRef?: string | null },
  ): Promise<ApprovalRequestRow> {
    await this.authz.require(ctx, M22_PERMISSIONS.requestSubmit);
    return this.db.withTenant(ctx, async (tx) => {
      const request = await this.repo.findRequest(tx, id);
      if (request === null) throw ProblemError.notFound('Request not found.', ctx.correlationId);
      const t = checkRequestTransition(request.status, 'pending');
      if (!t.ok) throw badRequest(`A ${request.status} request cannot be submitted.`, ctx.correlationId);
      const updated = await this.repo.updateRequest(tx, {
        id,
        expectedVersion,
        status: 'pending',
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Request modified concurrently.', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        requestId: id,
        fromStatus: request.status,
        toStatus: 'pending',
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });

      // Workflow hook (m06 instance) — evidence only.
      await this.repo.insertWorkflowLink(tx, {
        tenantId: ctx.tenantId,
        requestId: id,
        workflowRef: hooks?.workflowRef ?? null,
        workflowFamily: 'approval.lifecycle',
        note: 'submitted for approval',
        by: actor,
        correlationId: ctx.correlationId,
      });

      // SLA-timer + notify hooks — m06 timers / m08 notifications, recorded as opaque references.
      const policy = request.policy_id !== null ? await this.repo.findPolicy(tx, request.policy_id) : null;
      if (policy?.escalation_enabled === true) {
        const steps = await this.repo.listPolicySteps(tx, policy.id);
        const firstEsc = steps.find((s) => s.escalation_after_seconds !== null);
        const deadline =
          firstEsc?.escalation_after_seconds != null
            ? new Date(this.clock.now() + firstEsc.escalation_after_seconds * 1000).toISOString()
            : null;
        const timer = await this.repo.insertTimer(tx, {
          tenantId: ctx.tenantId,
          requestId: id,
          stepId: null,
          timerRef: hooks?.timerRef ?? null,
          purpose: 'escalation',
          deadlineAt: deadline,
          by: actor,
          correlationId: ctx.correlationId,
        });
        await this.emitter.recordAudit(tx, ctx, {
          code: M22_AUDIT_CODES.timerRegistered,
          entityType: 'approval_timer',
          entityId: timer.id,
          detail: { requestId: id, purpose: 'escalation' },
        });
      }
      await this.repo.insertNotification(tx, {
        tenantId: ctx.tenantId,
        requestId: id,
        notificationRef: hooks?.notificationRef ?? null,
        channel: 'inapp',
        templateKey: 'approval.submitted',
        recipientRef: null,
        eventType: 'RequestSubmitted',
        by: actor,
        correlationId: ctx.correlationId,
      });

      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.requestSubmitted,
        entityType: 'approval_request',
        entityId: id,
        detail: { subjectType: request.subject_type },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.notificationDispatched,
        entityType: 'approval_notification',
        entityId: id,
        detail: { eventType: 'RequestSubmitted' },
      });
      await this.emitter.publish(tx, {
        type: 'RequestSubmitted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: id,
          recordType: 'request',
          requestId: id,
          subjectType: request.subject_type,
          fromStatus: request.status,
          toStatus: 'pending',
          requiredApprovals: request.required_approvals,
          isControlled: true,
        },
      });
      return updated;
    });
  }

  /** Controlled cancellation — from any non-terminal state. */
  async cancelRequest(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    reason: string,
  ): Promise<ApprovalRequestRow> {
    await this.authz.require(ctx, M22_PERMISSIONS.requestCancel);
    if (reason.trim() === '') throw badRequest('a cancellation reason is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const request = await this.repo.findRequest(tx, id);
      if (request === null) throw ProblemError.notFound('Request not found.', ctx.correlationId);
      if (isRequestTerminal(request.status))
        throw badRequest(
          `A ${request.status} request is terminal and cannot be cancelled.`,
          ctx.correlationId,
        );
      const t = checkRequestTransition(request.status, 'cancelled');
      if (!t.ok) throw badRequest(`A ${request.status} request cannot be cancelled.`, ctx.correlationId);
      const updated = await this.repo.updateRequest(tx, {
        id,
        expectedVersion,
        status: 'cancelled',
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Request modified concurrently.', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        requestId: id,
        fromStatus: request.status,
        toStatus: 'cancelled',
        reason,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertOutcome(tx, {
        tenantId: ctx.tenantId,
        requestId: id,
        outcome: 'cancelled',
        subjectType: request.subject_type,
        subjectRef: request.subject_ref,
        finalApprover: null,
        released: false,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.requestCancelled,
        entityType: 'approval_request',
        entityId: id,
        detail: { reason },
      });
      await this.emitter.publish(tx, {
        type: 'RequestCancelled',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: id,
          recordType: 'request',
          requestId: id,
          fromStatus: request.status,
          toStatus: 'cancelled',
          outcome: 'cancelled',
        },
      });
      return updated;
    });
  }

  /** Controlled resubmission — a returned request goes back to pending for another decision round. */
  async resubmitRequest(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<ApprovalRequestRow> {
    await this.authz.require(ctx, M22_PERMISSIONS.requestSubmit);
    return this.db.withTenant(ctx, async (tx) => {
      const request = await this.repo.findRequest(tx, id);
      if (request === null) throw ProblemError.notFound('Request not found.', ctx.correlationId);
      if (request.status !== 'returned')
        throw badRequest('only a returned request can be resubmitted.', ctx.correlationId);
      const t = checkRequestTransition(request.status, 'pending');
      if (!t.ok) throw badRequest('resubmission is not allowed from this state.', ctx.correlationId);
      const updated = await this.repo.updateRequest(tx, {
        id,
        expectedVersion,
        status: 'pending',
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Request modified concurrently.', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        requestId: id,
        fromStatus: 'returned',
        toStatus: 'pending',
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.requestSubmitted,
        entityType: 'approval_request',
        entityId: id,
        detail: { resubmission: true },
      });
      await this.emitter.publish(tx, {
        type: 'RequestSubmitted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: id,
          recordType: 'request',
          requestId: id,
          fromStatus: 'returned',
          toStatus: 'pending',
          isControlled: true,
        },
      });
      return updated;
    });
  }

  async addNote(
    ctx: RequestContext,
    actor: string | null,
    requestId: string,
    input: { noteType?: string; content: string },
  ): Promise<void> {
    await this.authz.require(ctx, M22_PERMISSIONS.noteAdd);
    if (input.content.trim() === '') throw badRequest('note content is required.', ctx.correlationId);
    await this.db.withTenant(ctx, async (tx) => {
      const request = await this.repo.findRequest(tx, requestId);
      if (request === null) throw ProblemError.notFound('Request not found.', ctx.correlationId);
      await this.repo.insertNote(tx, {
        tenantId: ctx.tenantId,
        requestId,
        noteType: input.noteType ?? 'general',
        content: input.content,
        by: actor,
        correlationId: ctx.correlationId,
      });
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getRequest(
    ctx: RequestContext,
    id: string,
  ): Promise<{ request: ApprovalRequestRow; steps: ApprovalRequestStepRow[] }> {
    await this.authz.require(ctx, M22_PERMISSIONS.requestRead);
    return this.db.withTenant(ctx, async (tx) => {
      const request = await this.repo.findRequest(tx, id);
      if (request === null) throw ProblemError.notFound('Request not found.', ctx.correlationId);
      const steps = await this.repo.listRequestSteps(tx, id);
      return { request, steps };
    });
  }
  async listRequests(ctx: RequestContext, status?: string): Promise<ApprovalRequestRow[]> {
    await this.authz.require(ctx, M22_PERMISSIONS.requestRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRequests(tx, status));
  }
}
