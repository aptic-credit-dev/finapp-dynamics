/**
 * M27 permission catalogue — new codes in the SHARED `ai.*` namespace (naming-map: m27 shares m24's namespace, adds no
 * new one). Three-segment `ai.<entity>.<action>`; enforced server-side in every service (default deny); registered in
 * manifests/permission-registry.yaml + seeded (migration 0001). The human review, config management and evidence export
 * are privileged. There is no universal AI bypass. These do not collide with M24/M25/M26 `ai.*` codes (distinct entity
 * `ai.finance.*`).
 */
export const M27_PERMISSIONS = {
  financeRead: 'ai.finance.read',
  financeAnalyze: 'ai.finance.analyze',
  financeReview: 'ai.finance.review',
  financeConfigure: 'ai.finance.configure',
  financeExport: 'ai.finance.export',
} as const;

export type M27Permission = (typeof M27_PERMISSIONS)[keyof typeof M27_PERMISSIONS];
export const ALL_M27_PERMISSIONS: readonly M27Permission[] = Object.values(M27_PERMISSIONS);

/** The privileged subset — the human review, config management and evidence export. */
export const M27_PRIVILEGED_PERMISSIONS: readonly M27Permission[] = [
  M27_PERMISSIONS.financeReview,
  M27_PERMISSIONS.financeConfigure,
  M27_PERMISSIONS.financeExport,
];
