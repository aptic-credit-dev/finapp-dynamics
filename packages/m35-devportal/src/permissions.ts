/**
 * M35 permission catalogue — the `devportal.*` namespace (GAP-4 resolution). Three-segment `devportal.<area>.<action>`
 * (the kernel @Endpoint rule); enforced server-side in every service (default deny); registered in
 * manifests/permission-registry.yaml + seeded (migration 0001). `devportal.control.administer` is the cross-tenant
 * CONTROL-PLANE permission a tenant admin never holds by default — PUBLIC exposure of an API product requires it. PRODUCT
 * PUBLISH, CREDENTIAL MANAGE and SUBSCRIPTION MANAGE are privileged CONTROLLED actions. There is NO `devportal.admin`/
 * wildcard bypass; a request-supplied identifier creates no authority; a feature flag can never substitute a permission
 * (RBAC m02 stays authoritative — the developer portal is a governed FACADE, never a second authorization path).
 */
export const M35_PERMISSIONS = {
  appRead: 'devportal.app.read',
  appManage: 'devportal.app.manage',
  productRead: 'devportal.product.read',
  productAuthor: 'devportal.product.author',
  productPublish: 'devportal.product.publish',
  credentialManage: 'devportal.credential.manage',
  subscriptionManage: 'devportal.subscription.manage',
  administer: 'devportal.control.administer',
} as const;

export type M35Permission = (typeof M35_PERMISSIONS)[keyof typeof M35_PERMISSIONS];
export const ALL_M35_PERMISSIONS: readonly M35Permission[] = Object.values(M35_PERMISSIONS);

/** The CONTROL-PLANE permission — a tenant admin never holds it by default; PUBLIC-visibility products require it. */
export const M35_PLATFORM_PERMISSIONS: readonly M35Permission[] = [M35_PERMISSIONS.administer];

/** The privileged subset — product publish, credential manage, subscription manage + the control-plane permission. */
export const M35_PRIVILEGED_PERMISSIONS: readonly M35Permission[] = [
  M35_PERMISSIONS.productPublish,
  M35_PERMISSIONS.credentialManage,
  M35_PERMISSIONS.subscriptionManage,
  M35_PERMISSIONS.administer,
];

export function isPlatformPermission(p: string): boolean {
  return (M35_PLATFORM_PERMISSIONS as readonly string[]).includes(p);
}
