/**
 * @finapp/m04-admin — the ADMIN CONSOLE (Stage 1, ORCHESTRATION ONLY).
 *
 * A tenant + platform administration surface OVER the existing platform services (m01 tenancy, m02 identity/auth/RBAC,
 * m03 audit, m06 workflow, m07 rules, m08 notifications). It OWNS only its admin state — saved views, preferences, and a
 * governed admin-operation request/history ledger (four FORCE-RLS tables) — and CALLS the other modules' PUBLIC services
 * through their contracts, never their private tables. It creates NO event family, NO second outbox and NO duplicate
 * engine. Every controlled action is authorized (default deny; `admin.*` three-segment permissions; tenant vs platform
 * vs privileged, no vague bypass) and audited (`ADMIN_` codes) through m03. Delegated mutations are authorized + audited
 * by the OWNING module; M04 adds an admin-facing operation trail and audits its own sensitive reads.
 */

// Permissions + audit codes
export {
  M04_PERMISSIONS,
  ALL_M04_PERMISSIONS,
  M04_PLATFORM_PERMISSIONS,
  M04_PRIVILEGED_PERMISSIONS,
  isPlatformPermission,
} from './permissions.ts';
export type { M04Permission } from './permissions.ts';
export { M04_AUDIT_CODES, ALL_M04_AUDIT_CODES, ADMIN_AUDIT_PREFIX } from './audit-codes.ts';
export type { M04AuditCode } from './audit-codes.ts';

// Domain
export {
  M04_LIMITS,
  AdminError,
  ADMIN_SCOPES,
  isAdminScope,
  scopeOfPermission,
  OPERATION_TYPES,
  isOperationType,
  OPERATION_STATUSES,
  checkOperationTransition,
  isOperationTerminal,
  REASON_CODES,
  ALL_REASON_CODES,
  SAVED_VIEW_AREAS,
  isSavedViewArea,
  clampPage,
} from './domain.ts';
export type {
  AdminScope,
  OperationType,
  OperationStatus,
  TransitionResult,
  ReasonCodeKey,
  SavedViewArea,
  Page,
} from './domain.ts';

// Errors
export { badRequest, scopeForbidden } from './errors.ts';

// Persistence + owned-state service
export { AdminRepository } from './repository.ts';
export type { SavedViewRow, PreferenceRow, OperationRow, OperationHistoryRow } from './repository.ts';
export { AdminOperationService } from './operation.service.ts';

// Orchestration services
export {
  TenantAdminService,
  IdentityAdminService,
  AccessAdminService,
  AuditAdminService,
  WorkflowAdminService,
  RulesAdminService,
  NotificationAdminService,
} from './orchestration.ts';
