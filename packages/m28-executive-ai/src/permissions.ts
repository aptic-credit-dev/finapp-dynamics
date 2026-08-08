/**
 * M28 permission catalogue — GAP-4 resolution. The /api/v1/copilot API had NO permission namespace (naming-map
 * permission_namespaces []); m28 RESOLVES it by reusing the SHARED `ai.*` namespace with new three-segment
 * `ai.copilot.<action>` codes (like m25/m26/m27 reused m24's namespace — no new namespace, no `copilot.admin`, no
 * universal bypass). Every /copilot route (read AND mutating) authorizes exactly one of these server-side (default
 * deny); registered in manifests/permission-registry.yaml + seeded (migration 0001). read/query/feedback are
 * unprivileged; export, sensitive (confidential/restricted data), configure and platform (cross-tenant operator scope)
 * are PRIVILEGED. These do not collide with M24/M25/M26/M27 `ai.*` codes (distinct entity `ai.copilot.*`).
 */
export const M28_PERMISSIONS = {
  copilotRead: 'ai.copilot.read',
  copilotQuery: 'ai.copilot.query',
  copilotFeedback: 'ai.copilot.feedback',
  copilotExport: 'ai.copilot.export',
  copilotSensitive: 'ai.copilot.sensitive',
  copilotConfigure: 'ai.copilot.configure',
  copilotPlatform: 'ai.copilot.platform',
} as const;

export type M28Permission = (typeof M28_PERMISSIONS)[keyof typeof M28_PERMISSIONS];
export const ALL_M28_PERMISSIONS: readonly M28Permission[] = Object.values(M28_PERMISSIONS);

/**
 * The privileged subset — export, sensitive-data access, config management and platform (cross-tenant operator) scope.
 * A tenant-scoped read/query permission can NEVER grant platform scope or sensitive access; those require their own
 * dedicated privileged permission (checked independently in-service).
 */
export const M28_PRIVILEGED_PERMISSIONS: readonly M28Permission[] = [
  M28_PERMISSIONS.copilotExport,
  M28_PERMISSIONS.copilotSensitive,
  M28_PERMISSIONS.copilotConfigure,
  M28_PERMISSIONS.copilotPlatform,
];
