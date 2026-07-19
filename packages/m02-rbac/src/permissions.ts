/**
 * M02-rbac permissions. Namespace `rbac.*` (registered, owner m02-rbac); three segments per the kernel's
 * @Endpoint validator.
 *
 * Unlike every prior stage, these are DECLARED AND GRANTED: Stage 1D ends the "declared, not granted" era.
 * A role holds concrete grants; there is no wildcard grant and no client injection.
 */
export const RBAC_PERMISSIONS = {
  permissionView: 'rbac.permission.view',

  roleView: 'rbac.role.view',
  roleCreate: 'rbac.role.create',
  roleEdit: 'rbac.role.edit',
  roleActivate: 'rbac.role.activate',
  roleSuspend: 'rbac.role.suspend',
  roleRetire: 'rbac.role.retire',

  assignmentView: 'rbac.assignment.view',
  assignmentGrant: 'rbac.assignment.grant',
  assignmentRevoke: 'rbac.assignment.revoke',

  sodView: 'rbac.sod.view',
  sodManage: 'rbac.sod.manage',

  bootstrapExecute: 'rbac.bootstrap.execute',
} as const;

export type RbacPermission = (typeof RBAC_PERMISSIONS)[keyof typeof RBAC_PERMISSIONS];
export const ALL_RBAC_PERMISSIONS: readonly string[] = Object.values(RBAC_PERMISSIONS);
export const RBAC_PERMISSION_NAMESPACE = 'rbac.';
