/**
 * @finapp/m40-resilience — Mobile / Offline / Observability / Backup / Business Continuity (Stage 6G, mvp:false). Exposes the
 * resilience.* permissions, the RESILIENCE_ audit codes, the pure domain gates (the OFFLINE FINALIZATION block, maker-checker/
 * SoD, lifecycle, RTO/RPO validation), the fail-closed BackupExecutorPort, the repository, the emitter, and the services. It
 * declares /api/v1/resilience, owns the mobile.lifecycle + backup.lifecycle + dr.lifecycle families, and publishes through the
 * ONE m06 outbox — it owns no outbox, no second scheduler/timer/notification/analytics engine, no secrets manager and no
 * arbitrary-execution engine. Backup/restore/failover execution is framework-only behind the fail-closed executor.
 */
export {
  M40_PERMISSIONS,
  ALL_M40_PERMISSIONS,
  M40_PLATFORM_PERMISSIONS,
  M40_PRIVILEGED_PERMISSIONS,
  isPlatformPermission,
} from './permissions.ts';
export type { M40Permission } from './permissions.ts';
export { M40_AUDIT_CODES, ALL_M40_AUDIT_CODES, RESILIENCE_AUDIT_PREFIX } from './audit-codes.ts';
export type { M40AuditCode } from './audit-codes.ts';

export {
  M40_LIMITS,
  DEVICE_STATES,
  SYNC_STATES,
  BACKUP_STATES,
  RESTORE_STATES,
  RESTORE_KINDS,
  SIGNAL_KINDS,
  SIGNAL_STATES,
  SCOPES,
  isPlatformScope,
  REASON_CODES,
  ALL_REASON_CODES,
  evaluateOfflineFinalization,
  isHumanActor,
  evaluateSodGate,
  isRestoreTransitionAllowed,
  isRestoreTerminal,
  isThreeSegmentPermission,
  isValidObjective,
  validateOfflineRequest,
  isSecretReference,
  SECRET_REFERENCE_PATTERN,
  clampPage,
} from './domain.ts';
export type {
  DeviceState,
  SyncState,
  BackupState,
  RestoreState,
  RestoreKind,
  SignalKind,
  SignalState,
  Scope,
  ReasonCodeKey,
  GateResult,
  OfflineFinalizationInput,
  OfflineRequestDraft,
  ValidationResult,
} from './domain.ts';

export { badRequest, governanceForbidden, notFound, versionConflict } from './errors.ts';
export { M40Emitter } from './emit.ts';

export { UnavailableBackupExecutor, FixtureBackupExecutor } from './ports.ts';
export type { BackupExecutorPort, ExecutionOutcome } from './ports.ts';

export { ResilienceRepository } from './repository.ts';
export type {
  DeviceRow,
  OfflineRequestRow,
  BackupPolicyRow,
  BackupRunRow,
  RestoreRequestRow,
  DrPlanRow,
} from './repository.ts';

export { OfflineService } from './offline.service.ts';
export { ObservabilityService } from './observability.service.ts';
export { BackupDrService } from './backup.service.ts';
