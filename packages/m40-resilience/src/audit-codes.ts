/**
 * M40 audit codes — the `RESILIENCE_` prefix. Every controlled resilience action (device enrol/revoke, offline sync
 * finalize/deny, backup policy/run, restore/failover request/decision, DR test) is audited through the kernel AUDIT port in the
 * SAME transaction. SCREAMING_SNAKE `RESILIENCE_<ENTITY>_<ACTION>` (>= 3 segments), registered in
 * manifests/audit-code-registry.yaml (unregistered codes fail CI). Payloads carry safe ids, a component/policy/target
 * reference, a state, bounded integer durations and reason codes ONLY — never a secret, a credential, raw backup data, a full
 * offline business payload, an unbounded log or personal data.
 */
export const M40_AUDIT_CODES = {
  deviceRegistered: 'RESILIENCE_DEVICE_REGISTERED',
  deviceRevoked: 'RESILIENCE_DEVICE_REVOKED',
  offlineQueued: 'RESILIENCE_OFFLINE_QUEUED',
  offlineApplied: 'RESILIENCE_OFFLINE_APPLIED',
  offlineRejected: 'RESILIENCE_OFFLINE_REJECTED',
  offlineFinalizeBlocked: 'RESILIENCE_OFFLINE_FINALIZE_BLOCKED',
  healthRecorded: 'RESILIENCE_HEALTH_RECORDED',
  checkDefined: 'RESILIENCE_CHECK_DEFINED',
  backupPolicySet: 'RESILIENCE_BACKUP_POLICY_SET',
  backupPolicyRetired: 'RESILIENCE_BACKUP_POLICY_RETIRED',
  backupRunRecorded: 'RESILIENCE_BACKUP_RUN_RECORDED',
  backupRunBlocked: 'RESILIENCE_BACKUP_RUN_BLOCKED',
  restoreRequested: 'RESILIENCE_RESTORE_REQUESTED',
  restoreApproved: 'RESILIENCE_RESTORE_APPROVED',
  restoreRejected: 'RESILIENCE_RESTORE_REJECTED',
  restoreExecuted: 'RESILIENCE_RESTORE_EXECUTED',
  restoreBlocked: 'RESILIENCE_RESTORE_BLOCKED',
  drPlanSet: 'RESILIENCE_DR_PLAN_SET',
  drTestRecorded: 'RESILIENCE_DR_TEST_RECORDED',
  sodBlocked: 'RESILIENCE_SOD_BLOCKED',
} as const;

export type M40AuditCode = (typeof M40_AUDIT_CODES)[keyof typeof M40_AUDIT_CODES];
export const ALL_M40_AUDIT_CODES: readonly M40AuditCode[] = Object.values(M40_AUDIT_CODES);
export const RESILIENCE_AUDIT_PREFIX = 'RESILIENCE_';
