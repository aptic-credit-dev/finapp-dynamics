/**
 * RecordsService — SLA tracking, escalation, controlled M13 case handoff, and duplicate/related linking
 * (F18-F20/F26/F27). SLA math is deterministic via the injected `Clock` (ADR-054). Escalation reuses M08 (m12
 * records the escalation reference + publishes an event; the actual m08 open is a downstream consumer/adapter —
 * m12 builds no second escalation engine, F20). Case handoff to M13 (which does not exist yet) stores a PENDING
 * record + publishes a versioned event + exposes a port; m12 creates NO fake case table (F26). Every mutation is
 * permissioned, audited, and emits.
 */
import { randomUUID } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M12_PERMISSIONS } from './permissions.ts';
import { M12_AUDIT_CODES } from './audit-codes.ts';
import { checkFeedbackTransition } from './domain/lifecycles.ts';
import { computeDueDates, slaStageState, type SlaPolicySpec } from './domain/sla.ts';
import { isRelationshipKind, duplicateKey } from './domain/closure.ts';
import {
  FeedbackRepository,
  type SlaInstanceRow,
  type CaseHandoffRow,
  type RelationshipRow,
} from './repository.ts';
import type { M12Emitter } from './emit.ts';
import type { Clock } from './ports.ts';
import { SystemClock } from './ports.ts';
import { badRequest } from './errors.ts';

export class RecordsService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M12Emitter;
  private readonly repo: FeedbackRepository;
  private readonly clock: Clock;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M12Emitter,
    repo: FeedbackRepository = new FeedbackRepository(),
    clock: Clock = new SystemClock(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.clock = clock;
  }

  // --- SLA --------------------------------------------------------------------------------------
  async startSla(
    ctx: RequestContext,
    actor: string | null,
    feedbackId: string,
    policyCode: string,
  ): Promise<SlaInstanceRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.slaManage);
    return this.db.withTenant(ctx, async (tx) => {
      const fb = await this.repo.findFeedback(tx, feedbackId);
      if (fb === null) throw ProblemError.notFound('Feedback not found.', ctx.correlationId);
      if ((await this.repo.findSlaInstance(tx, feedbackId)) !== null)
        throw ProblemError.conflict('SLA already started for this feedback.', ctx.correlationId);
      const policy = await this.repo.findActiveSlaPolicy(tx, policyCode);
      if (policy === null)
        throw ProblemError.conflict('No active SLA policy for that code.', ctx.correlationId);
      const spec = policy.spec as SlaPolicySpec;
      const startMs = this.clock.now();
      const due = computeDueDates(spec, startMs);
      const iso = (ms: number): string => new Date(ms).toISOString();
      const inst = await this.repo.insertSlaInstance(tx, {
        tenantId: ctx.tenantId,
        feedbackId,
        policyCode,
        policyVersion: policy.version_number,
        startedAt: iso(startMs),
        ackDueAt: iso(due.ackAtMs),
        assignDueAt: iso(due.assignAtMs),
        responseDueAt: iso(due.responseAtMs),
        resolutionDueAt: iso(due.resolutionAtMs),
        closureDueAt: iso(due.closureAtMs),
      });
      await this.repo.patchFeedback(tx, {
        id: feedbackId,
        expectedVersion: fb.version,
        slaPolicyCode: policyCode,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.slaStarted,
        entityType: 'feedback_sla_instance',
        entityId: inst.id,
        detail: { policyCode },
      });
      return inst;
    });
  }
  async pauseSla(
    ctx: RequestContext,
    _actor: string | null,
    feedbackId: string,
    reason: string,
  ): Promise<SlaInstanceRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.slaManage);
    return this.db.withTenant(ctx, async (tx) => {
      const inst = await this.repo.findSlaInstance(tx, feedbackId);
      if (inst === null) throw ProblemError.notFound('No SLA instance.', ctx.correlationId);
      const upd = await this.repo.pauseSla(tx, { id: inst.id, expectedVersion: inst.version, reason });
      if (upd === null)
        throw ProblemError.conflict('SLA already paused or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.slaPaused,
        entityType: 'feedback_sla_instance',
        entityId: inst.id,
        reason,
        detail: {},
      });
      return upd;
    });
  }
  async resumeSla(ctx: RequestContext, _actor: string | null, feedbackId: string): Promise<SlaInstanceRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.slaManage);
    return this.db.withTenant(ctx, async (tx) => {
      const inst = await this.repo.findSlaInstance(tx, feedbackId);
      if (!inst?.paused_at) throw ProblemError.conflict('SLA is not paused.', ctx.correlationId);
      const addPaused = this.clock.now() - Date.parse(inst.paused_at);
      const upd = await this.repo.resumeSla(tx, {
        id: inst.id,
        expectedVersion: inst.version,
        addPausedMs: Math.max(0, addPaused),
      });
      if (upd === null) throw ProblemError.conflict('SLA modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.slaResumed,
        entityType: 'feedback_sla_instance',
        entityId: inst.id,
        detail: {},
      });
      return upd;
    });
  }
  /** Evaluate the resolution-stage SLA against the clock; mark + publish breach/warning deterministically. */
  async evaluateSla(ctx: RequestContext, feedbackId: string): Promise<{ breached: boolean; warn: boolean }> {
    await this.authz.require(ctx, M12_PERMISSIONS.slaRead);
    return this.db.withTenant(ctx, async (tx) => {
      const inst = await this.repo.findSlaInstance(tx, feedbackId);
      if (inst === null) throw ProblemError.notFound('No SLA instance.', ctx.correlationId);
      if (inst.resolution_due_at === null) return { breached: inst.breached, warn: false };
      const policy = await this.repo.findActiveSlaPolicy(tx, inst.sla_policy_code);
      const warnPct = policy !== null ? (policy.spec as SlaPolicySpec).warnThresholdPct : 80;
      const state = slaStageState({
        startMs: Date.parse(inst.started_at),
        dueMs: Date.parse(inst.resolution_due_at),
        nowMs: this.clock.now(),
        pausedMs: Number(inst.paused_ms),
        warnThresholdPct: warnPct,
      });
      if (state.breached && !inst.breached) {
        await this.repo.markSlaBreach(tx, {
          id: inst.id,
          expectedVersion: inst.version,
          stage: 'resolution',
        });
        await this.emitter.recordAudit(tx, ctx, {
          code: M12_AUDIT_CODES.slaBreached,
          entityType: 'feedback_sla_instance',
          entityId: inst.id,
          detail: { stage: 'resolution' },
        });
        await this.emitter.publish(tx, {
          type: 'SlaBreached',
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          payload: { feedbackId, reasonCode: 'resolution' },
        });
      } else if (state.warn && !inst.breached) {
        await this.emitter.publish(tx, {
          type: 'SlaWarning',
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          payload: { feedbackId, reasonCode: 'resolution' },
        });
      }
      return { breached: state.breached, warn: state.warn };
    });
  }

  // --- escalation (reuses m08 via an event; m12 builds no second escalation engine) --------------
  async triggerEscalation(
    ctx: RequestContext,
    actor: string | null,
    feedbackId: string,
    input: { reason: string },
  ): Promise<string> {
    await this.authz.require(ctx, M12_PERMISSIONS.escalationTrigger);
    if (input.reason.trim() === '') throw badRequest('a reason is required to escalate', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const fb = await this.repo.findFeedback(tx, feedbackId);
      if (fb === null) throw ProblemError.notFound('Feedback not found.', ctx.correlationId);
      const escalationRef = fb.escalation_ref ?? randomUUID();
      await this.repo.patchFeedback(tx, {
        id: feedbackId,
        expectedVersion: fb.version,
        escalationRef,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.escalationTriggered,
        entityType: 'feedback_record',
        entityId: feedbackId,
        reason: input.reason,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'FeedbackEscalated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          feedbackId,
          ...(fb.severity != null ? { severity: fb.severity } : {}),
          reasonCode: 'manual',
        },
      });
      return escalationRef;
    });
  }

  // --- case handoff to M13 (port + pending record + event; no fake case table) -------------------
  async requestCaseHandoff(
    ctx: RequestContext,
    actor: string | null,
    feedbackId: string,
    input: { recommendedCaseType?: string | null; summary?: string | null; idempotencyKey?: string | null },
  ): Promise<CaseHandoffRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.caseHandoffRequest);
    return this.db.withTenant(ctx, async (tx) => {
      const fb = await this.repo.findFeedback(tx, feedbackId);
      if (fb === null) throw ProblemError.notFound('Feedback not found.', ctx.correlationId);
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findHandoffByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const handoff = await this.repo.insertHandoff(tx, {
        tenantId: ctx.tenantId,
        feedbackId,
        recommendedCaseType: input.recommendedCaseType ?? null,
        severity: fb.severity,
        category: fb.category,
        summary: input.summary ?? null,
        customerRef: fb.customer_ref,
        product: fb.product,
        sourceTransactionId: fb.source_transaction_id,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.patchFeedback(tx, {
        id: feedbackId,
        expectedVersion: fb.version,
        caseHandoffStatus: 'pending',
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.caseHandoffRequested,
        entityType: 'feedback_case_handoff',
        entityId: handoff.id,
        detail: { recommendedCaseType: input.recommendedCaseType },
      });
      await this.emitter.publish(tx, {
        type: 'CaseHandoffRequested',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          feedbackId,
          handoffId: handoff.id,
          ...(input.recommendedCaseType != null ? { recommendedCaseType: input.recommendedCaseType } : {}),
          ...(fb.severity != null ? { severity: fb.severity } : {}),
          status: 'pending',
        },
      });
      return handoff;
    });
  }
  /** Called when M13 (future) creates the case; transitions the feedback to converted_to_case. */
  async completeCaseHandoff(
    ctx: RequestContext,
    actor: string | null,
    handoffId: string,
    caseRef: string,
  ): Promise<CaseHandoffRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.caseHandoffRequest);
    return this.db.withTenant(ctx, async (tx) => {
      const handoff = await this.repo.findHandoff(tx, handoffId);
      if (handoff === null) throw ProblemError.notFound('Handoff not found.', ctx.correlationId);
      const upd = await this.repo.completeHandoff(tx, {
        id: handoffId,
        expectedVersion: handoff.version,
        caseRef,
      });
      if (upd === null)
        throw ProblemError.conflict('Handoff already completed or modified concurrently.', ctx.correlationId);
      const fb = await this.repo.findFeedback(tx, handoff.feedback_id);
      if (fb !== null && checkFeedbackTransition(fb.status, 'converted_to_case').ok) {
        await this.repo.updateFeedbackStatus(tx, {
          id: fb.id,
          expectedVersion: fb.version,
          toStatus: 'converted_to_case',
          by: actor,
        });
        const fb2 = await this.repo.findFeedback(tx, fb.id);
        if (fb2 !== null)
          await this.repo.patchFeedback(tx, {
            id: fb.id,
            expectedVersion: fb2.version,
            caseHandoffStatus: 'completed',
            by: actor,
          });
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.caseHandoffCompleted,
        entityType: 'feedback_case_handoff',
        entityId: handoffId,
        detail: { caseRef },
      });
      await this.emitter.publish(tx, {
        type: 'CaseHandoffCompleted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { feedbackId: handoff.feedback_id, handoffId, status: 'completed' },
      });
      return upd;
    });
  }

  // --- relationships ----------------------------------------------------------------------------
  async link(
    ctx: RequestContext,
    actor: string | null,
    input: { fromFeedbackId: string; toFeedbackId: string; kind: string },
  ): Promise<RelationshipRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.recordUpdate);
    if (!isRelationshipKind(input.kind)) throw badRequest('invalid relationship kind', ctx.correlationId);
    if (input.fromFeedbackId === input.toFeedbackId)
      throw badRequest('a feedback cannot relate to itself', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const from = await this.repo.findFeedback(tx, input.fromFeedbackId);
      const to = await this.repo.findFeedback(tx, input.toFeedbackId);
      if (from === null || to === null)
        throw ProblemError.notFound('Both feedback records must exist in this tenant.', ctx.correlationId);
      const row = await this.repo.insertRelationship(tx, {
        tenantId: ctx.tenantId,
        fromId: input.fromFeedbackId,
        toId: input.toFeedbackId,
        kind: input.kind,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: input.kind === 'duplicate' ? M12_AUDIT_CODES.duplicateLinked : M12_AUDIT_CODES.relatedLinked,
        entityType: 'feedback_relationship',
        entityId: row.id,
        detail: { kind: input.kind, key: duplicateKey(input.toFeedbackId) },
      });
      return row;
    });
  }
  async listRelationships(ctx: RequestContext, feedbackId: string): Promise<RelationshipRow[]> {
    await this.authz.require(ctx, M12_PERMISSIONS.recordRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRelationships(tx, feedbackId));
  }
  async getHandoff(ctx: RequestContext, id: string): Promise<CaseHandoffRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.caseHandoffRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findHandoff(tx, id));
    if (r === null) throw ProblemError.notFound('Handoff not found.', ctx.correlationId);
    return r;
  }
  async getSla(ctx: RequestContext, feedbackId: string): Promise<SlaInstanceRow | null> {
    await this.authz.require(ctx, M12_PERMISSIONS.slaRead);
    return this.db.withTenant(ctx, (tx) => this.repo.findSlaInstance(tx, feedbackId));
  }
}
