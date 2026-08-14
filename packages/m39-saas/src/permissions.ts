/**
 * M39 permission catalogue — the `saas.*` namespace (declared in naming-map; no GAP-4). Three-segment
 * `saas.<area>.<action>` (the kernel @Endpoint rule); enforced server-side in every service (default deny); registered in
 * manifests/permission-registry.yaml + seeded (migration 0001). `saas.control.administer` is the cross-tenant CONTROL-PLANE
 * permission a tenant admin never holds by default (platform-scope plans + platform overrides). PLAN PUBLISH, SUBSCRIPTION
 * MANAGE and OVERRIDE ADMINISTER are privileged CONTROLLED actions. There is NO `saas.admin`/wildcard bypass; a request-supplied
 * identifier creates no authority; an ENTITLEMENT is never an authorization substitute (RBAC m02 authoritative).
 */
export const M39_PERMISSIONS = {
  planRead: 'saas.plan.read',
  planManage: 'saas.plan.manage',
  planPublish: 'saas.plan.publish',
  subscriptionRead: 'saas.subscription.read',
  subscriptionManage: 'saas.subscription.manage',
  entitlementRead: 'saas.entitlement.read',
  quotaRead: 'saas.quota.read',
  quotaManage: 'saas.quota.manage',
  usageRead: 'saas.usage.read',
  usageRecord: 'saas.usage.record',
  overrideAdminister: 'saas.override.administer',
  administer: 'saas.control.administer',
} as const;

export type M39Permission = (typeof M39_PERMISSIONS)[keyof typeof M39_PERMISSIONS];
export const ALL_M39_PERMISSIONS: readonly M39Permission[] = Object.values(M39_PERMISSIONS);

/** The CONTROL-PLANE permission — a tenant admin never holds it by default; platform-scope plans/overrides require it. */
export const M39_PLATFORM_PERMISSIONS: readonly M39Permission[] = [M39_PERMISSIONS.administer];

/** The privileged subset — plan publication, subscription lifecycle, commercial override + the control-plane permission. */
export const M39_PRIVILEGED_PERMISSIONS: readonly M39Permission[] = [
  M39_PERMISSIONS.planPublish,
  M39_PERMISSIONS.subscriptionManage,
  M39_PERMISSIONS.overrideAdminister,
  M39_PERMISSIONS.administer,
];

export function isPlatformPermission(p: string): boolean {
  return (M39_PLATFORM_PERMISSIONS as readonly string[]).includes(p);
}
