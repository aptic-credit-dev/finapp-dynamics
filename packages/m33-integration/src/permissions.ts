/**
 * M33 permission catalogue — the `integration.*` namespace. Three-segment `integration.<area>.<action>` (the kernel
 * @Endpoint rule); enforced server-side in every service (default deny); registered in manifests/permission-registry.yaml
 * + seeded (migration 0001). `integration.control.administer` is the cross-tenant CONTROL-PLANE permission a tenant admin
 * never holds by default. CONNECTOR PUBLISH, CONNECTION MANAGE (secret references) and RUN EXECUTE (external access) are
 * privileged CONTROLLED actions. There is NO `integration.admin`/wildcard bypass; a request-supplied identifier creates no
 * authority; a feature flag can never substitute a permission (RBAC m02 stays authoritative).
 */
export const M33_PERMISSIONS = {
  connectorRead: 'integration.connector.read',
  connectorAuthor: 'integration.connector.author',
  connectorPublish: 'integration.connector.publish',
  capabilityRead: 'integration.capability.read',
  connectionRead: 'integration.connection.read',
  connectionManage: 'integration.connection.manage',
  runRead: 'integration.run.read',
  runExecute: 'integration.run.execute',
  administer: 'integration.control.administer',
} as const;

export type M33Permission = (typeof M33_PERMISSIONS)[keyof typeof M33_PERMISSIONS];
export const ALL_M33_PERMISSIONS: readonly M33Permission[] = Object.values(M33_PERMISSIONS);

/** The CONTROL-PLANE permission — a tenant admin never holds it by default; platform-scoped connectors require it. */
export const M33_PLATFORM_PERMISSIONS: readonly M33Permission[] = [M33_PERMISSIONS.administer];

/** The privileged subset — connector publish, connection management (secrets), run execution + the control-plane permission. */
export const M33_PRIVILEGED_PERMISSIONS: readonly M33Permission[] = [
  M33_PERMISSIONS.connectorPublish,
  M33_PERMISSIONS.connectionManage,
  M33_PERMISSIONS.runExecute,
  M33_PERMISSIONS.administer,
];

export function isPlatformPermission(p: string): boolean {
  return (M33_PLATFORM_PERMISSIONS as readonly string[]).includes(p);
}
