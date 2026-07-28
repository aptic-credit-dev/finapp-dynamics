/**
 * M16 permission catalogue — the authoritative constant map consumed by controllers' `@Endpoint` decorators and
 * enforced server-side inside the services (default deny). Every code is three segments
 * `litigation.<entity>.<action>` (the kernel `@Endpoint` validator rejects anything else) and MUST be listed in
 * manifests/permission-registry.yaml under the `litigation.*` namespace AND seeded into the `permissions`
 * catalogue. Privileged/confidential access (legal strategy, privileged notes, private witness/party contacts,
 * filing approval, service verification, order/outcome management, configuration) is gated by dedicated privileged
 * permissions; there is no vague `litigation.admin` (ADR-065). Ethical walls are enforced by RLS FORCE + these
 * access rules.
 */
export const M16_PERMISSIONS = {
  // core proceeding
  proceedingRead: 'litigation.proceeding.read',
  proceedingCreate: 'litigation.proceeding.create',
  proceedingUpdate: 'litigation.proceeding.update',
  proceedingAssign: 'litigation.proceeding.assign',
  proceedingReassign: 'litigation.proceeding.reassign',
  proceedingConclude: 'litigation.proceeding.conclude',
  proceedingClose: 'litigation.proceeding.close',
  proceedingReopen: 'litigation.proceeding.reopen',
  proceedingArchive: 'litigation.proceeding.archive',
  // referral (M14 matter -> litigation)
  referralAccept: 'litigation.referral.accept',
  // configuration
  proceedingTypeRead: 'litigation.proceeding_type.read',
  proceedingTypeManage: 'litigation.proceeding_type.manage',
  slaPolicyRead: 'litigation.sla_policy.read',
  slaPolicyManage: 'litigation.sla_policy.manage',
  // parties + claims
  partyRead: 'litigation.party.read',
  partyManage: 'litigation.party.manage',
  partyContactRead: 'litigation.party_contact.read',
  claimRead: 'litigation.claim.read',
  claimManage: 'litigation.claim.manage',
  // filings + service
  filingRead: 'litigation.filing.read',
  filingManage: 'litigation.filing.manage',
  filingApprove: 'litigation.filing.approve',
  serviceRead: 'litigation.service.read',
  serviceManage: 'litigation.service.manage',
  serviceVerify: 'litigation.service.verify',
  // appearances
  appearanceRead: 'litigation.appearance.read',
  appearanceManage: 'litigation.appearance.manage',
  appearanceComplete: 'litigation.appearance.complete',
  // witnesses + evidence
  witnessRead: 'litigation.witness.read',
  witnessManage: 'litigation.witness.manage',
  witnessContactRead: 'litigation.witness_contact.read',
  expertRead: 'litigation.expert.read',
  expertManage: 'litigation.expert.manage',
  exhibitRead: 'litigation.exhibit.read',
  exhibitManage: 'litigation.exhibit.manage',
  bundleRead: 'litigation.bundle.read',
  bundleManage: 'litigation.bundle.manage',
  bundleApprove: 'litigation.bundle.approve',
  // orders + outcomes
  orderRead: 'litigation.order.read',
  orderManage: 'litigation.order.manage',
  complianceRead: 'litigation.compliance.read',
  complianceManage: 'litigation.compliance.manage',
  outcomeRead: 'litigation.outcome.read',
  outcomeManage: 'litigation.outcome.manage',
  appealRead: 'litigation.appeal.read',
  appealManage: 'litigation.appeal.manage',
  // deadlines
  deadlineRead: 'litigation.deadline.read',
  deadlineManage: 'litigation.deadline.manage',
  // costs
  costRead: 'litigation.cost.read',
  costManage: 'litigation.cost.manage',
  // privilege
  confidentialRead: 'litigation.confidential.read',
  privilegedRead: 'litigation.privileged.read',
  privilegedCreate: 'litigation.privileged.create',
  // reporting
  analyticsRead: 'litigation.analytics.read',
  analyticsExport: 'litigation.analytics.export',
  // platform
  platformAdminister: 'litigation.platform.administer',
} as const;

export type M16Permission = (typeof M16_PERMISSIONS)[keyof typeof M16_PERMISSIONS];

export const ALL_M16_PERMISSIONS: readonly M16Permission[] = Object.values(M16_PERMISSIONS);

/** The privileged subset — sensitive reads + controlling/approval actions + configuration (seeded privileged). */
export const M16_PRIVILEGED_PERMISSIONS: readonly M16Permission[] = [
  M16_PERMISSIONS.proceedingReopen,
  M16_PERMISSIONS.proceedingArchive,
  M16_PERMISSIONS.proceedingTypeManage,
  M16_PERMISSIONS.slaPolicyManage,
  M16_PERMISSIONS.partyContactRead,
  M16_PERMISSIONS.filingApprove,
  M16_PERMISSIONS.serviceVerify,
  M16_PERMISSIONS.witnessContactRead,
  M16_PERMISSIONS.expertManage,
  M16_PERMISSIONS.bundleApprove,
  M16_PERMISSIONS.orderManage,
  M16_PERMISSIONS.complianceManage,
  M16_PERMISSIONS.outcomeManage,
  M16_PERMISSIONS.appealManage,
  M16_PERMISSIONS.costManage,
  M16_PERMISSIONS.confidentialRead,
  M16_PERMISSIONS.privilegedRead,
  M16_PERMISSIONS.privilegedCreate,
  M16_PERMISSIONS.analyticsExport,
  M16_PERMISSIONS.platformAdminister,
];
