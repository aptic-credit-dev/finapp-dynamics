/**
 * M40 permission catalogue — the `resilience.*` namespace (GAP-4 resolved, ADR-127). Three-segment
 * `resilience.<area>.<action>` (the kernel @Endpoint rule); enforced server-side in every service (default deny); registered in
 * manifests/permission-registry.yaml + seeded (migration 0001). `resilience.control.administer` is the cross-tenant
 * CONTROL-PLANE permission a tenant admin never holds by default (platform-scope backup/DR policies). `resilience.restore.approve`
 * is the privileged CONTROLLED action (recovery execution). There is NO `resilience.admin`/wildcard bypass; a request-supplied
 * identifier creates no authority; a stale offline authorization is never sufficient (RBAC m02 authoritative, online).
 */
export const M40_PERMISSIONS = {
  deviceRead: 'resilience.device.read',
  deviceManage: 'resilience.device.manage',
  offlineRead: 'resilience.offline.read',
  offlineSync: 'resilience.offline.sync',
  observabilityRead: 'resilience.observability.read',
  backupRead: 'resilience.backup.read',
  backupManage: 'resilience.backup.manage',
  restoreRequest: 'resilience.restore.request',
  restoreApprove: 'resilience.restore.approve',
  drRead: 'resilience.dr.read',
  drManage: 'resilience.dr.manage',
  administer: 'resilience.control.administer',
} as const;

export type M40Permission = (typeof M40_PERMISSIONS)[keyof typeof M40_PERMISSIONS];
export const ALL_M40_PERMISSIONS: readonly M40Permission[] = Object.values(M40_PERMISSIONS);

/** The CONTROL-PLANE permission — a tenant admin never holds it by default; platform-scope backup/DR policies require it. */
export const M40_PLATFORM_PERMISSIONS: readonly M40Permission[] = [M40_PERMISSIONS.administer];

/** The privileged subset — restore/failover approval (recovery execution) + the control-plane permission. */
export const M40_PRIVILEGED_PERMISSIONS: readonly M40Permission[] = [
  M40_PERMISSIONS.restoreApprove,
  M40_PERMISSIONS.administer,
];

export function isPlatformPermission(p: string): boolean {
  return (M40_PLATFORM_PERMISSIONS as readonly string[]).includes(p);
}
