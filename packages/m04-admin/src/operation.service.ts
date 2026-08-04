/**
 * AdminOperationService — the ONLY M04 service that owns DB state. It manages the admin-operation request/history
 * ledger (a governed record of an admin action that delegates its EFFECT to another module), plus per-admin saved
 * views, preferences, and bounded dashboard aggregates. Every controlled mutation is authorized (default deny), audited
 * through the m03 `AUDIT` port in the SAME transaction, optimistic-concurrency guarded, and idempotency-keyed where it
 * records a delegated operation. It reads NO other module's tables. Dashboards return BOUNDED aggregates only —
 * no cross-tenant inference (RLS confines every count to the caller's tenant).
 */
import type { Audit, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M04_PERMISSIONS } from './permissions.ts';
import { M04_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import {
  checkOperationTransition,
  isOperationType,
  isSavedViewArea,
  isAdminScope,
  clampPage,
  REASON_CODES,
} from './domain.ts';
import type { Authz } from '@finapp/kernel';
import {
  AdminRepository,
  type OperationRow,
  type OperationHistoryRow,
  type SavedViewRow,
  type PreferenceRow,
} from './repository.ts';

export class AdminOperationService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly audit: Audit;
  private readonly repo: AdminRepository;
  constructor(db: Db, authz: Authz, audit: Audit, repo: AdminRepository = new AdminRepository()) {
    this.db = db;
    this.authz = authz;
    this.audit = audit;
    this.repo = repo;
  }

  /**
   * Record a governed admin operation (its EFFECT is delegated to another module's service by the caller). Idempotent
   * per key. A platform-natured operation requires a platform permission — enforced by the caller's admin.* permission
   * set; here we record the declared scope and fail closed on an unknown type/scope.
   */
  async recordOperation(
    ctx: RequestContext,
    actor: string | null,
    input: {
      operationType: string;
      scope?: string;
      targetType?: string | null;
      targetRef?: string | null;
      summary?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<OperationRow> {
    await this.authz.require(ctx, M04_PERMISSIONS.operationsRead);
    if (!isOperationType(input.operationType))
      throw badRequest('unknown admin operation type.', ctx.correlationId);
    const scope = input.scope ?? 'tenant';
    if (!isAdminScope(scope)) throw badRequest('unknown admin scope.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findOperationByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing; // idempotent
      }
      const op = await this.repo.insertOperation(tx, {
        tenantId: ctx.tenantId,
        operationType: input.operationType,
        scope,
        targetType: input.targetType ?? null,
        targetRef: input.targetRef ?? null,
        summary: input.summary ?? null,
        requestedBy: actor,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertOperationHistory(tx, {
        tenantId: ctx.tenantId,
        operationId: op.id,
        fromStatus: null,
        toStatus: 'requested',
        reason: null,
        reasonCode: REASON_CODES.requested,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.audit.write(tx, ctx, {
        code: M04_AUDIT_CODES.operationRequested,
        entityType: 'admin_operation_request',
        entityId: op.id,
        detail: { operationType: op.operation_type, scope: op.scope },
      });
      return op;
    });
  }

  /** Mark a recorded operation executed (its delegated effect succeeded in the owning module) or failed. */
  async completeOperation(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    outcome: 'completed' | 'failed',
    reason?: string,
  ): Promise<OperationRow> {
    await this.authz.require(ctx, M04_PERMISSIONS.operationsRead);
    return this.db.withTenant(ctx, async (tx) => {
      const op = await this.repo.findOperation(tx, id);
      if (op === null) throw ProblemError.notFound('Operation not found.', ctx.correlationId);
      if (op.version !== expectedVersion)
        throw ProblemError.conflict('Operation modified concurrently.', ctx.correlationId);
      const toExec = checkOperationTransition(op.status, 'executing');
      if (!toExec.ok) throw badRequest(`a ${op.status} operation cannot execute.`, ctx.correlationId);
      const executing = await this.repo.setOperationStatus(tx, {
        id,
        expectedVersion,
        status: 'executing',
        by: actor,
      });
      if (executing === null)
        throw ProblemError.conflict('Operation modified concurrently.', ctx.correlationId);
      await this.repo.insertOperationHistory(tx, {
        tenantId: ctx.tenantId,
        operationId: id,
        fromStatus: op.status,
        toStatus: 'executing',
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      const reasonCode = outcome === 'completed' ? REASON_CODES.executed : REASON_CODES.failed;
      const done = await this.repo.setOperationStatus(tx, {
        id,
        expectedVersion: executing.version,
        status: outcome,
        reasonCode,
        by: actor,
      });
      if (done === null) throw ProblemError.conflict('Operation modified concurrently.', ctx.correlationId);
      await this.repo.insertOperationHistory(tx, {
        tenantId: ctx.tenantId,
        operationId: id,
        fromStatus: 'executing',
        toStatus: outcome,
        reason: reason ?? null,
        reasonCode,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.audit.write(tx, ctx, {
        code: outcome === 'completed' ? M04_AUDIT_CODES.operationExecuted : M04_AUDIT_CODES.operationFailed,
        entityType: 'admin_operation_request',
        entityId: id,
        detail: { operationType: op.operation_type, outcome },
      });
      return done;
    });
  }

  async getOperation(
    ctx: RequestContext,
    id: string,
  ): Promise<{ operation: OperationRow; history: OperationHistoryRow[] }> {
    await this.authz.require(ctx, M04_PERMISSIONS.operationsRead);
    return this.db.withTenant(ctx, async (tx) => {
      const operation = await this.repo.findOperation(tx, id);
      if (operation === null) throw ProblemError.notFound('Operation not found.', ctx.correlationId);
      const history = await this.repo.listOperationHistory(tx, id);
      return { operation, history };
    });
  }
  async listOperations(ctx: RequestContext, status?: string): Promise<OperationRow[]> {
    await this.authz.require(ctx, M04_PERMISSIONS.operationsRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listOperations(tx, status));
  }

  // --- saved views ------------------------------------------------------------------------------
  async saveView(
    ctx: RequestContext,
    actor: string | null,
    input: { area: string; name: string; filter: unknown },
  ): Promise<SavedViewRow> {
    await this.authz.require(ctx, M04_PERMISSIONS.savedViewManage);
    if (!isSavedViewArea(input.area)) throw badRequest('unknown admin area.', ctx.correlationId);
    if (input.name.trim() === '') throw badRequest('a view name is required.', ctx.correlationId);
    if (actor === null) throw badRequest('an authenticated admin is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const view = await this.repo.insertSavedView(tx, {
        tenantId: ctx.tenantId,
        ownerRef: actor,
        area: input.area,
        name: input.name,
        filter: input.filter,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.audit.write(tx, ctx, {
        code: M04_AUDIT_CODES.savedViewSaved,
        entityType: 'admin_saved_view',
        entityId: view.id,
        detail: { area: view.area },
      });
      return view;
    });
  }
  async listViews(ctx: RequestContext, actor: string | null, area?: string): Promise<SavedViewRow[]> {
    await this.authz.require(ctx, M04_PERMISSIONS.savedViewManage);
    if (actor === null) throw badRequest('an authenticated admin is required.', ctx.correlationId);
    return this.db.withTenant(ctx, (tx) => this.repo.listSavedViews(tx, actor, area));
  }

  // --- preferences ------------------------------------------------------------------------------
  async setPreference(
    ctx: RequestContext,
    actor: string | null,
    input: { prefKey: string; prefValue: unknown },
  ): Promise<PreferenceRow> {
    await this.authz.require(ctx, M04_PERMISSIONS.preferenceManage);
    if (input.prefKey.trim() === '') throw badRequest('a preference key is required.', ctx.correlationId);
    if (actor === null) throw badRequest('an authenticated admin is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const pref = await this.repo.upsertPreference(tx, {
        tenantId: ctx.tenantId,
        ownerRef: actor,
        prefKey: input.prefKey,
        prefValue: input.prefValue,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.audit.write(tx, ctx, {
        code: M04_AUDIT_CODES.preferenceUpdated,
        entityType: 'admin_preference',
        entityId: pref.id,
        detail: { prefKey: pref.pref_key },
      });
      return pref;
    });
  }
  async listPreferences(ctx: RequestContext, actor: string | null): Promise<PreferenceRow[]> {
    await this.authz.require(ctx, M04_PERMISSIONS.preferenceManage);
    if (actor === null) throw badRequest('an authenticated admin is required.', ctx.correlationId);
    return this.db.withTenant(ctx, (tx) => this.repo.listPreferences(tx, actor));
  }

  // --- dashboard (bounded aggregates; RLS confines to the caller's tenant) -----------------------
  async dashboard(
    ctx: RequestContext,
  ): Promise<{ operationsByStatus: Record<string, number>; recentOperations: OperationRow[] }> {
    await this.authz.require(ctx, M04_PERMISSIONS.dashboardRead);
    return this.db.withTenant(ctx, async (tx) => {
      const counts = await this.repo.countOperationsByStatus(tx);
      const operationsByStatus: Record<string, number> = {};
      for (const row of counts) operationsByStatus[row.status] = Number(row.c);
      const page = clampPage(10, 0);
      const recentOperations = (await this.repo.listOperations(tx)).slice(
        page.offset,
        page.offset + page.limit,
      );
      return { operationsByStatus, recentOperations };
    });
  }
}
