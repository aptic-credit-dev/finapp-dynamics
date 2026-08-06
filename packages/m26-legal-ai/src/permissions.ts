/**
 * M26 permission catalogue — new codes in the SHARED `ai.*` namespace (naming-map: m26 shares m24's namespace, adds no
 * new one). Three-segment `ai.<entity>.<action>`; enforced server-side in every service (default deny); registered in
 * manifests/permission-registry.yaml + seeded (migration 0001). The human legal review, config management, evidence
 * export and — the ETHICAL WALL — privileged-material read are privileged. There is no universal AI bypass. These do
 * not collide with M24's or M25's `ai.*` codes (distinct entities: `ai.legal.*`, `ai.privileged.*`).
 */
export const M26_PERMISSIONS = {
  legalRead: 'ai.legal.read',
  legalAnalyze: 'ai.legal.analyze',
  legalReview: 'ai.legal.review',
  legalConfigure: 'ai.legal.configure',
  legalExport: 'ai.legal.export',
  privilegedRead: 'ai.privileged.read',
} as const;

export type M26Permission = (typeof M26_PERMISSIONS)[keyof typeof M26_PERMISSIONS];
export const ALL_M26_PERMISSIONS: readonly M26Permission[] = Object.values(M26_PERMISSIONS);

/** The privileged subset — the human legal review, config, export and the ethical-wall privileged-material read. */
export const M26_PRIVILEGED_PERMISSIONS: readonly M26Permission[] = [
  M26_PERMISSIONS.legalReview,
  M26_PERMISSIONS.legalConfigure,
  M26_PERMISSIONS.legalExport,
  M26_PERMISSIONS.privilegedRead,
];
