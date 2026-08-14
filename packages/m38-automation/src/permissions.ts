/**
 * M38 permission catalogue — the `automation.*` and `extensions.*` namespaces (both declared in naming-map; no GAP-4).
 * Three-segment `automation.<area>.<action>` / `extensions.<area>.<action>` (the kernel @Endpoint rule); enforced server-side
 * in every service (default deny); registered in manifests/permission-registry.yaml + seeded (migration 0001).
 * `automation.control.administer` is the cross-tenant CONTROL-PLANE permission a tenant admin never holds by default (it
 * governs platform-scope automations/extensions). AUTOMATION ACTIVATION and EXTENSION PUBLISH are privileged CONTROLLED
 * actions. There is NO `automation.admin`/`extensions.admin`/wildcard bypass; a request-supplied identifier creates no
 * authority; a feature flag can never substitute a permission (RBAC m02 authoritative).
 */
export const M38_PERMISSIONS = {
  jobRead: 'automation.job.read',
  jobManage: 'automation.job.manage',
  jobActivate: 'automation.job.activate',
  executionRead: 'automation.execution.read',
  administer: 'automation.control.administer',
  extensionRead: 'extensions.registry.read',
  extensionManage: 'extensions.registry.manage',
  extensionPublish: 'extensions.registry.publish',
  extensionInstall: 'extensions.install.manage',
} as const;

export type M38Permission = (typeof M38_PERMISSIONS)[keyof typeof M38_PERMISSIONS];
export const ALL_M38_PERMISSIONS: readonly M38Permission[] = Object.values(M38_PERMISSIONS);

/** The CONTROL-PLANE permission — a tenant admin never holds it by default; platform-scope automations/extensions require it. */
export const M38_PLATFORM_PERMISSIONS: readonly M38Permission[] = [M38_PERMISSIONS.administer];

/** The privileged subset — automation activation, extension publish + the control-plane permission. */
export const M38_PRIVILEGED_PERMISSIONS: readonly M38Permission[] = [
  M38_PERMISSIONS.jobActivate,
  M38_PERMISSIONS.extensionPublish,
  M38_PERMISSIONS.administer,
];

export function isPlatformPermission(p: string): boolean {
  return (M38_PLATFORM_PERMISSIONS as readonly string[]).includes(p);
}
