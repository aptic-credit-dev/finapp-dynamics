/**
 * M29 permission catalogue — the SHARED `ai.*` namespace (naming-map: m29 shares m24's namespace, adds no new one).
 * `ai.governance.read` (read) + `ai.governance.manage` (author policy/use-case, propose release, record evaluation) are
 * ALREADY registered/seeded by m24; m29 adds 3 NEW privileged codes: `ai.governance.approve` (the HUMAN checker —
 * approve/reject/release/suspend/withdraw), `ai.governance.override` (waiver/exception authority) and
 * `ai.governance.export` (governance-evidence export + sensitive read). Three-segment `ai.governance.<action>`; enforced
 * server-side in every service (default deny). The maker (`manage`) and the checker (`approve`) are DISTINCT permissions
 * AND a row-level SoD CHECK enforces proposer != approver — there is NO ai.admin bypass and no AI self-approval.
 */
export const M29_PERMISSIONS = {
  governanceRead: 'ai.governance.read',
  governanceManage: 'ai.governance.manage',
  governanceApprove: 'ai.governance.approve',
  governanceOverride: 'ai.governance.override',
  governanceExport: 'ai.governance.export',
} as const;

export type M29Permission = (typeof M29_PERMISSIONS)[keyof typeof M29_PERMISSIONS];
export const ALL_M29_PERMISSIONS: readonly M29Permission[] = Object.values(M29_PERMISSIONS);

/** The NEW codes m29 registers/seeds (ai.governance.read + ai.governance.manage were registered by m24). */
export const M29_NEW_PERMISSIONS: readonly M29Permission[] = [
  M29_PERMISSIONS.governanceApprove,
  M29_PERMISSIONS.governanceOverride,
  M29_PERMISSIONS.governanceExport,
];

/** The privileged subset — manage (author/propose), the human checker, the exception authority and evidence export. */
export const M29_PRIVILEGED_PERMISSIONS: readonly M29Permission[] = [
  M29_PERMISSIONS.governanceManage,
  M29_PERMISSIONS.governanceApprove,
  M29_PERMISSIONS.governanceOverride,
  M29_PERMISSIONS.governanceExport,
];
