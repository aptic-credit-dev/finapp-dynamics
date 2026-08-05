/**
 * M25 permission catalogue — new codes in the SHARED `ai.*` namespace (naming-map: m25 shares m24's namespace, adds no
 * new one). Three-segment `ai.<entity>.<action>`; enforced server-side in every service (default deny); registered in
 * manifests/permission-registry.yaml + seeded (migration 0001). The human review, the suggestion decision and config
 * management are privileged. Requesting an operational analysis is permissioned but NEVER a controlled action — M25
 * recommends; a human decides and acts. These do not collide with M24's 23 `ai.*` codes (distinct entities).
 */
export const M25_PERMISSIONS = {
  operationalRead: 'ai.operational.read',
  operationalAnalyze: 'ai.operational.analyze',
  operationalReview: 'ai.operational.review',
  operationalConfigure: 'ai.operational.configure',
  suggestionRead: 'ai.suggestion.read',
  suggestionCreate: 'ai.suggestion.create',
  suggestionDecide: 'ai.suggestion.decide',
} as const;

export type M25Permission = (typeof M25_PERMISSIONS)[keyof typeof M25_PERMISSIONS];
export const ALL_M25_PERMISSIONS: readonly M25Permission[] = Object.values(M25_PERMISSIONS);

/** The privileged subset — the human review, the suggestion decision and config management. */
export const M25_PRIVILEGED_PERMISSIONS: readonly M25Permission[] = [
  M25_PERMISSIONS.operationalReview,
  M25_PERMISSIONS.operationalConfigure,
  M25_PERMISSIONS.suggestionDecide,
];
