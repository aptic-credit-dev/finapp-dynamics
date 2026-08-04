/**
 * ExecutionService — the GOVERNED integration execution of an already-approved posting intent, FRAMEWORK ONLY. It
 * receives opaque m21 posting-request + m22 approval references (it never approves, never reads m21/m22 tables), records
 * an execution, and drives its Framework-Only lifecycle: prepare -> (gate) dispatch -> acknowledge | fail -> retry
 * (bounded) -> exhausted, or cancel. DISPATCH NEVER CALLS OUT — it invokes the `FrameworkOnlyDispatch` adapter, which
 * performs no external request and returns a Framework-Only marker (ADR-096/101); the attempt is recorded as evidence.
 * Money (amount_minor) is carried as OPAQUE bigint evidence and never transformed. Idempotent per key (no duplicate
 * execution); optimistic-concurrency guarded; every controlled mutation is audited (FIN_INTEGRATION_ codes).
 */
import type { Audit, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M23_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { checkExecutionTransition, isExecutionActionable } from './domain/lifecycles.ts';
import { REASON_CODES } from './domain/vocab.ts';
import { evaluateDispatchGate, decideRetry, DEFAULT_RETRY_POLICY, type RetryPolicy } from './engine.ts';
import type { DispatchPort } from './ports.ts';
import { FrameworkOnlyDispatch } from './ports.ts';
import { IntegrationRepository, type ExecutionRow, type AttemptRow } from './repository.ts';

export class ExecutionService {
  private readonly db: Db;
  private readonly audit: Audit;
  private readonly dispatch: DispatchPort;
  private readonly repo: IntegrationRepository;
  constructor(
    db: Db,
    audit: Audit,
    dispatch: DispatchPort = new FrameworkOnlyDispatch(),
    repo: IntegrationRepository = new IntegrationRepository(),
  ) {
    this.db = db;
    this.audit = audit;
    this.dispatch = dispatch;
    this.repo = repo;
  }

  /**
   * Prepare an integration execution for an approved posting intent. Governance: an approval reference (m22) is
   * required — M23 never executes an unapproved intent. Idempotent per key (no duplicate execution).
   */
  async prepareExecution(
    ctx: RequestContext,
    actor: string | null,
    input: {
      destinationId?: string | null;
      postingRequestRef?: string | null;
      approvalRef: string;
      subjectType?: string;
      amountMinor?: number;
      currencyRef?: string | null;
      maxAttempts?: number;
      idempotencyKey?: string | null;
    },
  ): Promise<ExecutionRow> {
    if (input.approvalRef.trim() === '')
      throw badRequest(
        'an m22 approval reference is required (no execution without approval).',
        ctx.correlationId,
      );
    const amount = input.amountMinor ?? 0;
    if (!Number.isInteger(amount) || amount < 0)
      throw badRequest('amount must be a non-negative integer (minor units).', ctx.correlationId);
    const maxAttempts = input.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts;
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findExecutionByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing; // idempotent
      }
      const exec = await this.repo.insertExecution(tx, {
        tenantId: ctx.tenantId,
        destinationId: input.destinationId ?? null,
        postingRequestRef: input.postingRequestRef ?? null,
        approvalRef: input.approvalRef,
        subjectType: input.subjectType ?? 'journal_posting',
        amountMinor: amount,
        currencyRef: input.currencyRef ?? null,
        maxAttempts,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      if (input.idempotencyKey != null && input.idempotencyKey !== '')
        await this.repo.insertIdempotency(tx, {
          tenantId: ctx.tenantId,
          idempotencyKey: input.idempotencyKey,
          purpose: 'execution',
          executionId: exec.id,
          correlationId: ctx.correlationId,
          by: actor,
        });
      await this.repo.insertExecutionHistory(tx, {
        tenantId: ctx.tenantId,
        executionId: exec.id,
        fromStatus: null,
        toStatus: 'prepared',
        reason: null,
        reasonCode: REASON_CODES.prepared.code,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.audit.write(tx, ctx, {
        code: M23_AUDIT_CODES.executionPrepared,
        entityType: 'integration_execution',
        entityId: exec.id,
        detail: { subjectType: exec.subject_type },
      });
      return exec;
    });
  }

  /**
   * Dispatch an execution — FRAMEWORK ONLY. The gate requires an enabled, allow-listed destination and an approval
   * reference; on pass it invokes the Framework-Only adapter (NO external call) and records a `dispatched` attempt as
   * evidence. On gate failure it records the reason and refuses (fail closed). Bounded by max attempts.
   */
  async dispatchExecution(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<{ execution: ExecutionRow; attempt: AttemptRow }> {
    return this.db.withTenant(ctx, async (tx) => {
      const exec = await this.repo.findExecution(tx, id);
      if (exec === null) throw ProblemError.notFound('Execution not found.', ctx.correlationId);
      if (exec.version !== expectedVersion)
        throw ProblemError.conflict('Execution modified concurrently.', ctx.correlationId);
      if (exec.status !== 'prepared' && exec.status !== 'ready')
        throw badRequest(`a ${exec.status} execution cannot be dispatched.`, ctx.correlationId);
      if (exec.attempt_count >= exec.max_attempts)
        throw badRequest('retry attempts exhausted (bounded retry).', ctx.correlationId);

      const dest =
        exec.destination_id !== null ? await this.repo.findDestination(tx, exec.destination_id) : null;
      const gate = evaluateDispatchGate({
        destinationStatus: dest?.status ?? 'disabled',
        allowlisted: dest?.allowlisted ?? false,
        approvalRef: exec.approval_ref,
      });
      if (!gate.allowed) {
        await this.repo.insertExecutionHistory(tx, {
          tenantId: ctx.tenantId,
          executionId: id,
          fromStatus: exec.status,
          toStatus: exec.status,
          reason: 'dispatch refused',
          reasonCode: gate.reasonCode,
          by: actor,
          correlationId: ctx.correlationId,
        });
        throw ProblemError.forbidden(`dispatch refused (${gate.reasonCode}).`, ctx.correlationId);
      }

      // FRAMEWORK ONLY: this performs NO external call — it returns a marker so we can record a dispatched attempt.
      const outcome = await this.dispatch.dispatch({
        executionId: id,
        destinationType: dest?.destination_type ?? 'generic',
        approvalRef: exec.approval_ref ?? '',
      });
      if (!outcome.frameworkOnly)
        throw badRequest('only Framework-Only dispatch is permitted in the MVP.', ctx.correlationId);

      // prepared -> ready (if needed) -> dispatched.
      let current = exec;
      if (current.status === 'prepared') {
        const ready = await this.advance(ctx, tx, current, 'ready', null, actor);
        current = ready;
      }
      const attemptNo = current.attempt_count + 1;
      const dispatched = await this.repo.updateExecution(tx, {
        id,
        expectedVersion: current.version,
        status: 'dispatched',
        attemptCount: attemptNo,
        lastReasonCode: REASON_CODES.dispatchedFrameworkOnly.code,
        by: actor,
      });
      if (dispatched === null)
        throw ProblemError.conflict('Execution modified concurrently.', ctx.correlationId);
      await this.repo.insertExecutionHistory(tx, {
        tenantId: ctx.tenantId,
        executionId: id,
        fromStatus: current.status,
        toStatus: 'dispatched',
        reason: null,
        reasonCode: REASON_CODES.dispatchedFrameworkOnly.code,
        by: actor,
        correlationId: ctx.correlationId,
      });
      const attempt = await this.repo.insertAttempt(tx, {
        tenantId: ctx.tenantId,
        executionId: id,
        attemptNo,
        result: 'dispatched',
        reasonCode: REASON_CODES.dispatchedFrameworkOnly.code,
        externalRef: null,
        message: 'framework-only dispatch (no external call)',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.audit.write(tx, ctx, {
        code: M23_AUDIT_CODES.executionDispatched,
        entityType: 'integration_execution',
        entityId: id,
        detail: { attemptNo, frameworkOnly: true },
      });
      return { execution: dispatched, attempt };
    });
  }

  /** Record an external acknowledgement (evidence) — moves a dispatched execution to acknowledged (terminal success). */
  async acknowledgeExecution(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    input: { externalRef: string; externalSystem?: string | null },
  ): Promise<ExecutionRow> {
    if (input.externalRef.trim() === '')
      throw badRequest('an external reference is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const exec = await this.repo.findExecution(tx, id);
      if (exec === null) throw ProblemError.notFound('Execution not found.', ctx.correlationId);
      const t = checkExecutionTransition(exec.status, 'acknowledged');
      if (!t.ok) throw badRequest(`a ${exec.status} execution cannot be acknowledged.`, ctx.correlationId);
      const updated = await this.repo.updateExecution(tx, {
        id,
        expectedVersion,
        status: 'acknowledged',
        lastReasonCode: REASON_CODES.acknowledged.code,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Execution modified concurrently.', ctx.correlationId);
      const ref = await this.repo.insertExternalReference(tx, {
        tenantId: ctx.tenantId,
        executionId: id,
        externalSystem: input.externalSystem ?? null,
        externalRef: input.externalRef,
        refType: 'acknowledgement',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertExecutionHistory(tx, {
        tenantId: ctx.tenantId,
        executionId: id,
        fromStatus: exec.status,
        toStatus: 'acknowledged',
        reason: null,
        reasonCode: REASON_CODES.acknowledged.code,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.audit.write(tx, ctx, {
        code: M23_AUDIT_CODES.externalReferenceRecorded,
        entityType: 'external_reference',
        entityId: ref.id,
        detail: { executionId: id },
      });
      await this.audit.write(tx, ctx, {
        code: M23_AUDIT_CODES.executionAcknowledged,
        entityType: 'integration_execution',
        entityId: id,
        detail: {},
      });
      return updated;
    });
  }

  /** Record a dispatch failure. Bounded retry: schedules a retry (retryable) if attempts remain, else exhausts. */
  async failExecution(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    input: { message?: string | null; policy?: RetryPolicy },
  ): Promise<ExecutionRow> {
    return this.db.withTenant(ctx, async (tx) => {
      const exec = await this.repo.findExecution(tx, id);
      if (exec === null) throw ProblemError.notFound('Execution not found.', ctx.correlationId);
      if (exec.version !== expectedVersion)
        throw ProblemError.conflict('Execution modified concurrently.', ctx.correlationId);
      const t = checkExecutionTransition(exec.status, 'failed');
      if (!t.ok) throw badRequest(`a ${exec.status} execution cannot fail.`, ctx.correlationId);
      const policy: RetryPolicy = input.policy ?? {
        maxAttempts: exec.max_attempts,
        baseDelayMs: DEFAULT_RETRY_POLICY.baseDelayMs,
        backoff: DEFAULT_RETRY_POLICY.backoff,
      };
      const retry = decideRetry(exec.attempt_count, policy);
      const next = retry.canRetry ? 'retryable' : 'exhausted';
      // move through 'failed' then to retryable/exhausted (both are single-step from failed).
      const failed = await this.advance(ctx, tx, exec, 'failed', REASON_CODES.failedTransient.code, actor);
      const updated = await this.advance(
        ctx,
        tx,
        failed,
        next,
        retry.canRetry ? REASON_CODES.retryScheduled.code : REASON_CODES.retryExhausted.code,
        actor,
      );
      await this.repo.insertExternalReference(tx, {
        tenantId: ctx.tenantId,
        executionId: id,
        externalSystem: null,
        externalRef: `failure-${String(exec.attempt_count)}`,
        refType: 'failure',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.audit.write(tx, ctx, {
        code: retry.canRetry ? M23_AUDIT_CODES.executionFailed : M23_AUDIT_CODES.executionExhausted,
        entityType: 'integration_execution',
        entityId: id,
        detail: { attemptCount: exec.attempt_count, canRetry: retry.canRetry },
      });
      return updated;
    });
  }

  /** Schedule a retry — a retryable execution goes back to ready (bounded by max attempts). */
  async retryExecution(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<ExecutionRow> {
    return this.db.withTenant(ctx, async (tx) => {
      const exec = await this.repo.findExecution(tx, id);
      if (exec === null) throw ProblemError.notFound('Execution not found.', ctx.correlationId);
      if (exec.status !== 'retryable')
        throw badRequest('only a retryable execution can be retried.', ctx.correlationId);
      if (exec.attempt_count >= exec.max_attempts)
        throw badRequest('retry attempts exhausted (bounded retry).', ctx.correlationId);
      const updated = await this.repo.updateExecution(tx, {
        id,
        expectedVersion,
        status: 'ready',
        lastReasonCode: REASON_CODES.retryScheduled.code,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Execution modified concurrently.', ctx.correlationId);
      await this.repo.insertExecutionHistory(tx, {
        tenantId: ctx.tenantId,
        executionId: id,
        fromStatus: 'retryable',
        toStatus: 'ready',
        reason: null,
        reasonCode: REASON_CODES.retryScheduled.code,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.audit.write(tx, ctx, {
        code: M23_AUDIT_CODES.executionRetried,
        entityType: 'integration_execution',
        entityId: id,
        detail: {},
      });
      return updated;
    });
  }

  async cancelExecution(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    reason: string,
  ): Promise<ExecutionRow> {
    if (reason.trim() === '') throw badRequest('a cancellation reason is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const exec = await this.repo.findExecution(tx, id);
      if (exec === null) throw ProblemError.notFound('Execution not found.', ctx.correlationId);
      if (!isExecutionActionable(exec.status))
        throw badRequest(
          `a ${exec.status} execution is terminal and cannot be cancelled.`,
          ctx.correlationId,
        );
      const t = checkExecutionTransition(exec.status, 'cancelled');
      if (!t.ok) throw badRequest(`a ${exec.status} execution cannot be cancelled.`, ctx.correlationId);
      const updated = await this.repo.updateExecution(tx, {
        id,
        expectedVersion,
        status: 'cancelled',
        lastReasonCode: REASON_CODES.cancelled.code,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Execution modified concurrently.', ctx.correlationId);
      await this.repo.insertExecutionHistory(tx, {
        tenantId: ctx.tenantId,
        executionId: id,
        fromStatus: exec.status,
        toStatus: 'cancelled',
        reason,
        reasonCode: REASON_CODES.cancelled.code,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.audit.write(tx, ctx, {
        code: M23_AUDIT_CODES.executionCancelled,
        entityType: 'integration_execution',
        entityId: id,
        detail: { reason },
      });
      return updated;
    });
  }

  // --- helpers / reads --------------------------------------------------------------------------
  private async advance(
    ctx: RequestContext,
    tx: Tx,
    exec: ExecutionRow,
    to: string,
    reasonCode: string | null,
    actor: string | null,
  ): Promise<ExecutionRow> {
    const t = checkExecutionTransition(exec.status, to);
    if (!t.ok) throw badRequest(`cannot move a ${exec.status} execution to ${to}.`, ctx.correlationId);
    const updated = await this.repo.updateExecution(tx, {
      id: exec.id,
      expectedVersion: exec.version,
      status: to,
      ...(reasonCode !== null ? { lastReasonCode: reasonCode } : {}),
      by: actor,
    });
    if (updated === null) throw ProblemError.conflict('Execution modified concurrently.', ctx.correlationId);
    await this.repo.insertExecutionHistory(tx, {
      tenantId: ctx.tenantId,
      executionId: exec.id,
      fromStatus: exec.status,
      toStatus: to,
      reason: null,
      reasonCode,
      by: actor,
      correlationId: ctx.correlationId,
    });
    return updated;
  }

  async getExecution(
    ctx: RequestContext,
    id: string,
  ): Promise<{ execution: ExecutionRow; attempts: AttemptRow[] }> {
    return this.db.withTenant(ctx, async (tx) => {
      const execution = await this.repo.findExecution(tx, id);
      if (execution === null) throw ProblemError.notFound('Execution not found.', ctx.correlationId);
      const attempts = await this.repo.listAttempts(tx, id);
      return { execution, attempts };
    });
  }
  async listExecutions(ctx: RequestContext, status?: string): Promise<ExecutionRow[]> {
    return this.db.withTenant(ctx, (tx) => this.repo.listExecutions(tx, status));
  }
}
