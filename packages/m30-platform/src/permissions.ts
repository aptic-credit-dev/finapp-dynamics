/**
 * M30 permission catalogue — the `platform.*` namespace (GAP-2 resolution, ADR-115). Three-segment
 * `platform.<area>.<action>` (the kernel @Endpoint rule); enforced server-side in every service (default deny);
 * registered in manifests/permission-registry.yaml + seeded (migration 0001). Mirroring m04-admin's admin.* split,
 * `platform.administer` is the cross-tenant CONTROL-PLANE permission a tenant admin never holds by default (a
 * platform-scoped mutation requires it); manage + secret codes are privileged. There is NO `platform.admin` / wildcard
 * bypass, and a request-supplied identifier can never create authority.
 */
export const M30_PERMISSIONS = {
  metadataRead: 'platform.metadata.read',
  metadataManage: 'platform.metadata.manage',
  configRead: 'platform.config.read',
  configManage: 'platform.config.manage',
  featureRead: 'platform.feature.read',
  featureManage: 'platform.feature.manage',
  secretRead: 'platform.secret.read',
  secretManage: 'platform.secret.manage',
  administer: 'platform.control.administer',
} as const;

export type M30Permission = (typeof M30_PERMISSIONS)[keyof typeof M30_PERMISSIONS];
export const ALL_M30_PERMISSIONS: readonly M30Permission[] = Object.values(M30_PERMISSIONS);

/** The PLATFORM (control-plane) permission — a tenant admin never holds it by default; platform-scoped rows require it. */
export const M30_PLATFORM_PERMISSIONS: readonly M30Permission[] = [M30_PERMISSIONS.administer];

/** The privileged subset — controlled mutations + sensitive secret-reference reads + the control-plane permission. */
export const M30_PRIVILEGED_PERMISSIONS: readonly M30Permission[] = [
  M30_PERMISSIONS.metadataManage,
  M30_PERMISSIONS.configManage,
  M30_PERMISSIONS.featureManage,
  M30_PERMISSIONS.secretRead,
  M30_PERMISSIONS.secretManage,
  M30_PERMISSIONS.administer,
];

export function isPlatformPermission(p: string): boolean {
  return (M30_PLATFORM_PERMISSIONS as readonly string[]).includes(p);
}
