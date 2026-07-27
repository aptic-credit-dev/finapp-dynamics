/**
 * M14 permission catalogue — the authoritative constant map consumed by controllers' `@Endpoint` decorators and
 * enforced server-side inside the services (default deny). Every code is three segments `legal.<entity>.<action>`
 * (the kernel `@Endpoint` validator rejects anything else) and MUST be listed in
 * manifests/permission-registry.yaml under the `legal.*` namespace AND seeded into the `permissions` catalogue.
 * Privileged/confidential access (legal positions/strategy, opinions, privileged notes, party contacts, settlement
 * terms, approvals, configuration) is gated by dedicated privileged permissions; there is no vague `legal.admin`
 * (ADR-061). Ethical walls are enforced by RLS FORCE + these access rules.
 */
export const M14_PERMISSIONS = {
  // core matter
  matterRead: 'legal.matter.read',
  matterCreate: 'legal.matter.create',
  matterUpdate: 'legal.matter.update',
  matterOpen: 'legal.matter.open',
  matterAssign: 'legal.matter.assign',
  matterReassign: 'legal.matter.reassign',
  matterResolve: 'legal.matter.resolve',
  matterClose: 'legal.matter.close',
  matterReopen: 'legal.matter.reopen',
  matterArchive: 'legal.matter.archive',
  // conversion + intake
  conversionAccept: 'legal.conversion.accept',
  // configuration
  matterTypeRead: 'legal.matter_type.read',
  matterTypeManage: 'legal.matter_type.manage',
  slaPolicyRead: 'legal.sla_policy.read',
  slaPolicyManage: 'legal.sla_policy.manage',
  jurisdictionRead: 'legal.jurisdiction.read',
  jurisdictionManage: 'legal.jurisdiction.manage',
  // instructions
  instructionRead: 'legal.instruction.read',
  instructionCreate: 'legal.instruction.create',
  instructionAccept: 'legal.instruction.accept',
  instructionReject: 'legal.instruction.reject',
  // parties
  partyRead: 'legal.party.read',
  partyManage: 'legal.party.manage',
  partyContactRead: 'legal.party_contact.read',
  // activities + tasks
  activityRead: 'legal.activity.read',
  activityCreate: 'legal.activity.create',
  activityComplete: 'legal.activity.complete',
  taskRead: 'legal.task.read',
  taskManage: 'legal.task.manage',
  // pleadings + documents
  pleadingRead: 'legal.pleading.read',
  pleadingManage: 'legal.pleading.manage',
  documentRead: 'legal.document.read',
  documentLink: 'legal.document.link',
  // court events + deadlines
  courtEventRead: 'legal.court_event.read',
  courtEventManage: 'legal.court_event.manage',
  deadlineRead: 'legal.deadline.read',
  deadlineManage: 'legal.deadline.manage',
  // legal analysis
  issueRead: 'legal.issue.read',
  issueManage: 'legal.issue.manage',
  positionRead: 'legal.position.read',
  positionManage: 'legal.position.manage',
  opinionRead: 'legal.opinion.read',
  opinionManage: 'legal.opinion.manage',
  researchRead: 'legal.research.read',
  researchManage: 'legal.research.manage',
  // external counsel
  externalCounselRead: 'legal.external_counsel.read',
  externalCounselManage: 'legal.external_counsel.manage',
  counselReportRead: 'legal.counsel_report.read',
  counselReportManage: 'legal.counsel_report.manage',
  // settlement + outcome
  settlementRead: 'legal.settlement.read',
  settlementSubmit: 'legal.settlement.submit',
  settlementApprove: 'legal.settlement.approve',
  judgmentRead: 'legal.judgment.read',
  judgmentManage: 'legal.judgment.manage',
  appealRead: 'legal.appeal.read',
  appealManage: 'legal.appeal.manage',
  enforcementRead: 'legal.enforcement.read',
  enforcementManage: 'legal.enforcement.manage',
  // costs + exposure
  costRead: 'legal.cost.read',
  costManage: 'legal.cost.manage',
  exposureRead: 'legal.exposure.read',
  exposureManage: 'legal.exposure.manage',
  // privilege
  confidentialRead: 'legal.confidential.read',
  privilegedRead: 'legal.privileged.read',
  privilegedCreate: 'legal.privileged.create',
  // relationships
  relationshipRead: 'legal.relationship.read',
  relationshipManage: 'legal.relationship.manage',
  // reporting
  analyticsRead: 'legal.analytics.read',
  analyticsExport: 'legal.analytics.export',
  // platform
  platformAdminister: 'legal.platform.administer',
} as const;

export type M14Permission = (typeof M14_PERMISSIONS)[keyof typeof M14_PERMISSIONS];

export const ALL_M14_PERMISSIONS: readonly M14Permission[] = Object.values(M14_PERMISSIONS);

/** The privileged subset — sensitive reads + controlling/approval actions + configuration (seeded privileged). */
export const M14_PRIVILEGED_PERMISSIONS: readonly M14Permission[] = [
  M14_PERMISSIONS.matterReopen,
  M14_PERMISSIONS.matterArchive,
  M14_PERMISSIONS.matterTypeManage,
  M14_PERMISSIONS.slaPolicyManage,
  M14_PERMISSIONS.jurisdictionManage,
  M14_PERMISSIONS.instructionAccept,
  M14_PERMISSIONS.instructionReject,
  M14_PERMISSIONS.partyContactRead,
  M14_PERMISSIONS.positionRead,
  M14_PERMISSIONS.positionManage,
  M14_PERMISSIONS.opinionManage,
  M14_PERMISSIONS.externalCounselManage,
  M14_PERMISSIONS.settlementApprove,
  M14_PERMISSIONS.judgmentManage,
  M14_PERMISSIONS.appealManage,
  M14_PERMISSIONS.enforcementManage,
  M14_PERMISSIONS.costManage,
  M14_PERMISSIONS.exposureManage,
  M14_PERMISSIONS.confidentialRead,
  M14_PERMISSIONS.privilegedRead,
  M14_PERMISSIONS.privilegedCreate,
  M14_PERMISSIONS.analyticsExport,
  M14_PERMISSIONS.platformAdminister,
];
