/**
 * M34 permission catalogue — the `marketplace.*` namespace (GAP-4 resolution). Three-segment `marketplace.<area>.<action>`
 * (the kernel @Endpoint rule); enforced server-side in every service (default deny); registered in
 * manifests/permission-registry.yaml + seeded (migration 0001). `marketplace.control.administer` is the cross-tenant
 * CONTROL-PLANE permission a tenant admin never holds by default. LISTING PUBLISH, INSTALL MANAGE, CONSENT MANAGE and
 * UPGRADE APPLY are privileged CONTROLLED actions. There is NO `marketplace.admin`/wildcard bypass; a request-supplied
 * identifier creates no authority; a feature flag can never substitute a permission (RBAC m02 stays authoritative).
 */
export const M34_PERMISSIONS = {
  listingRead: 'marketplace.listing.read',
  listingAuthor: 'marketplace.listing.author',
  listingPublish: 'marketplace.listing.publish',
  installRead: 'marketplace.install.read',
  installManage: 'marketplace.install.manage',
  consentManage: 'marketplace.consent.manage',
  upgradeApply: 'marketplace.upgrade.apply',
  administer: 'marketplace.control.administer',
} as const;

export type M34Permission = (typeof M34_PERMISSIONS)[keyof typeof M34_PERMISSIONS];
export const ALL_M34_PERMISSIONS: readonly M34Permission[] = Object.values(M34_PERMISSIONS);

/** The CONTROL-PLANE permission — a tenant admin never holds it by default; platform-scoped listings require it. */
export const M34_PLATFORM_PERMISSIONS: readonly M34Permission[] = [M34_PERMISSIONS.administer];

/** The privileged subset — listing publish, install/consent management, upgrade apply + the control-plane permission. */
export const M34_PRIVILEGED_PERMISSIONS: readonly M34Permission[] = [
  M34_PERMISSIONS.listingPublish,
  M34_PERMISSIONS.installManage,
  M34_PERMISSIONS.consentManage,
  M34_PERMISSIONS.upgradeApply,
  M34_PERMISSIONS.administer,
];

export function isPlatformPermission(p: string): boolean {
  return (M34_PLATFORM_PERMISSIONS as readonly string[]).includes(p);
}
