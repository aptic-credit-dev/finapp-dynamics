/**
 * M41 permission catalogue — the `security.*` + `grc.*` + `privacy.*` namespaces (all declared in naming-map; no GAP-4).
 * Three-segment (the kernel @Endpoint rule); enforced server-side in every service (default deny); registered in
 * manifests/permission-registry.yaml + seeded (migration 0001). `security.control.administer` is the cross-tenant CONTROL-PLANE
 * permission a tenant admin never holds by default (platform-scope keys/policies). Secret ROTATE / REVEAL / DESTROY are
 * privileged CONTROLLED actions. There is NO `security.admin`/`grc.admin`/`privacy.admin`/wildcard bypass; a request-supplied
 * identifier creates no authority; security posture AUGMENTS m02 RBAC — it never grants it (ADR-009).
 */
export const M41_PERMISSIONS = {
  secretRead: 'security.secret.read',
  secretManage: 'security.secret.manage',
  secretRotate: 'security.secret.rotate',
  secretReveal: 'security.secret.reveal',
  secretDestroy: 'security.secret.destroy',
  dlpRead: 'security.dlp.read',
  dlpManage: 'security.dlp.manage',
  administer: 'security.control.administer',
  grcControlRead: 'grc.control.read',
  grcControlManage: 'grc.control.manage',
  grcAssessmentRecord: 'grc.assessment.record',
  privacyPolicyRead: 'privacy.policy.read',
  privacyPolicyManage: 'privacy.policy.manage',
  privacyRecordManage: 'privacy.record.manage',
} as const;

export type M41Permission = (typeof M41_PERMISSIONS)[keyof typeof M41_PERMISSIONS];
export const ALL_M41_PERMISSIONS: readonly M41Permission[] = Object.values(M41_PERMISSIONS);

/** The CONTROL-PLANE permission — a tenant admin never holds it by default; platform-scope keys/policies require it. */
export const M41_PLATFORM_PERMISSIONS: readonly M41Permission[] = [M41_PERMISSIONS.administer];

/** The privileged subset — secret rotate/reveal/destroy + the control-plane permission. */
export const M41_PRIVILEGED_PERMISSIONS: readonly M41Permission[] = [
  M41_PERMISSIONS.secretRotate,
  M41_PERMISSIONS.secretReveal,
  M41_PERMISSIONS.secretDestroy,
  M41_PERMISSIONS.administer,
];

export function isPlatformPermission(p: string): boolean {
  return (M41_PLATFORM_PERMISSIONS as readonly string[]).includes(p);
}
