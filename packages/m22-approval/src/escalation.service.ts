/**
 * EscalationService — the deterministic, CLOCK-DRIVEN escalation path. When an m06 SLA timer fires for a pending
 * request that has sat past its deadline, this raises exactly ONE escalation to the next level (single-fire, enforced
 * by a UNIQUE (request, step, to_level) index), bounded by a maximum depth (no runaway escalation), in either
 * notify-only or reassignment mode. It REUSES m06 timers/SLA and m08 notifications through opaque references — it
 * builds NO second timer or notification engine (CLAUDE.md). Escalation never approves and never bypasses SoD: a
 * reassignment only changes WHO may check, never the maker-checker rule the DecisionService enforces.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M22_PERMISSIONS } from './permissions.ts';
import { M22_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { isRequestActionable } from './domain/lifecycles.ts';
import { isEscalationMode, M22_LIMITS, REASON_CODES } from './domain/vocab.ts';
import { canEscalate } from './engine.ts';
import { ApprovalRepository, type ApprovalEscalationRow } from './repository.ts';
import type { M22Emitter } from './emit.ts';

export class EscalationService {
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
   * Fire an escalation for a request whose SLA deadline has passed. Single-fire per target level; depth-bounded. The
   * m06 timer that triggered this is recorded by opaque `timerRef`; an m08 notification (opaque `notificationRef`)
   * carries the alert. Idempotent: a second call for the same (request, step, to_level) is a safe no-op.
   */
  async fireEscalation(
    ctx: RequestContext,
    actor: string | null,
    requestId: string,
    input: {
      toLevel: number;
      targetRef?: string | null;
      mode?: string;
      timerRef?: string | null;
      notificationRef?: string | null;
      maxDepth?: number;
    },
  ): Promise<ApprovalEscalationRow> {
    await this.authz.require(ctx, M22_PERMISSIONS.escalationManage);
    const mode = input.mode ?? 'notify_only';
    if (!isEscalationMode(mode)) throw badRequest('unknown escalation mode.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const request = await this.repo.findRequest(tx, requestId);
      if (request === null) throw ProblemError.notFound('Request not found.', ctx.correlationId);
      if (!isRequestActionable(request.status))
        throw badRequest(`A ${request.status} request cannot be escalated.`, ctx.correlationId);

      // Single-fire: if an escalation to this level already fired for this request, no-op (no duplicate escalation).
      const existing = await this.repo.listEscalations(tx, requestId);
      const already = existing.find((e) => e.to_level === input.toLevel && e.step_id === null);
      if (already !== undefined) return already;

      // Bounded depth (deterministic).
      const maxDepth = input.maxDepth ?? M22_LIMITS.maxEscalationDepth;
      const guard = canEscalate({ currentDepth: request.escalation_depth, maxDepth });
      if (!guard.ok) throw badRequest('escalation depth exceeded (bounded escalation).', ctx.correlationId);

      const escalation = await this.repo.insertEscalation(tx, {
        tenantId: ctx.tenantId,
        requestId,
        stepId: null,
        fromLevel: request.current_level,
        toLevel: input.toLevel,
        targetRef: input.targetRef ?? null,
        mode,
        depth: guard.nextDepth,
        timerRef: input.timerRef ?? null,
        reasonCode: REASON_CODES.escalationTimeout.code,
        by: actor,
        correlationId: ctx.correlationId,
      });

      const updated = await this.repo.updateRequest(tx, {
        id: requestId,
        expectedVersion: request.version,
        status: 'escalated',
        currentLevel: mode === 'reassign' ? input.toLevel : request.current_level,
        escalationDepth: guard.nextDepth,
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Request modified concurrently.', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        requestId,
        fromStatus: request.status,
        toStatus: 'escalated',
        reason: null,
        reasonCode: REASON_CODES.escalationTimeout.code,
        by: actor,
        correlationId: ctx.correlationId,
      });

      // If reassigning, record the new target as an assignment + escalation-target participant (evidence only).
      if (mode === 'reassign' && input.targetRef != null && input.targetRef !== '') {
        await this.repo.insertAssignment(tx, {
          tenantId: ctx.tenantId,
          requestId,
          stepId: null,
          level: input.toLevel,
          assigneeRef: input.targetRef,
          assignmentType: 'assigned',
          sourceDelegationId: null,
          by: actor,
          correlationId: ctx.correlationId,
        });
        await this.repo.recordParticipant(tx, {
          tenantId: ctx.tenantId,
          requestId,
          actor: input.targetRef,
          role: 'escalation_target',
          by: actor,
          correlationId: ctx.correlationId,
        });
      }

      // m08 notify hook (opaque reference) — evidence only; m22 builds no notification engine.
      await this.repo.insertNotification(tx, {
        tenantId: ctx.tenantId,
        requestId,
        notificationRef: input.notificationRef ?? null,
        channel: 'inapp',
        templateKey: 'approval.escalated',
        recipientRef: input.targetRef ?? null,
        eventType: 'Escalated',
        by: actor,
        correlationId: ctx.correlationId,
      });

      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.escalationFired,
        entityType: 'approval_escalation',
        entityId: escalation.id,
        detail: { requestId, toLevel: input.toLevel, mode, depth: guard.nextDepth },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.notificationDispatched,
        entityType: 'approval_notification',
        entityId: escalation.id,
        detail: { eventType: 'Escalated' },
      });
      await this.emitter.publish(tx, {
        type: 'Escalated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: escalation.id,
          recordType: 'escalation',
          requestId,
          level: input.toLevel,
          escalationDepth: guard.nextDepth,
          reasonCode: REASON_CODES.escalationTimeout.code,
        },
      });
      return escalation;
    });
  }

  async listEscalations(ctx: RequestContext, requestId: string): Promise<ApprovalEscalationRow[]> {
    await this.authz.require(ctx, M22_PERMISSIONS.requestRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listEscalations(tx, requestId));
  }
}
