/**
 * M37 permission catalogue — the `govrelease.*` namespace (GAP-4 resolution). Three-segment `govrelease.<area>.<action>`
 * (the kernel @Endpoint rule); enforced server-side in every service (default deny); registered in
 * manifests/permission-registry.yaml + seeded (migration 0001). `govrelease.control.administer` is the cross-tenant
 * CONTROL-PLANE permission a tenant admin never holds by default. RELEASE APPROVAL (a maker-checker promotion to released)
 * and RELEASE EXECUTE (rollback) are privileged CONTROLLED actions. There is NO `govrelease.admin`/wildcard bypass; a
 * request-supplied identifier creates no authority; a feature flag can never substitute a permission (RBAC m02 authoritative).
 */
export const M37_PERMISSIONS = {
  artifactRead: 'govrelease.artifact.read',
  artifactManage: 'govrelease.artifact.manage',
  releaseRead: 'govrelease.release.read',
  releaseAuthor: 'govrelease.release.author',
  gateManage: 'govrelease.gate.manage',
  releaseApprove: 'govrelease.release.approve',
  releaseExecute: 'govrelease.release.execute',
  administer: 'govrelease.control.administer',
} as const;

export type M37Permission = (typeof M37_PERMISSIONS)[keyof typeof M37_PERMISSIONS];
export const ALL_M37_PERMISSIONS: readonly M37Permission[] = Object.values(M37_PERMISSIONS);

/** The CONTROL-PLANE permission — a tenant admin never holds it by default; platform-scope artifacts/envs require it. */
export const M37_PLATFORM_PERMISSIONS: readonly M37Permission[] = [M37_PERMISSIONS.administer];

/** The privileged subset — release approval, release execute (rollback) + the control-plane permission. */
export const M37_PRIVILEGED_PERMISSIONS: readonly M37Permission[] = [
  M37_PERMISSIONS.releaseApprove,
  M37_PERMISSIONS.releaseExecute,
  M37_PERMISSIONS.administer,
];

export function isPlatformPermission(p: string): boolean {
  return (M37_PLATFORM_PERMISSIONS as readonly string[]).includes(p);
}
