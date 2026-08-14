/**
 * AutomationService — the governed automation catalog + orchestration. Define an automation, add STEPS (each referencing a
 * REGISTERED capability by opaque ref + the m02 permission it requires — the facade rule; no raw code), set a recurring
 * SCHEDULE (governed recurrence, frequency floor; composes m06's timer through a fail-closed port), validate, send for review,
 * and ACTIVATE (a controlled action — maker-checker/SoD over a passing validation; an active automation is immutable via DB
 * trigger). A RUN executes each step through the fail-closed CapabilityInvokerPort (framework-only; the owning module
 * enforces its own authorization; an unavailable capability yields a durable BLOCKED run) and records append-only evidence
 * (idempotent by run_key). Every mutation authorizes an `automation.*` permission (default deny) and is audited through m03 in
 * the same transaction. AI/system/automation never approve; a step's secret config is an opaque m30 secretref: pointer only.
 */
import { createHash } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M38_PERMISSIONS } from './permissions.ts';
import { M38_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, versionConflict } from './errors.ts';
import {
  isScope,
  isPlatformScope,
  isTriggerKind,
  isThreeSegmentPermission,
  isConcurrencyPolicy,
  isMissedRunPolicy,
  isSecretReference,
  validateAutomation,
  validateRecurrence,
  computeNextRun,
  evaluateActivationGate,
  evaluateSodGate,
  clampPage,
  M38_LIMITS,
  REASON_CODES,
} from './domain.ts';
import {
  AutomationRepository,
  type AutomationRow,
  type StepRow,
  type ScheduleRow,
  type RunRow,
} from './repository.ts';
import type { M38Emitter } from './emit.ts';
import type { CapabilityInvokerPort, TimerSchedulerPort } from './ports.ts';

export function contentHashOf(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')}`;
}

export class AutomationService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M38Emitter;
  private readonly invoker: CapabilityInvokerPort;
  private readonly timer: TimerSchedulerPort;
  private readonly repo: AutomationRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M38Emitter,
    invoker: CapabilityInvokerPort,
    timer: TimerSchedulerPort,
    repo: AutomationRepository = new AutomationRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.invoker = invoker;
    this.timer = timer;
    this.repo = repo;
  }
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M38_PERMISSIONS.administer);
  }

  async defineAutomation(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      automationKey: string;
      name: string;
      triggerKind?: string;
      idempotencyKey?: string | null;
    },
  ): Promise<AutomationRow> {
    await this.authz.require(ctx, M38_PERMISSIONS.jobManage);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    const triggerKind = input.triggerKind ?? 'schedule';
    if (!isTriggerKind(triggerKind)) throw badRequest('unknown trigger kind.', ctx.correlationId);
    if (input.automationKey.trim() === '' || input.name.trim() === '')
      throw badRequest('an automation key and name are required.', ctx.correlationId);
    const contentHash = contentHashOf({ automationKey: input.automationKey, triggerKind });
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findAutomationByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const automation = await this.repo.insertAutomation(tx, {
        tenantId: ctx.tenantId,
        scope,
        automationKey: input.automationKey,
        name: input.name,
        triggerKind,
        contentHash,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'automation',
        targetId: automation.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: REASON_CODES.automationDefined,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M38_AUDIT_CODES.automationDefined,
        entityType: 'automation_definition',
        entityId: automation.id,
        detail: { automationKey: input.automationKey, triggerKind, scope },
      });
      return automation;
    });
  }

  /** Add an ordered step referencing a REGISTERED capability + the m02 permission it requires (facade rule; no raw code). */
  async addStep(
    ctx: RequestContext,
    actor: string | null,
    automationId: string,
    input: {
      stepNo: number;
      capabilityRef: string;
      requiredPermission: string;
      inputRef?: string | null;
      configSecretRef?: string | null;
    },
  ): Promise<StepRow> {
    await this.authz.require(ctx, M38_PERMISSIONS.jobManage);
    if (input.capabilityRef.trim() === '')
      throw badRequest('a capability reference is required.', ctx.correlationId);
    if (!isThreeSegmentPermission(input.requiredPermission))
      throw badRequest(
        'a step must carry a 3-segment m02 permission (automation never bypasses RBAC).',
        ctx.correlationId,
      );
    if (
      input.configSecretRef != null &&
      input.configSecretRef !== '' &&
      !isSecretReference(input.configSecretRef)
    )
      throw governanceForbidden(REASON_CODES.invalidSecretReference, ctx.correlationId);
    if (!Number.isInteger(input.stepNo) || input.stepNo < 1)
      throw badRequest('a step number must be a positive integer.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const automation = await this.repo.getAutomation(tx, automationId);
      if (automation === null) throw badRequest('unknown automation.', ctx.correlationId);
      if (automation.state !== 'draft')
        throw badRequest('steps can only be added while the automation is a draft.', ctx.correlationId);
      const step = await this.repo.insertStep(tx, {
        tenantId: ctx.tenantId,
        automationId,
        stepNo: input.stepNo,
        capabilityRef: input.capabilityRef,
        requiredPermission: input.requiredPermission,
        inputRef: input.inputRef ?? null,
        configSecretRef: input.configSecretRef ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M38_AUDIT_CODES.automationStepAdded,
        entityType: 'automation_step',
        entityId: step.id,
        detail: {
          automationId,
          capabilityRef: input.capabilityRef,
          requiredPermission: input.requiredPermission,
        },
      });
      return step;
    });
  }

  /** Set a recurring schedule (GOVERNED recurrence + frequency floor; composes m06's timer through a fail-closed port). */
  async setSchedule(
    ctx: RequestContext,
    actor: string | null,
    automationId: string,
    input: {
      scheduleKey: string;
      recurrence: string;
      timezone?: string;
      concurrencyPolicy?: string;
      missedRunPolicy?: string;
      maxRetries?: number;
      timeoutSeconds?: number;
      anchorEpochSeconds?: number | null;
    },
  ): Promise<ScheduleRow> {
    await this.authz.require(ctx, M38_PERMISSIONS.jobManage);
    if (input.scheduleKey.trim() === '') throw badRequest('a schedule key is required.', ctx.correlationId);
    const recFindings = validateRecurrence(input.recurrence);
    if (recFindings.length > 0)
      throw governanceForbidden(recFindings[0]?.code ?? REASON_CODES.invalidRecurrence, ctx.correlationId);
    const concurrencyPolicy = input.concurrencyPolicy ?? 'forbid';
    const missedRunPolicy = input.missedRunPolicy ?? 'skip';
    if (!isConcurrencyPolicy(concurrencyPolicy))
      throw badRequest('unknown concurrency policy.', ctx.correlationId);
    if (!isMissedRunPolicy(missedRunPolicy))
      throw badRequest('unknown missed-run policy.', ctx.correlationId);
    const nextRunAt =
      input.anchorEpochSeconds != null ? computeNextRun(input.recurrence, input.anchorEpochSeconds) : null;
    return this.db.withTenant(ctx, async (tx) => {
      const automation = await this.repo.getAutomation(tx, automationId);
      if (automation === null) throw badRequest('unknown automation.', ctx.correlationId);
      const schedule = await this.repo.insertSchedule(tx, {
        tenantId: ctx.tenantId,
        automationId,
        scheduleKey: input.scheduleKey,
        recurrence: input.recurrence,
        timezone: input.timezone ?? 'UTC',
        minIntervalSeconds: M38_LIMITS.minIntervalSeconds,
        concurrencyPolicy,
        missedRunPolicy,
        maxRetries: input.maxRetries ?? 0,
        timeoutSeconds: input.timeoutSeconds ?? 300,
        nextRunAt,
        correlationId: ctx.correlationId,
        by: actor,
      });
      // Compose m06's durable timer per occurrence (fail-closed; m38 owns no timer engine).
      if (nextRunAt !== null)
        await this.timer.scheduleOccurrence(ctx, {
          scheduleId: schedule.id,
          fireAtEpochSeconds: nextRunAt,
          dedupeKey: `${schedule.id}:${nextRunAt}`,
        });
      await this.emitter.recordAudit(tx, ctx, {
        code: M38_AUDIT_CODES.automationScheduleSet,
        entityType: 'automation_schedule',
        entityId: schedule.id,
        detail: { automationId, recurrence: input.recurrence, concurrencyPolicy },
      });
      return schedule;
    });
  }

  async validateAutomationById(
    ctx: RequestContext,
    actor: string | null,
    automationId: string,
    expectedVersion: number,
  ): Promise<{ passed: boolean; findings: readonly { code: string; ref?: string }[] }> {
    await this.authz.require(ctx, M38_PERMISSIONS.jobManage);
    return this.db.withTenant(ctx, async (tx) => {
      const automation = await this.repo.getAutomation(tx, automationId);
      if (automation === null) throw badRequest('unknown automation.', ctx.correlationId);
      const steps = await this.repo.listSteps(tx, automationId);
      const outcome = validateAutomation({
        automationKey: automation.automation_key,
        triggerKind: automation.trigger_kind,
        steps: steps.map((s) => ({
          capabilityRef: s.capability_ref,
          requiredPermission: s.required_permission,
        })),
      });
      if (outcome.passed) {
        const moved = await this.repo.updateAutomationState(tx, automationId, expectedVersion, {
          state: 'draft',
          validationPassed: true,
          by: actor,
        });
        if (moved === null) throw versionConflict(ctx.correlationId);
        await this.emitter.recordAudit(tx, ctx, {
          code: M38_AUDIT_CODES.automationDefined,
          entityType: 'automation_definition',
          entityId: automationId,
          detail: { reasonCode: 'validated', stepCount: steps.length },
        });
      } else {
        await this.emitter.recordAudit(tx, ctx, {
          code: M38_AUDIT_CODES.sodBlocked,
          entityType: 'automation_definition',
          entityId: automationId,
          detail: { reasonCode: outcome.findings[0]?.code ?? REASON_CODES.structuralInvalid },
        });
      }
      return outcome;
    });
  }

  async requestReview(
    ctx: RequestContext,
    actor: string | null,
    automationId: string,
    expectedVersion: number,
  ): Promise<AutomationRow> {
    await this.authz.require(ctx, M38_PERMISSIONS.jobManage);
    if (actor === null || actor.trim() === '')
      throw badRequest('an identified requester is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const automation = await this.repo.getAutomation(tx, automationId);
      if (automation === null) throw badRequest('unknown automation.', ctx.correlationId);
      if (automation.state !== 'draft' || !automation.validation_passed)
        throw badRequest('only a validated draft automation can be sent for review.', ctx.correlationId);
      const moved = await this.repo.updateAutomationState(tx, automationId, expectedVersion, {
        state: 'review_pending',
        validationPassed: true,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'automation',
        targetId: automationId,
        kind: 'requested',
        requestedBy: actor,
        decidedBy: null,
        reason: null,
        reasonCode: REASON_CODES.reviewRequested,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M38_AUDIT_CODES.automationReviewRequested,
        entityType: 'automation_definition',
        entityId: automationId,
        detail: { automationKey: automation.automation_key },
      });
      return moved;
    });
  }

  /** Activate an automation — a controlled action (maker-checker/SoD over a passing validation). AI never approves. */
  async activateAutomation(
    ctx: RequestContext,
    actor: string | null,
    automationId: string,
    expectedVersion: number,
  ): Promise<AutomationRow> {
    await this.authz.require(ctx, M38_PERMISSIONS.jobActivate);
    return this.db.withTenant(ctx, async (tx) => {
      const automation = await this.repo.getAutomation(tx, automationId);
      if (automation === null) throw badRequest('unknown automation.', ctx.correlationId);
      await this.authorizeScope(ctx, automation.scope);
      if (automation.state !== 'review_pending')
        throw badRequest('only an automation in review can be activated.', ctx.correlationId);
      const request = await this.repo.findOpenReviewRequest(tx, 'automation', automationId);
      const gate = evaluateActivationGate({
        validationPassed: automation.validation_passed,
        requestedBy: request?.requested_by ?? '',
        approver: actor,
      });
      if (!gate.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M38_AUDIT_CODES.sodBlocked,
          entityType: 'automation_definition',
          entityId: automationId,
          detail: { reasonCode: gate.reasonCode },
        });
        throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      }
      const moved = await this.repo.updateAutomationState(tx, automationId, expectedVersion, {
        state: 'active',
        validationPassed: true,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'automation',
        targetId: automationId,
        kind: 'approved',
        requestedBy: request?.requested_by ?? '',
        decidedBy: actor,
        reason: null,
        reasonCode: REASON_CODES.activated,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'automation',
        targetId: automationId,
        fromStatus: 'review_pending',
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.activated,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M38_AUDIT_CODES.automationActivated,
        entityType: 'automation_definition',
        entityId: automationId,
        detail: { automationKey: automation.automation_key },
      });
      await this.emitter.publishAutomation(tx, 'AutomationActivated', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: automationId,
          recordType: 'automation',
          toStatus: 'active',
          reasonCode: REASON_CODES.activated,
        },
      });
      return moved;
    });
  }

  async rejectReview(
    ctx: RequestContext,
    actor: string | null,
    automationId: string,
    expectedVersion: number,
    reason: string | null = null,
  ): Promise<AutomationRow> {
    await this.authz.require(ctx, M38_PERMISSIONS.jobActivate);
    return this.db.withTenant(ctx, async (tx) => {
      const automation = await this.repo.getAutomation(tx, automationId);
      if (automation === null) throw badRequest('unknown automation.', ctx.correlationId);
      if (automation.state !== 'review_pending')
        throw badRequest('only an automation in review can be rejected.', ctx.correlationId);
      const request = await this.repo.findOpenReviewRequest(tx, 'automation', automationId);
      const sod = evaluateSodGate(request?.requested_by ?? '', actor);
      if (!sod.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M38_AUDIT_CODES.sodBlocked,
          entityType: 'automation_definition',
          entityId: automationId,
          detail: { reasonCode: sod.reasonCode },
        });
        throw governanceForbidden(sod.reasonCode, ctx.correlationId);
      }
      const moved = await this.repo.updateAutomationState(tx, automationId, expectedVersion, {
        state: 'draft',
        validationPassed: automation.validation_passed,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'automation',
        targetId: automationId,
        kind: 'rejected',
        requestedBy: request?.requested_by ?? '',
        decidedBy: actor,
        reason,
        reasonCode: REASON_CODES.rejected,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M38_AUDIT_CODES.automationReviewRejected,
        entityType: 'automation_definition',
        entityId: automationId,
        detail: {},
      });
      return moved;
    });
  }

  async suspendAutomation(
    ctx: RequestContext,
    actor: string | null,
    automationId: string,
  ): Promise<AutomationRow> {
    await this.authz.require(ctx, M38_PERMISSIONS.jobManage);
    return this.db.withTenant(ctx, async (tx) => {
      const automation = await this.repo.getAutomation(tx, automationId);
      if (automation === null) throw badRequest('unknown automation.', ctx.correlationId);
      if (automation.state !== 'active')
        throw badRequest('only an active automation can be suspended.', ctx.correlationId);
      const moved = await this.repo.updateAutomationState(tx, automationId, automation.version, {
        state: 'suspended',
        validationPassed: automation.validation_passed,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'automation',
        targetId: automationId,
        fromStatus: 'active',
        toStatus: 'suspended',
        reason: null,
        reasonCode: REASON_CODES.suspended,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M38_AUDIT_CODES.automationSuspended,
        entityType: 'automation_definition',
        entityId: automationId,
        detail: {},
      });
      await this.emitter.publishAutomation(tx, 'AutomationSuspended', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: automationId,
          recordType: 'automation',
          toStatus: 'suspended',
          reasonCode: REASON_CODES.suspended,
        },
      });
      return moved;
    });
  }

  /** Run an active automation — executes each step through the fail-closed CapabilityInvokerPort (framework-only; the owning
   * module enforces its own governance). Idempotent by run_key. Records append-only evidence; never executes arbitrary code. */
  async runAutomation(
    ctx: RequestContext,
    actor: string | null,
    automationId: string,
    input: { runKey: string; scheduleId?: string | null },
  ): Promise<RunRow> {
    await this.authz.require(ctx, M38_PERMISSIONS.jobActivate);
    if (input.runKey.trim() === '') throw badRequest('a run key is required.', ctx.correlationId);
    // Phase 1 — load + idempotency + resolve steps (inside a read tx).
    const prepared = await this.db.withTenant(ctx, async (tx) => {
      const automation = await this.repo.getAutomation(tx, automationId);
      if (automation === null) throw badRequest('unknown automation.', ctx.correlationId);
      if (automation.state !== 'active')
        throw governanceForbidden(REASON_CODES.automationNotActive, ctx.correlationId);
      if (await this.repo.hasSucceededRun(tx, automationId, input.runKey))
        throw badRequest('this run key already succeeded (idempotent).', ctx.correlationId);
      const steps = await this.repo.listSteps(tx, automationId);
      const attempts = await this.repo.countRunAttempts(tx, automationId, input.runKey);
      return { steps, attempts };
    });

    // Phase 2 — invoke each registered capability through the fail-closed port (outside the write tx; framework-only egress).
    let allOk = prepared.steps.length > 0;
    let downstreamRef: string | null = null;
    let reasonCode: string = REASON_CODES.runRecorded;
    for (const step of prepared.steps) {
      const outcome = await this.invoker.invoke(ctx, {
        capabilityRef: step.capability_ref,
        requiredPermission: step.required_permission,
        inputRef: null,
      });
      if (!outcome.ok) {
        allOk = false;
        reasonCode = REASON_CODES.capabilityUnavailable;
        break;
      }
      downstreamRef = outcome.downstreamRef ?? downstreamRef;
    }
    const status = allOk ? 'succeeded' : 'blocked';

    // Phase 3 — record append-only evidence + audit + event.
    return this.db.withTenant(ctx, async (tx) => {
      const run = await this.repo.insertRun(tx, {
        tenantId: ctx.tenantId,
        automationId,
        scheduleId: input.scheduleId ?? null,
        runKey: input.runKey,
        attemptNo: prepared.attempts + 1,
        status,
        reasonCode,
        downstreamRef,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: allOk ? M38_AUDIT_CODES.runRecorded : M38_AUDIT_CODES.runBlocked,
        entityType: 'automation_run',
        entityId: run.id,
        detail: { automationId, status },
      });
      await this.emitter.publishAutomation(tx, allOk ? 'RunSucceeded' : 'RunFailed', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { recordId: run.id, recordType: 'run', toStatus: status, reasonCode },
      });
      return run;
    });
  }

  async getAutomation(ctx: RequestContext, id: string): Promise<AutomationRow | null> {
    await this.authz.require(ctx, M38_PERMISSIONS.jobRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getAutomation(tx, id));
  }
  async getRun(ctx: RequestContext, id: string): Promise<RunRow | null> {
    await this.authz.require(ctx, M38_PERMISSIONS.executionRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getRun(tx, id));
  }
  async listAutomations(
    ctx: RequestContext,
    page?: { limit?: number; offset?: number },
  ): Promise<AutomationRow[]> {
    await this.authz.require(ctx, M38_PERMISSIONS.jobRead);
    const { limit, offset } = clampPage(page?.limit, page?.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listAutomations(tx, limit, offset));
  }
}
