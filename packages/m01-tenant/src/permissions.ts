/**
 * M01 permissions.
 *
 * NAMING — read before adding one. Two authorities constrain the shape, and the obvious name violates
 * one of them:
 *   - manifests/permission-registry.yaml registers m01's namespace as `tenant.*`.
 *   - The kernel's `validateEndpointSpec` requires exactly three segments,
 *     `<domain>.<entity>.<action>` (manifests/naming-map.yaml conventions).
 *
 * So the tenant record's own permissions are `tenant.registry.*`, not `tenant.*` — `tenant.view` has two
 * segments and the kernel rejects it at class-definition time. `registry` is the entity: the tenant
 * registry. This keeps every code inside the registered `tenant.*` namespace while satisfying the
 * pattern, and it pairs one-to-one with the audit codes in audit-codes.ts.
 *
 * These are declared, not granted. No role holds them until m02-identity ships the RBAC model
 * (STAGE_1_PROMPT.md); there is deliberately no bootstrap grant here.
 */

export const TENANT_PERMISSIONS = {
  registryView: 'tenant.registry.view',
  registryCreate: 'tenant.registry.create',
  registryEdit: 'tenant.registry.edit',
  registryReview: 'tenant.registry.review',
  registryApprove: 'tenant.registry.approve',
  registryProvision: 'tenant.registry.provision',
  registryActivate: 'tenant.registry.activate',
  registryRestrict: 'tenant.registry.restrict',
  registrySuspend: 'tenant.registry.suspend',
  registryReactivate: 'tenant.registry.reactivate',
  registryClose: 'tenant.registry.close',

  environmentView: 'tenant.environment.view',
  environmentManage: 'tenant.environment.manage',

  entityView: 'tenant.entity.view',
  entityManage: 'tenant.entity.manage',

  departmentView: 'tenant.department.view',
  departmentManage: 'tenant.department.manage',

  branchView: 'tenant.branch.view',
  branchManage: 'tenant.branch.manage',
} as const;

export type TenantPermission = (typeof TENANT_PERMISSIONS)[keyof typeof TENANT_PERMISSIONS];

export const ALL_TENANT_PERMISSIONS: readonly string[] = Object.values(TENANT_PERMISSIONS);

/** The namespace m01 is registered to own. Every permission above must fall under it. */
export const TENANT_PERMISSION_NAMESPACE = 'tenant.';
