/**
 * M22 permission catalogue — consumed by controllers' `@Endpoint` decorators and enforced server-side in the services
 * (default deny). Three-segment `approvals.<entity>.<action>`; registered in manifests/permission-registry.yaml +
 * seeded (migration 0001). The controlled acts — approve, reject, escalate, override, policy/config manage+publish,
 * reason-code manage, delegation manage, escalation manage and platform admin — are privileged; there is no vague
 * `approvals.admin`. Recording an approving decision (`approvals.decision.approve`) is privileged AND gated by SoD in
 * the service: the permission lets you act as a checker; SoD decides whether you may act on THIS request.
 */
export const M22_PERMISSIONS = {
  policyRead: 'approvals.policy.read',
  policyManage: 'approvals.policy.manage',
  policyPublish: 'approvals.policy.publish',
  configRead: 'approvals.config.read',
  configManage: 'approvals.config.manage',
  configPublish: 'approvals.config.publish',
  reasonCodeRead: 'approvals.reason_code.read',
  reasonCodeManage: 'approvals.reason_code.manage',
  requestRead: 'approvals.request.read',
  requestCreate: 'approvals.request.create',
  requestSubmit: 'approvals.request.submit',
  requestCancel: 'approvals.request.cancel',
  decisionApprove: 'approvals.decision.approve',
  decisionReject: 'approvals.decision.reject',
  decisionReturn: 'approvals.decision.return',
  decisionAbstain: 'approvals.decision.abstain',
  decisionEscalate: 'approvals.decision.escalate',
  decisionOverride: 'approvals.decision.override',
  delegationRead: 'approvals.delegation.read',
  delegationManage: 'approvals.delegation.manage',
  assignmentRead: 'approvals.assignment.read',
  escalationManage: 'approvals.escalation.manage',
  noteAdd: 'approvals.note.add',
  analyticsRead: 'approvals.analytics.read',
  platformAdminister: 'approvals.platform.administer',
} as const;

export type M22Permission = (typeof M22_PERMISSIONS)[keyof typeof M22_PERMISSIONS];
export const ALL_M22_PERMISSIONS: readonly M22Permission[] = Object.values(M22_PERMISSIONS);

/** The privileged subset — the controlled acts. Recording an approve/reject/escalate/override, managing or publishing
 * a policy/config, managing reason codes or delegations, managing escalation, and platform administration. */
export const M22_PRIVILEGED_PERMISSIONS: readonly M22Permission[] = [
  M22_PERMISSIONS.policyManage,
  M22_PERMISSIONS.policyPublish,
  M22_PERMISSIONS.configManage,
  M22_PERMISSIONS.configPublish,
  M22_PERMISSIONS.reasonCodeManage,
  M22_PERMISSIONS.decisionApprove,
  M22_PERMISSIONS.decisionReject,
  M22_PERMISSIONS.decisionEscalate,
  M22_PERMISSIONS.decisionOverride,
  M22_PERMISSIONS.delegationManage,
  M22_PERMISSIONS.escalationManage,
  M22_PERMISSIONS.platformAdminister,
];
