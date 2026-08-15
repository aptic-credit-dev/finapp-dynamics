/**
 * M40 repository — ALL SQL across its 13 resilience_ tables. Every query is parameterized; every mutating UPDATE on a mutable
 * aggregate is optimistic-lock guarded (`WHERE id=$ AND version=$expected`). Queries carry NO tenant_id predicate: RLS FORCE is
 * the isolation guarantee. All methods take the caller's `Tx`. Offline-evidence, health-signal, backup-run, dr-test, review,
 * history + the idempotency ledger are append-only. RTO/RPO/retention/latency/size are integer/bigint (no float). There is NO
 * secret VALUE column — config_secret_ref columns are opaque secretref: pointers only.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m40 repository: expected a row from ${what}`);
  return row;
}

export interface DeviceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly device_key: string;
  readonly platform: string;
  readonly trust_state: string;
  readonly version: number;
}
export interface OfflineRequestRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly device_id: string;
  readonly request_key: string;
  readonly capability_ref: string;
  readonly required_permission: string;
  readonly controlled: boolean;
  readonly sync_state: string;
  readonly validated_online: boolean;
  readonly downstream_ref: string | null;
  readonly expired: boolean;
  readonly version: number;
}
export interface BackupPolicyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly policy_key: string;
  readonly target_ref: string;
  readonly state: string;
  readonly rto_seconds: number | null;
  readonly rpo_seconds: number | null;
  readonly version: number;
}
export interface BackupRunRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly policy_id: string;
  readonly run_key: string;
  readonly result: string;
}
export interface RestoreRequestRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_key: string;
  readonly kind: string;
  readonly target_ref: string;
  readonly state: string;
  readonly requested_by: string | null;
  readonly approved_by: string | null;
  readonly version: number;
}
export interface DrPlanRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly plan_key: string;
  readonly state: string;
  readonly version: number;
}

export class ResilienceRepository {
  // ---- device (mutable) ----
  async insertDevice(
    tx: Tx,
    d: {
      tenantId: string;
      deviceKey: string;
      platform: string;
      actorRef: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<DeviceRow> {
    const { rows } = await tx.query<DeviceRow>(
      `INSERT INTO resilience_device (tenant_id, device_key, platform, actor_ref, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6)
       RETURNING tenant_id, id, device_key, platform, trust_state, version`,
      [d.tenantId, d.deviceKey, d.platform, d.actorRef, d.correlationId, d.by],
    );
    return firstRow(rows, 'insertDevice');
  }
  async getDevice(tx: Tx, id: string): Promise<DeviceRow | null> {
    const { rows } = await tx.query<DeviceRow>(
      `SELECT tenant_id, id, device_key, platform, trust_state, version FROM resilience_device WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateDeviceState(
    tx: Tx,
    id: string,
    expectedVersion: number,
    state: string,
    by: string | null,
  ): Promise<DeviceRow | null> {
    const { rows } = await tx.query<DeviceRow>(
      `UPDATE resilience_device SET trust_state=$3, last_sync_at=now(), version=version+1, updated_at=now(), updated_by=$4
       WHERE id=$1 AND version=$2 RETURNING tenant_id, id, device_key, platform, trust_state, version`,
      [id, expectedVersion, state, by],
    );
    return rows[0] ?? null;
  }
  async listDevices(tx: Tx, limit: number, offset: number): Promise<DeviceRow[]> {
    const { rows } = await tx.query<DeviceRow>(
      `SELECT tenant_id, id, device_key, platform, trust_state, version FROM resilience_device ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- offline request (mutable; the load-bearing finalize guard is a DB CHECK) ----
  async insertOfflineRequest(
    tx: Tx,
    o: {
      tenantId: string;
      deviceId: string;
      requestKey: string;
      capabilityRef: string;
      requiredPermission: string;
      controlled: boolean;
      payloadRef: string | null;
      configSecretRef: string | null;
      expiresAt: Date | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<OfflineRequestRow> {
    const { rows } = await tx.query<OfflineRequestRow>(
      `INSERT INTO resilience_offline_request (tenant_id, device_id, request_key, capability_ref, required_permission, controlled, payload_ref, config_secret_ref, expires_at, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       RETURNING tenant_id, id, device_id, request_key, capability_ref, required_permission, controlled, sync_state, validated_online, downstream_ref, (expires_at IS NOT NULL AND expires_at < now()) AS expired, version`,
      [
        o.tenantId,
        o.deviceId,
        o.requestKey,
        o.capabilityRef,
        o.requiredPermission,
        o.controlled,
        o.payloadRef,
        o.configSecretRef,
        o.expiresAt,
        o.correlationId,
        o.by,
      ],
    );
    return firstRow(rows, 'insertOfflineRequest');
  }
  async findOfflineRequestByKey(tx: Tx, requestKey: string): Promise<OfflineRequestRow | null> {
    const { rows } = await tx.query<OfflineRequestRow>(
      `SELECT tenant_id, id, device_id, request_key, capability_ref, required_permission, controlled, sync_state, validated_online, downstream_ref, (expires_at IS NOT NULL AND expires_at < now()) AS expired, version
       FROM resilience_offline_request WHERE request_key=$1 LIMIT 1`,
      [requestKey],
    );
    return rows[0] ?? null;
  }
  async getOfflineRequest(tx: Tx, id: string): Promise<OfflineRequestRow | null> {
    const { rows } = await tx.query<OfflineRequestRow>(
      `SELECT tenant_id, id, device_id, request_key, capability_ref, required_permission, controlled, sync_state, validated_online, downstream_ref, (expires_at IS NOT NULL AND expires_at < now()) AS expired, version
       FROM resilience_offline_request WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateOfflineRequest(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: {
      syncState: string;
      validatedOnline: boolean;
      downstreamRef: string | null;
      reasonCode: string | null;
      by: string | null;
    },
  ): Promise<OfflineRequestRow | null> {
    const { rows } = await tx.query<OfflineRequestRow>(
      `UPDATE resilience_offline_request
         SET sync_state=$3, validated_online=$4, downstream_ref=$5, reason_code=$6, version=version+1, updated_at=now(), updated_by=$7
       WHERE id=$1 AND version=$2
       RETURNING tenant_id, id, device_id, request_key, capability_ref, required_permission, controlled, sync_state, validated_online, downstream_ref, (expires_at IS NOT NULL AND expires_at < now()) AS expired, version`,
      [
        id,
        expectedVersion,
        patch.syncState,
        patch.validatedOnline,
        patch.downstreamRef,
        patch.reasonCode,
        patch.by,
      ],
    );
    return rows[0] ?? null;
  }
  async insertOfflineEvidence(
    tx: Tx,
    e: {
      tenantId: string;
      requestId: string;
      outcome: string;
      validatedBy: string | null;
      downstreamRef: string | null;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO resilience_offline_evidence (tenant_id, request_id, outcome, validated_by, downstream_ref, reason_code, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [e.tenantId, e.requestId, e.outcome, e.validatedBy, e.downstreamRef, e.reasonCode, e.correlationId],
    );
  }

  // ---- observability (check mutable; signal append-only) ----
  async insertCheck(
    tx: Tx,
    c: {
      tenantId: string;
      checkKey: string;
      component: string;
      signalKind: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO resilience_check (tenant_id, check_key, component, signal_kind, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
      [c.tenantId, c.checkKey, c.component, c.signalKind, c.correlationId, c.by],
    );
    return firstRow(rows, 'insertCheck');
  }
  async insertHealthSignal(
    tx: Tx,
    s: {
      tenantId: string;
      checkId: string | null;
      component: string;
      signalKind: string;
      state: string;
      latencyMs: number | null;
      resultCode: string | null;
      evidenceRef: string | null;
      correlationId: string;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO resilience_health_signal (tenant_id, check_id, component, signal_kind, state, latency_ms, result_code, evidence_ref, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        s.tenantId,
        s.checkId,
        s.component,
        s.signalKind,
        s.state,
        s.latencyMs,
        s.resultCode,
        s.evidenceRef,
        s.correlationId,
      ],
    );
    return firstRow(rows, 'insertHealthSignal');
  }

  // ---- backup policy (mutable) + run (append-only) ----
  async insertBackupPolicy(
    tx: Tx,
    p: {
      tenantId: string;
      scope: string;
      policyKey: string;
      targetRef: string;
      scheduleRef: string | null;
      rtoSeconds: number | null;
      rpoSeconds: number | null;
      retentionDays: number | null;
      configSecretRef: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<BackupPolicyRow> {
    const { rows } = await tx.query<BackupPolicyRow>(
      `INSERT INTO resilience_backup_policy (tenant_id, scope, policy_key, target_ref, schedule_ref, rto_seconds, rpo_seconds, retention_days, config_secret_ref, state, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11,$11)
       RETURNING tenant_id, id, scope, policy_key, target_ref, state, rto_seconds, rpo_seconds, version`,
      [
        p.tenantId,
        p.scope,
        p.policyKey,
        p.targetRef,
        p.scheduleRef,
        p.rtoSeconds,
        p.rpoSeconds,
        p.retentionDays,
        p.configSecretRef,
        p.correlationId,
        p.by,
      ],
    );
    return firstRow(rows, 'insertBackupPolicy');
  }
  async getBackupPolicy(tx: Tx, id: string): Promise<BackupPolicyRow | null> {
    const { rows } = await tx.query<BackupPolicyRow>(
      `SELECT tenant_id, id, scope, policy_key, target_ref, state, rto_seconds, rpo_seconds, version FROM resilience_backup_policy WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async insertBackupRun(
    tx: Tx,
    r: {
      tenantId: string;
      policyId: string;
      runKey: string;
      result: string;
      sizeBytes: number | null;
      checksumRef: string | null;
      reasonCode: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<BackupRunRow> {
    const { rows } = await tx.query<BackupRunRow>(
      `INSERT INTO resilience_backup_run (tenant_id, policy_id, run_key, started_at, completed_at, result, size_bytes, checksum_ref, reason_code, correlation_id, created_by)
       VALUES ($1,$2,$3,now(),now(),$4,$5,$6,$7,$8,$9)
       RETURNING tenant_id, id, policy_id, run_key, result`,
      [
        r.tenantId,
        r.policyId,
        r.runKey,
        r.result,
        r.sizeBytes,
        r.checksumRef,
        r.reasonCode,
        r.correlationId,
        r.by,
      ],
    );
    return firstRow(rows, 'insertBackupRun');
  }
  async findBackupRunByKey(tx: Tx, policyId: string, runKey: string): Promise<BackupRunRow | null> {
    const { rows } = await tx.query<BackupRunRow>(
      `SELECT tenant_id, id, policy_id, run_key, result FROM resilience_backup_run WHERE policy_id=$1 AND run_key=$2 LIMIT 1`,
      [policyId, runKey],
    );
    return rows[0] ?? null;
  }

  // ---- restore/failover request (mutable; terminal-immutable trigger) ----
  async insertRestoreRequest(
    tx: Tx,
    r: {
      tenantId: string;
      requestKey: string;
      kind: string;
      targetRef: string;
      backupRef: string | null;
      requestedBy: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<RestoreRequestRow> {
    const { rows } = await tx.query<RestoreRequestRow>(
      `INSERT INTO resilience_restore_request (tenant_id, request_key, kind, target_ref, backup_ref, state, requested_by, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,'review_pending',$6,$7,$8,$8)
       RETURNING tenant_id, id, request_key, kind, target_ref, state, requested_by, approved_by, version`,
      [r.tenantId, r.requestKey, r.kind, r.targetRef, r.backupRef, r.requestedBy, r.correlationId, r.by],
    );
    return firstRow(rows, 'insertRestoreRequest');
  }
  async getRestoreRequest(tx: Tx, id: string): Promise<RestoreRequestRow | null> {
    const { rows } = await tx.query<RestoreRequestRow>(
      `SELECT tenant_id, id, request_key, kind, target_ref, state, requested_by, approved_by, version FROM resilience_restore_request WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateRestoreRequest(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { state: string; approvedBy: string | null; reasonCode: string | null; by: string | null },
  ): Promise<RestoreRequestRow | null> {
    const { rows } = await tx.query<RestoreRequestRow>(
      `UPDATE resilience_restore_request
         SET state=$3, approved_by = COALESCE($4, approved_by), reason_code=$5, version=version+1, updated_at=now(), updated_by=$6
       WHERE id=$1 AND version=$2
       RETURNING tenant_id, id, request_key, kind, target_ref, state, requested_by, approved_by, version`,
      [id, expectedVersion, patch.state, patch.approvedBy, patch.reasonCode, patch.by],
    );
    return rows[0] ?? null;
  }
  async listRestoreRequests(tx: Tx, limit: number, offset: number): Promise<RestoreRequestRow[]> {
    const { rows } = await tx.query<RestoreRequestRow>(
      `SELECT tenant_id, id, request_key, kind, target_ref, state, requested_by, approved_by, version FROM resilience_restore_request ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- DR plan (mutable) + test (append-only) ----
  async insertDrPlan(
    tx: Tx,
    p: {
      tenantId: string;
      scope: string;
      planKey: string;
      rtoSeconds: number | null;
      rpoSeconds: number | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<DrPlanRow> {
    const { rows } = await tx.query<DrPlanRow>(
      `INSERT INTO resilience_dr_plan (tenant_id, scope, plan_key, rto_seconds, rpo_seconds, state, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$7)
       RETURNING tenant_id, id, scope, plan_key, state, version`,
      [p.tenantId, p.scope, p.planKey, p.rtoSeconds, p.rpoSeconds, p.correlationId, p.by],
    );
    return firstRow(rows, 'insertDrPlan');
  }
  async getDrPlan(tx: Tx, id: string): Promise<DrPlanRow | null> {
    const { rows } = await tx.query<DrPlanRow>(
      `SELECT tenant_id, id, scope, plan_key, state, version FROM resilience_dr_plan WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async insertDrTest(
    tx: Tx,
    d: {
      tenantId: string;
      planId: string;
      testKey: string;
      scenario: string | null;
      requestedBy: string | null;
      approvedBy: string | null;
      measuredRecoverySeconds: number | null;
      outcome: string;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO resilience_dr_test (tenant_id, plan_id, test_key, scenario, requested_by, approved_by, started_at, completed_at, measured_recovery_seconds, outcome, reason_code, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,now(),now(),$7,$8,$9,$10) RETURNING id`,
      [
        d.tenantId,
        d.planId,
        d.testKey,
        d.scenario,
        d.requestedBy,
        d.approvedBy,
        d.measuredRecoverySeconds,
        d.outcome,
        d.reasonCode,
        d.correlationId,
      ],
    );
    return firstRow(rows, 'insertDrTest');
  }

  // ---- review + history + idempotency (append-only) ----
  async insertReview(
    tx: Tx,
    r: {
      tenantId: string;
      targetKind: string;
      targetId: string;
      decision: string;
      requestedBy: string;
      decidedBy: string;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO resilience_review (tenant_id, target_kind, target_id, decision, requested_by, decided_by, reason_code, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        r.tenantId,
        r.targetKind,
        r.targetId,
        r.decision,
        r.requestedBy,
        r.decidedBy,
        r.reasonCode,
        r.correlationId,
      ],
    );
    return firstRow(rows, 'insertReview');
  }
  async insertHistory(
    tx: Tx,
    h: {
      tenantId: string;
      subjectKind: string;
      subjectId: string;
      fromState: string | null;
      toState: string;
      reasonCode: string | null;
      actor: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO resilience_history (tenant_id, subject_kind, subject_id, from_state, to_state, reason_code, actor, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        h.tenantId,
        h.subjectKind,
        h.subjectId,
        h.fromState,
        h.toState,
        h.reasonCode,
        h.actor,
        h.correlationId,
      ],
    );
  }
  async claimIdempotency(
    tx: Tx,
    i: { tenantId: string; key: string; operation: string; correlationId: string; by: string | null },
  ): Promise<boolean> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO resilience_idempotency (tenant_id, idempotency_key, operation, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id`,
      [i.tenantId, i.key, i.operation, i.correlationId, i.by],
    );
    return rows[0] !== undefined;
  }
}
