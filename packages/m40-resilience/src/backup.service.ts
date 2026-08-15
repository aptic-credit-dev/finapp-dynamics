/**
 * BackupDrService — backup POLICIES + evidence, restore/failover requests (maker-checker), and DR/BC plans + drill evidence.
 * BACKUP/RESTORE/FAILOVER EXECUTION is FRAMEWORK-ONLY through a fail-closed `BackupExecutorPort` (default Unavailable -> a
 * durable BLOCKED result; NO shell / pg_dump / restore command / OS command / filesystem / network). Backup SCHEDULES are
 * OPAQUE references composing m06/m38 — m40 runs no scheduler. A restore/failover is a CONTROLLED action: maker-checker/SoD
 * (approver != requester, a human; AI/system/automation refused), privileged (resilience.restore.approve), and a terminal
 * decision is immutable (DB trigger). RTO/RPO are integer seconds (no float). Backup credentials are opaque m30 secretref:
 * pointers only. Every mutation authorizes a `resilience.*` permission (default deny) and is audited through m03 atomically.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M40_PERMISSIONS } from './permissions.ts';
import { M40_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, notFound, versionConflict } from './errors.ts';
import {
  isPlatformScope,
  isHumanActor,
  evaluateSodGate,
  isRestoreTransitionAllowed,
  isValidObjective,
  isSecretReference,
  clampPage,
  REASON_CODES,
  type RestoreState,
} from './domain.ts';
import {
  ResilienceRepository,
  type BackupPolicyRow,
  type BackupRunRow,
  type RestoreRequestRow,
  type DrPlanRow,
} from './repository.ts';
import type { M40Emitter } from './emit.ts';
import type { BackupExecutorPort } from './ports.ts';

export class BackupDrService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M40Emitter;
  private readonly executor: BackupExecutorPort;
  private readonly repo: ResilienceRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M40Emitter,
    executor: BackupExecutorPort,
    repo: ResilienceRepository = new ResilienceRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.executor = executor;
    this.repo = repo;
  }
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M40_PERMISSIONS.administer);
  }

  // ---- backup policy + run ----
  async setPolicy(
    ctx: RequestContext,
    input: {
      scope?: string;
      policyKey: string;
      targetRef: string;
      scheduleRef?: string | null;
      rtoSeconds?: number | null;
      rpoSeconds?: number | null;
      retentionDays?: number | null;
      configSecretRef?: string | null;
    },
  ): Promise<BackupPolicyRow> {
    await this.authz.require(ctx, M40_PERMISSIONS.backupManage);
    const scope = input.scope ?? 'tenant';
    if (scope !== 'platform' && scope !== 'tenant') throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (!input.policyKey || !input.targetRef)
      throw badRequest('policyKey and targetRef are required.', ctx.correlationId);
    if (
      !isValidObjective(input.rtoSeconds) ||
      !isValidObjective(input.rpoSeconds) ||
      !isValidObjective(input.retentionDays)
    )
      throw badRequest('RTO/RPO/retention must be non-negative integers.', ctx.correlationId);
    if (input.configSecretRef != null && !isSecretReference(input.configSecretRef))
      throw badRequest('backup credential must be an opaque secretref.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const policy = await this.repo.insertBackupPolicy(tx, {
        tenantId: ctx.tenantId,
        scope,
        policyKey: input.policyKey,
        targetRef: input.targetRef,
        scheduleRef: input.scheduleRef ?? null,
        rtoSeconds: input.rtoSeconds ?? null,
        rpoSeconds: input.rpoSeconds ?? null,
        retentionDays: input.retentionDays ?? null,
        configSecretRef: input.configSecretRef ?? null,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M40_AUDIT_CODES.backupPolicySet,
        entityType: 'resilience_backup_policy',
        entityId: policy.id,
        detail: { policyKey: input.policyKey, scope },
      });
      return policy;
    });
  }

  /** Run a backup — FRAMEWORK-ONLY via the fail-closed executor (unavailable -> a durable BLOCKED run). Idempotent by run_key. */
  async runBackup(ctx: RequestContext, policyId: string, input: { runKey: string }): Promise<BackupRunRow> {
    await this.authz.require(ctx, M40_PERMISSIONS.backupManage);
    return this.db.withTenant(ctx, async (tx) => {
      const policy = await this.repo.getBackupPolicy(tx, policyId);
      if (!policy) throw notFound('backup policy not found.', ctx.correlationId);
      const existing = await this.repo.findBackupRunByKey(tx, policyId, input.runKey);
      if (existing)
        throw badRequest('a backup run with this key already exists (idempotent).', ctx.correlationId);
      const outcome = await this.executor.runBackup(ctx, {
        policyRef: policyId,
        targetRef: policy.target_ref,
      });
      const result = outcome.executed ? 'succeeded' : 'blocked';
      const run = await this.repo.insertBackupRun(tx, {
        tenantId: ctx.tenantId,
        policyId,
        runKey: input.runKey,
        result,
        sizeBytes: outcome.sizeBytes ?? null,
        checksumRef: outcome.evidenceRef ?? null,
        reasonCode: outcome.reasonCode,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: outcome.executed ? M40_AUDIT_CODES.backupRunRecorded : M40_AUDIT_CODES.backupRunBlocked,
        entityType: 'resilience_backup_run',
        entityId: run.id,
        detail: { policyId, result, reasonCode: outcome.reasonCode },
      });
      await this.emitter.publishBackup(tx, outcome.executed ? 'BackupCompleted' : 'BackupBlocked', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: { backupRunId: run.id, policyId, result, reasonCode: outcome.reasonCode },
      });
      return run;
    });
  }

  // ---- restore/failover (maker-checker; framework-only execution) ----
  async requestRestore(
    ctx: RequestContext,
    input: { requestKey: string; kind?: string; targetRef: string; backupRef?: string | null },
  ): Promise<RestoreRequestRow> {
    await this.authz.require(ctx, M40_PERMISSIONS.restoreRequest);
    if (!input.requestKey || !input.targetRef)
      throw badRequest('requestKey and targetRef are required.', ctx.correlationId);
    const kind = input.kind ?? 'restore';
    if (kind !== 'restore' && kind !== 'failover')
      throw badRequest('unknown restore kind.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const req = await this.repo.insertRestoreRequest(tx, {
        tenantId: ctx.tenantId,
        requestKey: input.requestKey,
        kind,
        targetRef: input.targetRef,
        backupRef: input.backupRef ?? null,
        requestedBy: ctx.userId ?? null,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M40_AUDIT_CODES.restoreRequested,
        entityType: 'resilience_restore_request',
        entityId: req.id,
        detail: { kind, targetRef: input.targetRef },
      });
      return req;
    });
  }

  /** Approve a restore/failover — CONTROLLED: maker-checker/SoD (a human approver != requester; AI/system/automation refused). */
  async approveRestore(
    ctx: RequestContext,
    approver: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<RestoreRequestRow> {
    await this.authz.require(ctx, M40_PERMISSIONS.restoreApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const req = await this.repo.getRestoreRequest(tx, id);
      if (!req) throw notFound('restore request not found.', ctx.correlationId);
      const gate = evaluateSodGate(req.requested_by ?? '', approver);
      if (!gate.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M40_AUDIT_CODES.sodBlocked,
          entityType: 'resilience_restore_request',
          entityId: id,
          detail: { reasonCode: gate.reasonCode },
        });
        throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      }
      if (!isHumanActor(approver))
        throw governanceForbidden(REASON_CODES.notHumanApprover, ctx.correlationId);
      if (!isRestoreTransitionAllowed(req.state as RestoreState, 'approved'))
        throw governanceForbidden(REASON_CODES.invalidTransition, ctx.correlationId);
      const updated = await this.repo.updateRestoreRequest(tx, id, expectedVersion, {
        state: 'approved',
        approvedBy: approver,
        reasonCode: null,
        by: ctx.userId ?? null,
      });
      if (!updated) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetKind: 'restore',
        targetId: id,
        decision: 'approved',
        requestedBy: req.requested_by ?? '',
        decidedBy: approver,
        reasonCode: null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M40_AUDIT_CODES.restoreApproved,
        entityType: 'resilience_restore_request',
        entityId: id,
        detail: { kind: req.kind },
      });
      await this.emitter.publishDr(tx, 'RestoreApproved', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: { recordId: id, kind: req.kind, toState: 'approved' },
      });
      return updated;
    });
  }

  /** Execute an APPROVED restore/failover — FRAMEWORK-ONLY via the fail-closed executor (unavailable -> durable BLOCKED). */
  async executeRestore(ctx: RequestContext, id: string, expectedVersion: number): Promise<RestoreRequestRow> {
    await this.authz.require(ctx, M40_PERMISSIONS.restoreApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const req = await this.repo.getRestoreRequest(tx, id);
      if (!req) throw notFound('restore request not found.', ctx.correlationId);
      if (req.state !== 'approved' && req.state !== 'blocked')
        throw governanceForbidden(REASON_CODES.invalidTransition, ctx.correlationId);
      const outcome = await this.executor.runRestore(ctx, {
        requestRef: id,
        kind: req.kind,
        targetRef: req.target_ref,
        backupRef: null,
      });
      const state = outcome.executed ? 'executed' : 'blocked';
      const updated = await this.repo.updateRestoreRequest(tx, id, expectedVersion, {
        state,
        approvedBy: null,
        reasonCode: outcome.reasonCode,
        by: ctx.userId ?? null,
      });
      if (!updated) throw versionConflict(ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: outcome.executed ? M40_AUDIT_CODES.restoreExecuted : M40_AUDIT_CODES.restoreBlocked,
        entityType: 'resilience_restore_request',
        entityId: id,
        detail: { kind: req.kind, state, reasonCode: outcome.reasonCode },
      });
      return updated;
    });
  }

  async rejectRestore(
    ctx: RequestContext,
    id: string,
    expectedVersion: number,
    reasonCode: string,
  ): Promise<RestoreRequestRow> {
    await this.authz.require(ctx, M40_PERMISSIONS.restoreApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const req = await this.repo.getRestoreRequest(tx, id);
      if (!req) throw notFound('restore request not found.', ctx.correlationId);
      const updated = await this.repo.updateRestoreRequest(tx, id, expectedVersion, {
        state: 'rejected',
        approvedBy: null,
        reasonCode,
        by: ctx.userId ?? null,
      });
      if (!updated) throw versionConflict(ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M40_AUDIT_CODES.restoreRejected,
        entityType: 'resilience_restore_request',
        entityId: id,
        detail: { reasonCode },
      });
      return updated;
    });
  }

  // ---- DR plan + drill evidence ----
  async setDrPlan(
    ctx: RequestContext,
    input: { scope?: string; planKey: string; rtoSeconds?: number | null; rpoSeconds?: number | null },
  ): Promise<DrPlanRow> {
    await this.authz.require(ctx, M40_PERMISSIONS.drManage);
    const scope = input.scope ?? 'tenant';
    if (scope !== 'platform' && scope !== 'tenant') throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (!isValidObjective(input.rtoSeconds) || !isValidObjective(input.rpoSeconds))
      throw badRequest('RTO/RPO must be non-negative integers.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const plan = await this.repo.insertDrPlan(tx, {
        tenantId: ctx.tenantId,
        scope,
        planKey: input.planKey,
        rtoSeconds: input.rtoSeconds ?? null,
        rpoSeconds: input.rpoSeconds ?? null,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M40_AUDIT_CODES.drPlanSet,
        entityType: 'resilience_dr_plan',
        entityId: plan.id,
        detail: { planKey: input.planKey, scope },
      });
      return plan;
    });
  }

  /** Record a DR drill (append-only). A drill with a decision requires SoD (approver != requester, human). */
  async recordDrTest(
    ctx: RequestContext,
    planId: string,
    input: {
      testKey: string;
      scenario?: string;
      approver?: string | null;
      measuredRecoverySeconds?: number | null;
      outcome: string;
    },
  ): Promise<{ id: string }> {
    await this.authz.require(ctx, M40_PERMISSIONS.drManage);
    if (!isValidObjective(input.measuredRecoverySeconds))
      throw badRequest('measured recovery seconds must be a non-negative integer.', ctx.correlationId);
    if (!['passed', 'failed', 'inconclusive'].includes(input.outcome))
      throw badRequest('unknown outcome.', ctx.correlationId);
    const approver = input.approver ?? null;
    if (approver !== null) {
      const gate = evaluateSodGate(ctx.userId ?? '', approver);
      if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);
    }
    return this.db.withTenant(ctx, async (tx) => {
      const plan = await this.repo.getDrPlan(tx, planId);
      if (!plan) throw notFound('DR plan not found.', ctx.correlationId);
      const row = await this.repo.insertDrTest(tx, {
        tenantId: ctx.tenantId,
        planId,
        testKey: input.testKey,
        scenario: input.scenario ?? null,
        requestedBy: ctx.userId ?? null,
        approvedBy: approver,
        measuredRecoverySeconds: input.measuredRecoverySeconds ?? null,
        outcome: input.outcome,
        reasonCode: null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M40_AUDIT_CODES.drTestRecorded,
        entityType: 'resilience_dr_test',
        entityId: row.id,
        detail: { planId, outcome: input.outcome },
      });
      await this.emitter.publishDr(tx, 'DrTestCompleted', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: { recordId: row.id, planId, toState: input.outcome },
      });
      return { id: row.id };
    });
  }

  async getRestore(ctx: RequestContext, id: string): Promise<RestoreRequestRow | null> {
    await this.authz.require(ctx, M40_PERMISSIONS.drRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getRestoreRequest(tx, id));
  }
  async listRestores(ctx: RequestContext, page?: number, size?: number): Promise<RestoreRequestRow[]> {
    await this.authz.require(ctx, M40_PERMISSIONS.drRead);
    const { limit, offset } = clampPage(page, size);
    return this.db.withTenant(ctx, (tx) => this.repo.listRestoreRequests(tx, limit, offset));
  }
}
