// Domain — pure.
export {
  ROLE_STATUSES,
  ROLE_TRANSITIONS,
  ROLE_TERMINAL,
  isRoleStatus,
  checkRoleTransition,
  roleGrantsPermissions,
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_TRANSITIONS,
  ASSIGNMENT_TERMINAL,
  isAssignmentStatus,
  checkAssignmentTransition,
  assignmentIsEffective,
} from './domain/lifecycles.ts';
export type {
  RoleStatus,
  RoleAction,
  AssignmentStatus,
  AssignmentAction,
  TransitionCheck,
} from './domain/lifecycles.ts';

export { SCOPE_LEVELS, isScopeLevel, assignmentScopeContains, parseScope } from './domain/scope.ts';
export type { Scope, ScopeLevel } from './domain/scope.ts';

// Registered names.
export {
  RBAC_PERMISSIONS,
  ALL_RBAC_PERMISSIONS,
  RBAC_PERMISSION_NAMESPACE,
} from './permissions.ts';
export type { RbacPermission } from './permissions.ts';
export { RBAC_AUDIT_CODES, ALL_RBAC_AUDIT_CODES, RBAC_AUDIT_PREFIX } from './audit-codes.ts';
export type { RbacAuditCode } from './audit-codes.ts';

// Persistence + emit.
export { RbacRepository } from './repository.ts';
export type { RoleRow, AssignmentRow, SodRuleRow } from './repository.ts';
export { RbacEmitter } from './emit.ts';

// Authorization core — the persistent AUTHZ adapter + the per-request resolver.
export { PermissionResolver } from './permission-resolver.ts';
export { RbacAuthz } from './rbac-authz.ts';

// Services.
export { RoleService } from './role.service.ts';
export { AssignmentService } from './assignment.service.ts';
export { SodService, badRequest, isUniqueViolation } from './sod.service.ts';
export type { SodConflict } from './sod.service.ts';
export { CatalogueService } from './catalogue.service.ts';
export { BootstrapService, PLATFORM_ADMIN_ROLE_CODE } from './bootstrap.ts';
export type { BootstrapResult } from './bootstrap.ts';
