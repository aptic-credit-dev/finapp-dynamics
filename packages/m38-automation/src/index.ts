/**
 * @finapp/m38-automation — SCHEDULER / AUTOMATION / EXTENSION FRAMEWORK (Stage 6E, mvp:false): a governed orchestration layer
 * — automation definitions whose steps reference registered capabilities (opaque refs + the m02 permission each requires),
 * recurring schedules, append-only execution evidence, and a governed extension framework (registered extension points, trust
 * tiers, isolation). m06 owns THE durable timer + workflow runtime + THE outbox — m38 owns no second timer/scheduler/workflow
 * engine; it owns the definitions + evidence and composes m06's timer per occurrence through a fail-closed port. Execution is
 * FRAMEWORK ONLY: a registered capability is invoked through the owning module's contract via a fail-closed
 * CapabilityInvokerPort (deterministic doubles; default Unavailable -> BLOCKED; no arbitrary code). Automation orchestrates
 * only — never bypasses m02 RBAC / m21-m22 approval / m33 / m34 / m35 / m36 / m37, never auto-posts/releases/consents, never
 * fabricates a human approval. NOT a secrets manager (opaque m30 secretref: only; zero secret value columns; m41 deferred).
 * Uses the automation_ and extension_ prefixes; owns automation.lifecycle + extension.lifecycle and publishes through the ONE
 * m06 outbox. Declares /api/v1/automation + /api/v1/extensions, the automation.* and extensions.* namespaces, and the
 * AUTOMATION_/EXTENSION_ audit prefixes. No secret value; no external network/provider; no arbitrary code.
 */

// Permissions + audit codes
export {
  M38_PERMISSIONS,
  ALL_M38_PERMISSIONS,
  M38_PLATFORM_PERMISSIONS,
  M38_PRIVILEGED_PERMISSIONS,
  isPlatformPermission,
} from './permissions.ts';
export type { M38Permission } from './permissions.ts';
export {
  M38_AUDIT_CODES,
  ALL_M38_AUDIT_CODES,
  AUTOMATION_AUDIT_PREFIX,
  EXTENSION_AUDIT_PREFIX,
} from './audit-codes.ts';
export type { M38AuditCode } from './audit-codes.ts';

// Domain
export {
  M38_LIMITS,
  AutomationError,
  SCOPES,
  isScope,
  isPlatformScope,
  TRIGGER_KINDS,
  isTriggerKind,
  AUTOMATION_STATES,
  isAutomationState,
  isAutomationFrozen,
  SCHEDULE_STATUSES,
  isScheduleStatus,
  CONCURRENCY_POLICIES,
  isConcurrencyPolicy,
  MISSED_RUN_POLICIES,
  isMissedRunPolicy,
  RUN_STATUSES,
  isRunStatus,
  TRUST_TIERS,
  isTrustTier,
  ISOLATION_LEVELS,
  isIsolationLevel,
  EXTENSION_STATES,
  isExtensionState,
  INSTALL_STATUSES,
  isInstallStatus,
  REASON_CODES,
  ALL_REASON_CODES,
  isHumanActor,
  evaluateSodGate,
  evaluateActivationGate,
  parseRecurrence,
  validateRecurrence,
  computeNextRun,
  isThreeSegmentPermission,
  screenSteps,
  validateAutomation,
  SECRET_REFERENCE_PATTERN,
  isSecretReference,
  clampPage,
} from './domain.ts';
export type {
  Scope,
  AutomationState,
  ExtensionState,
  RunStatus,
  ReasonCodeKey,
  GateResult,
  ActivationGateInput,
  CapabilityStep,
  ValidationFinding,
  ValidationOutcome,
  Page,
} from './domain.ts';

// Errors + emit
export { badRequest, governanceForbidden, notFound, versionConflict } from './errors.ts';
export { M38Emitter } from './emit.ts';

// Ports (capability invoker + m06 timer seam + m30 secret resolver; deterministic doubles only)
export {
  UnavailableCapabilityInvoker,
  FixtureCapabilityInvoker,
  EmptyTimerScheduler,
  FixtureTimerScheduler,
  DeterministicSecretResolver,
  UnavailableSecretResolver,
} from './ports.ts';
export type {
  InvocationOutcome,
  CapabilityInvokerPort,
  TimerSchedulerPort,
  SecretResolver,
} from './ports.ts';

// Persistence
export { AutomationRepository } from './repository.ts';
export type {
  AutomationRow,
  StepRow,
  ScheduleRow,
  RunRow,
  ReviewRow,
  ExtensionRow,
  InstallationRow,
} from './repository.ts';

// Services
export { AutomationService, contentHashOf } from './automation.service.ts';
export { ExtensionService } from './extension.service.ts';
