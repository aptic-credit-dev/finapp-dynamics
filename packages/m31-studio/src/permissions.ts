/**
 * M31 permission catalogue — the `studio.*` namespace (GAP M31-3 resolution, ADR-118). Three-segment
 * `studio.<area>.<action>` (the kernel @Endpoint rule); enforced server-side in every service (default deny);
 * registered in manifests/permission-registry.yaml + seeded (migration 0001). Mirroring the platform and admin splits,
 * `studio.control.administer` is the cross-tenant CONTROL-PLANE permission a tenant admin never holds by default (a
 * platform-scoped design mutation requires it). PUBLISH/ARCHIVE/BIND are privileged CONTROLLED actions. There is NO
 * `studio.admin` / wildcard bypass, and a request-supplied identifier can never create authority; a feature flag can
 * never substitute a permission (RBAC m02 stays authoritative).
 */
export const M31_PERMISSIONS = {
  projectRead: 'studio.project.read',
  projectManage: 'studio.project.manage',
  artifactRead: 'studio.artifact.read',
  artifactAuthor: 'studio.artifact.author',
  artifactValidate: 'studio.artifact.validate',
  artifactPublish: 'studio.artifact.publish',
  artifactArchive: 'studio.artifact.archive',
  bindingManage: 'studio.binding.manage',
  administer: 'studio.control.administer',
} as const;

export type M31Permission = (typeof M31_PERMISSIONS)[keyof typeof M31_PERMISSIONS];
export const ALL_M31_PERMISSIONS: readonly M31Permission[] = Object.values(M31_PERMISSIONS);

/** The CONTROL-PLANE permission — a tenant admin never holds it by default; platform-scoped design rows require it. */
export const M31_PLATFORM_PERMISSIONS: readonly M31Permission[] = [M31_PERMISSIONS.administer];

/** The privileged subset — controlled publish/archive/bind, project management + the control-plane permission. */
export const M31_PRIVILEGED_PERMISSIONS: readonly M31Permission[] = [
  M31_PERMISSIONS.projectManage,
  M31_PERMISSIONS.artifactPublish,
  M31_PERMISSIONS.artifactArchive,
  M31_PERMISSIONS.bindingManage,
  M31_PERMISSIONS.administer,
];

export function isPlatformPermission(p: string): boolean {
  return (M31_PLATFORM_PERMISSIONS as readonly string[]).includes(p);
}
