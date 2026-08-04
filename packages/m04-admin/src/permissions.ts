/**
 * M04 permission catalogue — the `admin.*` namespace. Consumed by controllers' `@Endpoint` decorators and enforced
 * server-side in every service (default deny). Three-segment `admin.<area>.<action>` (the kernel @Endpoint rule);
 * registered in manifests/permission-registry.yaml + seeded (migration 0001). There is NO vague `admin.admin` bypass.
 *
 * The catalogue is deliberately split three ways:
 *  - TENANT-scoped admin — acts within the caller's own tenant only;
 *  - PLATFORM admin — cross-tenant / control-plane, always privileged;
 *  - PRIVILEGED — controlled mutations + sensitive reads (exports, integrity, platform audit).
 * A tenant admin can NEVER hold a platform permission by default — that is the platform-vs-tenant boundary M04 certifies.
 */
export const M04_PERMISSIONS = {
  // tenant administration (tenant-scoped)
  tenantRead: 'admin.tenant.read',
  tenantManage: 'admin.tenant.manage',
  tenantSuspend: 'admin.tenant.suspend',
  tenantReactivate: 'admin.tenant.reactivate',
  // identity / account administration (tenant-scoped)
  identityRead: 'admin.identity.read',
  identityManage: 'admin.identity.manage',
  accountActivate: 'admin.account.activate',
  accountDeactivate: 'admin.account.deactivate',
  // RBAC administration (tenant-scoped)
  roleRead: 'admin.role.read',
  roleManage: 'admin.role.manage',
  roleAssign: 'admin.role.assign',
  roleRevoke: 'admin.role.revoke',
  permissionRead: 'admin.permission.read',
  sodRead: 'admin.sod.read',
  sodManage: 'admin.sod.manage',
  // workflow / rules / notification administration (tenant-scoped orchestration)
  workflowRead: 'admin.workflow.read',
  workflowManage: 'admin.workflow.manage',
  rulesRead: 'admin.rules.read',
  rulesManage: 'admin.rules.manage',
  notificationRead: 'admin.notification.read',
  notificationManage: 'admin.notification.manage',
  // audit administration
  auditRead: 'admin.audit.read',
  auditExport: 'admin.audit.export',
  auditVerify: 'admin.audit.verify',
  // dashboards / operations / console state (tenant-scoped)
  dashboardRead: 'admin.dashboard.read',
  operationsRead: 'admin.operations.read',
  savedViewManage: 'admin.savedview.manage',
  preferenceManage: 'admin.preference.manage',
  // PLATFORM administration (cross-tenant / control-plane; always privileged)
  platformAuditRead: 'admin.platform_audit.read',
  platformAdminister: 'admin.platform.administer',
} as const;

export type M04Permission = (typeof M04_PERMISSIONS)[keyof typeof M04_PERMISSIONS];
export const ALL_M04_PERMISSIONS: readonly M04Permission[] = Object.values(M04_PERMISSIONS);

/** The PLATFORM (cross-tenant / control-plane) permissions — a tenant admin never holds these by default. */
export const M04_PLATFORM_PERMISSIONS: readonly M04Permission[] = [
  M04_PERMISSIONS.platformAuditRead,
  M04_PERMISSIONS.platformAdminister,
];

/** The privileged subset — controlled mutations + sensitive reads. */
export const M04_PRIVILEGED_PERMISSIONS: readonly M04Permission[] = [
  M04_PERMISSIONS.tenantManage,
  M04_PERMISSIONS.tenantSuspend,
  M04_PERMISSIONS.tenantReactivate,
  M04_PERMISSIONS.identityManage,
  M04_PERMISSIONS.accountActivate,
  M04_PERMISSIONS.accountDeactivate,
  M04_PERMISSIONS.roleManage,
  M04_PERMISSIONS.roleAssign,
  M04_PERMISSIONS.roleRevoke,
  M04_PERMISSIONS.sodManage,
  M04_PERMISSIONS.workflowManage,
  M04_PERMISSIONS.rulesManage,
  M04_PERMISSIONS.notificationManage,
  M04_PERMISSIONS.auditExport,
  M04_PERMISSIONS.auditVerify,
  M04_PERMISSIONS.platformAuditRead,
  M04_PERMISSIONS.platformAdminister,
];

export function isPlatformPermission(p: string): boolean {
  return (M04_PLATFORM_PERMISSIONS as readonly string[]).includes(p);
}
