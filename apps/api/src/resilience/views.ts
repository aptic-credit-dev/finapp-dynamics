/**
 * Safe DTO shapers for `/api/v1/resilience`. They expose ids, keys, states, component/policy/target references and bounded
 * integer durations. They NEVER expose a secret, a token, raw backup data, a full offline payload or a raw log body. RLS keeps
 * a caller to its own tenant's rows.
 */
import type {
  DeviceRow,
  OfflineRequestRow,
  BackupPolicyRow,
  BackupRunRow,
  RestoreRequestRow,
  DrPlanRow,
} from '@finapp/m40-resilience';

export function deviceView(d: DeviceRow) {
  return {
    id: d.id,
    deviceKey: d.device_key,
    platform: d.platform,
    trustState: d.trust_state,
    version: d.version,
  };
}

export function offlineRequestView(o: OfflineRequestRow) {
  return {
    id: o.id,
    deviceId: o.device_id,
    requestKey: o.request_key,
    capabilityRef: o.capability_ref,
    requiredPermission: o.required_permission,
    controlled: o.controlled,
    syncState: o.sync_state,
    validatedOnline: o.validated_online,
    hasDownstreamRef: o.downstream_ref !== null,
    version: o.version,
  };
}

export function backupPolicyView(p: BackupPolicyRow) {
  return {
    id: p.id,
    scope: p.scope,
    policyKey: p.policy_key,
    targetRef: p.target_ref,
    state: p.state,
    rtoSeconds: p.rto_seconds,
    rpoSeconds: p.rpo_seconds,
    version: p.version,
  };
}

export function backupRunView(r: BackupRunRow) {
  return { id: r.id, policyId: r.policy_id, runKey: r.run_key, result: r.result };
}

export function restoreRequestView(r: RestoreRequestRow) {
  return {
    id: r.id,
    requestKey: r.request_key,
    kind: r.kind,
    targetRef: r.target_ref,
    state: r.state,
    version: r.version,
  };
}

export function drPlanView(p: DrPlanRow) {
  return { id: p.id, scope: p.scope, planKey: p.plan_key, state: p.state, version: p.version };
}
