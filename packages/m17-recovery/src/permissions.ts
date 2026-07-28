/**
 * M17 permission catalogue — the authoritative constant map consumed by controllers' `@Endpoint` decorators and
 * enforced server-side inside the services (default deny). Every code is three segments `recovery.<entity>.<action>`
 * (the kernel `@Endpoint` validator rejects anything else) and MUST be listed in
 * manifests/permission-registry.yaml under the `recovery.*` namespace AND seeded into the `permissions` catalogue.
 * Privileged/confidential access (negotiation strategy, debtor contacts, arrangement/write-off/security approval,
 * configuration) is gated by dedicated privileged permissions; there is no vague `recovery.admin` (ADR-069).
 * Ethical walls are enforced by RLS FORCE + these access rules.
 */
export const M17_PERMISSIONS = {
  // core recovery
  recoveryRead: 'recovery.case.read',
  recoveryCreate: 'recovery.case.create',
  recoveryUpdate: 'recovery.case.update',
  recoveryAssign: 'recovery.case.assign',
  recoveryReassign: 'recovery.case.reassign',
  recoveryResolve: 'recovery.case.resolve',
  recoveryClose: 'recovery.case.close',
  recoveryReopen: 'recovery.case.reopen',
  recoveryArchive: 'recovery.case.archive',
  // referral (M16 enforcement referral -> recovery)
  referralAccept: 'recovery.referral.accept',
  // configuration
  recoveryTypeRead: 'recovery.recovery_type.read',
  recoveryTypeManage: 'recovery.recovery_type.manage',
  slaPolicyRead: 'recovery.sla_policy.read',
  slaPolicyManage: 'recovery.sla_policy.manage',
  // parties + instruments
  partyRead: 'recovery.party.read',
  partyManage: 'recovery.party.manage',
  partyContactRead: 'recovery.party_contact.read',
  instrumentRead: 'recovery.instrument.read',
  instrumentManage: 'recovery.instrument.manage',
  // strategy, demands, negotiations
  strategyRead: 'recovery.strategy.read',
  strategyManage: 'recovery.strategy.manage',
  demandRead: 'recovery.demand.read',
  demandManage: 'recovery.demand.manage',
  negotiationRead: 'recovery.negotiation.read',
  negotiationManage: 'recovery.negotiation.manage',
  // arrangements
  arrangementRead: 'recovery.arrangement.read',
  arrangementManage: 'recovery.arrangement.manage',
  arrangementApprove: 'recovery.arrangement.approve',
  installmentRead: 'recovery.installment.read',
  installmentManage: 'recovery.installment.manage',
  // enforcement + security
  enforcementRead: 'recovery.enforcement.read',
  enforcementManage: 'recovery.enforcement.manage',
  securityRead: 'recovery.security.read',
  securityManage: 'recovery.security.manage',
  securityRealize: 'recovery.security.realize',
  // external agents
  agentRead: 'recovery.agent.read',
  agentManage: 'recovery.agent.manage',
  agentReportRead: 'recovery.agent_report.read',
  agentReportManage: 'recovery.agent_report.manage',
  // receipts + costs (references only)
  receiptRead: 'recovery.receipt.read',
  receiptManage: 'recovery.receipt.manage',
  costRead: 'recovery.cost.read',
  costManage: 'recovery.cost.manage',
  // waivers + write-off recommendations
  waiverRead: 'recovery.waiver.read',
  waiverGrant: 'recovery.waiver.grant',
  writeoffRead: 'recovery.writeoff.read',
  writeoffRecommend: 'recovery.writeoff.recommend',
  writeoffApprove: 'recovery.writeoff.approve',
  // outcomes + deadlines
  outcomeRead: 'recovery.outcome.read',
  outcomeManage: 'recovery.outcome.manage',
  deadlineRead: 'recovery.deadline.read',
  deadlineManage: 'recovery.deadline.manage',
  // privilege
  confidentialRead: 'recovery.confidential.read',
  privilegedRead: 'recovery.privileged.read',
  privilegedCreate: 'recovery.privileged.create',
  // reporting
  analyticsRead: 'recovery.analytics.read',
  analyticsExport: 'recovery.analytics.export',
  // platform
  platformAdminister: 'recovery.platform.administer',
} as const;

export type M17Permission = (typeof M17_PERMISSIONS)[keyof typeof M17_PERMISSIONS];

export const ALL_M17_PERMISSIONS: readonly M17Permission[] = Object.values(M17_PERMISSIONS);

/** The privileged subset — sensitive reads + controlling/approval actions + configuration (seeded privileged). */
export const M17_PRIVILEGED_PERMISSIONS: readonly M17Permission[] = [
  M17_PERMISSIONS.recoveryReopen,
  M17_PERMISSIONS.recoveryArchive,
  M17_PERMISSIONS.recoveryTypeManage,
  M17_PERMISSIONS.slaPolicyManage,
  M17_PERMISSIONS.partyContactRead,
  M17_PERMISSIONS.instrumentManage,
  M17_PERMISSIONS.arrangementApprove,
  M17_PERMISSIONS.enforcementManage,
  M17_PERMISSIONS.securityRealize,
  M17_PERMISSIONS.agentManage,
  M17_PERMISSIONS.waiverGrant,
  M17_PERMISSIONS.writeoffRecommend,
  M17_PERMISSIONS.writeoffApprove,
  M17_PERMISSIONS.costManage,
  M17_PERMISSIONS.outcomeManage,
  M17_PERMISSIONS.confidentialRead,
  M17_PERMISSIONS.privilegedRead,
  M17_PERMISSIONS.privilegedCreate,
  M17_PERMISSIONS.analyticsExport,
  M17_PERMISSIONS.platformAdminister,
];
