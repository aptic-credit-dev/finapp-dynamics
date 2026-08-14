/**
 * M38 repository — ALL SQL across its 10 automation_/extension_ tables. Every query is parameterized; every mutating UPDATE on
 * a mutable aggregate is optimistic-lock guarded (`WHERE id=$ AND version=$expected`). Queries carry NO tenant_id predicate:
 * RLS FORCE is the isolation guarantee. All methods take the caller's `Tx`. Step/run/review/point/history + the idempotency
 * ledger are append-only. There is NO secret VALUE column — automation_step holds an opaque `secretref:` config pointer only.
 * No float (intervals are integer, next_run_at is bigint epoch).
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m38 repository: expected a row from ${what}`);
  return row;
}

export interface AutomationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly automation_key: string;
  readonly name: string;
  readonly trigger_kind: string;
  readonly state: string;
  readonly validation_passed: boolean;
  readonly content_hash: string;
  readonly version: number;
}
export interface StepRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly automation_id: string;
  readonly step_no: number;
  readonly capability_ref: string;
  readonly required_permission: string;
  readonly config_secret_ref: string | null;
}
export interface ScheduleRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly automation_id: string;
  readonly schedule_key: string;
  readonly recurrence: string;
  readonly concurrency_policy: string;
  readonly next_run_at: string | null;
  readonly status: string;
  readonly version: number;
}
export interface RunRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly automation_id: string;
  readonly run_key: string;
  readonly attempt_no: number;
  readonly status: string;
  readonly reason_code: string | null;
  readonly downstream_ref: string | null;
}
export interface ReviewRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly kind: string;
  readonly requested_by: string;
  readonly decided_by: string | null;
}
export interface ExtensionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly extension_key: string;
  readonly name: string;
  readonly trust_tier: string;
  readonly isolation_level: string;
  readonly state: string;
  readonly validation_passed: boolean;
  readonly content_hash: string;
  readonly version: number;
}
export interface InstallationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly extension_id: string;
  readonly install_key: string;
  readonly status: string;
  readonly version: number;
}

export class AutomationRepository {
  // ---- automation definition ----
  async insertAutomation(
    tx: Tx,
    a: {
      tenantId: string;
      scope: string;
      automationKey: string;
      name: string;
      triggerKind: string;
      contentHash: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<AutomationRow> {
    const { rows } = await tx.query<AutomationRow>(
      `INSERT INTO automation_definition (tenant_id, scope, automation_key, name, trigger_kind, content_hash, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING tenant_id, id, scope, automation_key, name, trigger_kind, state, validation_passed, content_hash, version`,
      [
        a.tenantId,
        a.scope,
        a.automationKey,
        a.name,
        a.triggerKind,
        a.contentHash,
        a.idempotencyKey,
        a.correlationId,
        a.by,
      ],
    );
    return firstRow(rows, 'insertAutomation');
  }
  async findAutomationByIdempotencyKey(tx: Tx, key: string): Promise<AutomationRow | null> {
    const { rows } = await tx.query<AutomationRow>(
      `SELECT tenant_id, id, scope, automation_key, name, trigger_kind, state, validation_passed, content_hash, version FROM automation_definition WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getAutomation(tx: Tx, id: string): Promise<AutomationRow | null> {
    const { rows } = await tx.query<AutomationRow>(
      `SELECT tenant_id, id, scope, automation_key, name, trigger_kind, state, validation_passed, content_hash, version FROM automation_definition WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateAutomationState(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { state: string; validationPassed: boolean; by: string | null },
  ): Promise<AutomationRow | null> {
    const { rows } = await tx.query<AutomationRow>(
      `UPDATE automation_definition SET state=$3, validation_passed=$4, version=version+1, updated_at=now(), updated_by=$5 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, scope, automation_key, name, trigger_kind, state, validation_passed, content_hash, version`,
      [id, expectedVersion, patch.state, patch.validationPassed, patch.by],
    );
    return rows[0] ?? null;
  }
  async listAutomations(tx: Tx, limit: number, offset: number): Promise<AutomationRow[]> {
    const { rows } = await tx.query<AutomationRow>(
      `SELECT tenant_id, id, scope, automation_key, name, trigger_kind, state, validation_passed, content_hash, version FROM automation_definition ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- step (append-only) ----
  async insertStep(
    tx: Tx,
    s: {
      tenantId: string;
      automationId: string;
      stepNo: number;
      capabilityRef: string;
      requiredPermission: string;
      inputRef: string | null;
      configSecretRef: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<StepRow> {
    const { rows } = await tx.query<StepRow>(
      `INSERT INTO automation_step (tenant_id, automation_id, step_no, capability_ref, required_permission, input_ref, config_secret_ref, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING tenant_id, id, automation_id, step_no, capability_ref, required_permission, config_secret_ref`,
      [
        s.tenantId,
        s.automationId,
        s.stepNo,
        s.capabilityRef,
        s.requiredPermission,
        s.inputRef,
        s.configSecretRef,
        s.correlationId,
        s.by,
      ],
    );
    return firstRow(rows, 'insertStep');
  }
  async listSteps(tx: Tx, automationId: string): Promise<StepRow[]> {
    const { rows } = await tx.query<StepRow>(
      `SELECT tenant_id, id, automation_id, step_no, capability_ref, required_permission, config_secret_ref FROM automation_step WHERE automation_id=$1 ORDER BY step_no`,
      [automationId],
    );
    return rows;
  }

  // ---- schedule ----
  async insertSchedule(
    tx: Tx,
    s: {
      tenantId: string;
      automationId: string;
      scheduleKey: string;
      recurrence: string;
      timezone: string;
      minIntervalSeconds: number;
      concurrencyPolicy: string;
      missedRunPolicy: string;
      maxRetries: number;
      timeoutSeconds: number;
      nextRunAt: number | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ScheduleRow> {
    const { rows } = await tx.query<ScheduleRow>(
      `INSERT INTO automation_schedule (tenant_id, automation_id, schedule_key, recurrence, timezone, min_interval_seconds, concurrency_policy, missed_run_policy, max_retries, timeout_seconds, next_run_at, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING tenant_id, id, automation_id, schedule_key, recurrence, concurrency_policy, next_run_at::text AS next_run_at, status, version`,
      [
        s.tenantId,
        s.automationId,
        s.scheduleKey,
        s.recurrence,
        s.timezone,
        s.minIntervalSeconds,
        s.concurrencyPolicy,
        s.missedRunPolicy,
        s.maxRetries,
        s.timeoutSeconds,
        s.nextRunAt,
        s.correlationId,
        s.by,
      ],
    );
    return firstRow(rows, 'insertSchedule');
  }
  async getSchedule(tx: Tx, id: string): Promise<ScheduleRow | null> {
    const { rows } = await tx.query<ScheduleRow>(
      `SELECT tenant_id, id, automation_id, schedule_key, recurrence, concurrency_policy, next_run_at::text AS next_run_at, status, version FROM automation_schedule WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateScheduleStatus(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { status: string; nextRunAt: number | null; by: string | null },
  ): Promise<ScheduleRow | null> {
    const { rows } = await tx.query<ScheduleRow>(
      `UPDATE automation_schedule SET status=$3, next_run_at=$4, version=version+1, updated_at=now(), updated_by=$5 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, automation_id, schedule_key, recurrence, concurrency_policy, next_run_at::text AS next_run_at, status, version`,
      [id, expectedVersion, patch.status, patch.nextRunAt, patch.by],
    );
    return rows[0] ?? null;
  }

  // ---- run (append-only) ----
  async insertRun(
    tx: Tx,
    r: {
      tenantId: string;
      automationId: string;
      scheduleId: string | null;
      runKey: string;
      attemptNo: number;
      status: string;
      reasonCode: string | null;
      downstreamRef: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<RunRow> {
    const { rows } = await tx.query<RunRow>(
      `INSERT INTO automation_run (tenant_id, automation_id, schedule_id, run_key, attempt_no, status, started_at, completed_at, reason_code, downstream_ref, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,now(),now(),$7,$8,$9,$10) RETURNING tenant_id, id, automation_id, run_key, attempt_no, status, reason_code, downstream_ref`,
      [
        r.tenantId,
        r.automationId,
        r.scheduleId,
        r.runKey,
        r.attemptNo,
        r.status,
        r.reasonCode,
        r.downstreamRef,
        r.correlationId,
        r.by,
      ],
    );
    return firstRow(rows, 'insertRun');
  }
  async hasSucceededRun(tx: Tx, automationId: string, runKey: string): Promise<boolean> {
    const { rows } = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM automation_run WHERE automation_id=$1 AND run_key=$2 AND status='succeeded'`,
      [automationId, runKey],
    );
    return Number(rows[0]?.c ?? '0') > 0;
  }
  async countRunAttempts(tx: Tx, automationId: string, runKey: string): Promise<number> {
    const { rows } = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM automation_run WHERE automation_id=$1 AND run_key=$2`,
      [automationId, runKey],
    );
    return Number(rows[0]?.c ?? '0');
  }
  async getRun(tx: Tx, id: string): Promise<RunRow | null> {
    const { rows } = await tx.query<RunRow>(
      `SELECT tenant_id, id, automation_id, run_key, attempt_no, status, reason_code, downstream_ref FROM automation_run WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }

  // ---- review (append-only maker-checker) ----
  async insertReview(
    tx: Tx,
    r: {
      tenantId: string;
      targetType: string;
      targetId: string;
      kind: string;
      requestedBy: string;
      decidedBy: string | null;
      reason: string | null;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<ReviewRow> {
    const { rows } = await tx.query<ReviewRow>(
      `INSERT INTO automation_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, reason, reason_code, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING tenant_id, id, target_type, target_id, kind, requested_by, decided_by`,
      [
        r.tenantId,
        r.targetType,
        r.targetId,
        r.kind,
        r.requestedBy,
        r.decidedBy,
        r.reason,
        r.reasonCode,
        r.correlationId,
      ],
    );
    return firstRow(rows, 'insertReview');
  }
  async findOpenReviewRequest(tx: Tx, targetType: string, targetId: string): Promise<ReviewRow | null> {
    const { rows } = await tx.query<ReviewRow>(
      `SELECT tenant_id, id, target_type, target_id, kind, requested_by, decided_by FROM automation_review WHERE target_type=$1 AND target_id=$2 AND kind='requested' ORDER BY created_at DESC LIMIT 1`,
      [targetType, targetId],
    );
    return rows[0] ?? null;
  }

  // ---- history + idempotency (append-only) ----
  async insertHistory(
    tx: Tx,
    h: {
      tenantId: string;
      targetType: string;
      targetId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO automation_history (tenant_id, target_type, target_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        h.tenantId,
        h.targetType,
        h.targetId,
        h.fromStatus,
        h.toStatus,
        h.reason,
        h.reasonCode,
        h.by,
        h.correlationId,
      ],
    );
  }
  async insertIdempotency(
    tx: Tx,
    i: {
      tenantId: string;
      idempotencyKey: string;
      targetType: string | null;
      targetId: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO automation_idempotency (tenant_id, idempotency_key, target_type, target_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [i.tenantId, i.idempotencyKey, i.targetType, i.targetId, i.correlationId, i.by],
    );
  }

  // ---- extension definition ----
  async insertExtension(
    tx: Tx,
    e: {
      tenantId: string;
      scope: string;
      extensionKey: string;
      name: string;
      publisher: string | null;
      trustTier: string;
      isolationLevel: string;
      contentHash: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ExtensionRow> {
    const { rows } = await tx.query<ExtensionRow>(
      `INSERT INTO extension_definition (tenant_id, scope, extension_key, name, publisher, trust_tier, isolation_level, content_hash, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING tenant_id, id, scope, extension_key, name, trust_tier, isolation_level, state, validation_passed, content_hash, version`,
      [
        e.tenantId,
        e.scope,
        e.extensionKey,
        e.name,
        e.publisher,
        e.trustTier,
        e.isolationLevel,
        e.contentHash,
        e.idempotencyKey,
        e.correlationId,
        e.by,
      ],
    );
    return firstRow(rows, 'insertExtension');
  }
  async findExtensionByIdempotencyKey(tx: Tx, key: string): Promise<ExtensionRow | null> {
    const { rows } = await tx.query<ExtensionRow>(
      `SELECT tenant_id, id, scope, extension_key, name, trust_tier, isolation_level, state, validation_passed, content_hash, version FROM extension_definition WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getExtension(tx: Tx, id: string): Promise<ExtensionRow | null> {
    const { rows } = await tx.query<ExtensionRow>(
      `SELECT tenant_id, id, scope, extension_key, name, trust_tier, isolation_level, state, validation_passed, content_hash, version FROM extension_definition WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateExtensionState(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { state: string; validationPassed: boolean; by: string | null },
  ): Promise<ExtensionRow | null> {
    const { rows } = await tx.query<ExtensionRow>(
      `UPDATE extension_definition SET state=$3, validation_passed=$4, version=version+1, updated_at=now(), updated_by=$5 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, scope, extension_key, name, trust_tier, isolation_level, state, validation_passed, content_hash, version`,
      [id, expectedVersion, patch.state, patch.validationPassed, patch.by],
    );
    return rows[0] ?? null;
  }
  async listExtensions(tx: Tx, limit: number, offset: number): Promise<ExtensionRow[]> {
    const { rows } = await tx.query<ExtensionRow>(
      `SELECT tenant_id, id, scope, extension_key, name, trust_tier, isolation_level, state, validation_passed, content_hash, version FROM extension_definition ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }
  async insertPoint(
    tx: Tx,
    p: {
      tenantId: string;
      extensionId: string;
      pointKey: string;
      capabilityRef: string;
      requiredPermission: string;
      description: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO extension_point (tenant_id, extension_id, point_key, capability_ref, required_permission, description, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        p.tenantId,
        p.extensionId,
        p.pointKey,
        p.capabilityRef,
        p.requiredPermission,
        p.description,
        p.correlationId,
        p.by,
      ],
    );
    return firstRow(rows, 'insertPoint');
  }
  async listPoints(
    tx: Tx,
    extensionId: string,
  ): Promise<{ point_key: string; required_permission: string }[]> {
    const { rows } = await tx.query<{ point_key: string; required_permission: string }>(
      `SELECT point_key, required_permission FROM extension_point WHERE extension_id=$1`,
      [extensionId],
    );
    return rows;
  }

  // ---- installation ----
  async insertInstallation(
    tx: Tx,
    i: {
      tenantId: string;
      extensionId: string;
      installKey: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<InstallationRow> {
    const { rows } = await tx.query<InstallationRow>(
      `INSERT INTO extension_installation (tenant_id, extension_id, install_key, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING tenant_id, id, extension_id, install_key, status, version`,
      [i.tenantId, i.extensionId, i.installKey, i.idempotencyKey, i.correlationId, i.by],
    );
    return firstRow(rows, 'insertInstallation');
  }
  async getInstallation(tx: Tx, id: string): Promise<InstallationRow | null> {
    const { rows } = await tx.query<InstallationRow>(
      `SELECT tenant_id, id, extension_id, install_key, status, version FROM extension_installation WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateInstallationStatus(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { status: string; by: string | null },
  ): Promise<InstallationRow | null> {
    const { rows } = await tx.query<InstallationRow>(
      `UPDATE extension_installation SET status=$3, version=version+1, updated_at=now(), updated_by=$4 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, extension_id, install_key, status, version`,
      [id, expectedVersion, patch.status, patch.by],
    );
    return rows[0] ?? null;
  }
}
