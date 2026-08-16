/**
 * M42 permission catalogue — the `platform_certification.*` namespace (declared in naming-map; no GAP). Three-segment
 * (platform_certification.<area>.<action>); enforced server-side in every service (default deny); registered in
 * manifests/permission-registry.yaml + seeded (migration 0001). `platform_certification.control.administer` is the cross-tenant
 * CONTROL-PLANE permission a tenant admin never holds by default (a platform-scope Stage-6 programme). `waiver.approve`,
 * `signoff.approve` and `decision.issue` are privileged CONTROLLED actions. There is NO `platform_certification.admin`/wildcard.
 */
export const M42_PERMISSIONS = {
  programmeRead: 'platform_certification.programme.read',
  programmeManage: 'platform_certification.programme.manage',
  assessmentRead: 'platform_certification.assessment.read',
  assessmentManage: 'platform_certification.assessment.manage',
  findingRead: 'platform_certification.finding.read',
  findingManage: 'platform_certification.finding.manage',
  waiverRequest: 'platform_certification.waiver.request',
  waiverApprove: 'platform_certification.waiver.approve',
  signoffApprove: 'platform_certification.signoff.approve',
  decisionIssue: 'platform_certification.decision.issue',
  evidenceRead: 'platform_certification.evidence.read',
  administer: 'platform_certification.control.administer',
} as const;

export type M42Permission = (typeof M42_PERMISSIONS)[keyof typeof M42_PERMISSIONS];
export const ALL_M42_PERMISSIONS: readonly M42Permission[] = Object.values(M42_PERMISSIONS);

/** The CONTROL-PLANE permission — a tenant admin never holds it by default; a platform-scope programme requires it. */
export const M42_PLATFORM_PERMISSIONS: readonly M42Permission[] = [M42_PERMISSIONS.administer];

/** The privileged subset — waiver approval, sign-off, decision issuance + the control-plane permission. */
export const M42_PRIVILEGED_PERMISSIONS: readonly M42Permission[] = [
  M42_PERMISSIONS.waiverApprove,
  M42_PERMISSIONS.signoffApprove,
  M42_PERMISSIONS.decisionIssue,
  M42_PERMISSIONS.administer,
];

export function isPlatformPermission(p: string): boolean {
  return (M42_PLATFORM_PERMISSIONS as readonly string[]).includes(p);
}

export function isThreeSegmentPermission(p: string): boolean {
  return p.split('.').length === 3;
}
