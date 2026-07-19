/**
 * M02-rbac audit codes. Prefix `RBAC_` (registered, owner m02-rbac); `<PREFIX>_<ENTITY>_<ACTION>`.
 *
 * NEVER record a permission-set dump or a secret in an audit `detail` — identifiers, counts and transitions
 * only. The audit spine is append-only.
 */
export const RBAC_AUDIT_CODES = {
  roleCreated: 'RBAC_ROLE_CREATED',
  roleUpdated: 'RBAC_ROLE_UPDATED',
  roleActivated: 'RBAC_ROLE_ACTIVATED',
  roleSuspended: 'RBAC_ROLE_SUSPENDED',
  roleRetired: 'RBAC_ROLE_RETIRED',
  rolePermissionsChanged: 'RBAC_ROLE_PERMISSIONS_CHANGED',
  assignmentGranted: 'RBAC_ASSIGNMENT_GRANTED',
  assignmentRevoked: 'RBAC_ASSIGNMENT_REVOKED',
  assignmentExpired: 'RBAC_ASSIGNMENT_EXPIRED',
  sodRuleCreated: 'RBAC_SOD_RULE_CREATED',
  sodRuleUpdated: 'RBAC_SOD_RULE_UPDATED',
  sodConflictDetected: 'RBAC_SOD_CONFLICT_DETECTED',
  bootstrapProvisioned: 'RBAC_BOOTSTRAP_PROVISIONED',
} as const;

export type RbacAuditCode = (typeof RBAC_AUDIT_CODES)[keyof typeof RBAC_AUDIT_CODES];
export const ALL_RBAC_AUDIT_CODES: readonly string[] = Object.values(RBAC_AUDIT_CODES);
export const RBAC_AUDIT_PREFIX = 'RBAC_';
