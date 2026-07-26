/**
 * M13 permission catalogue — the authoritative constant map consumed by controllers' `@Endpoint` decorators and
 * enforced server-side inside the services (default deny). Every code is three segments `cases.<entity>.<action>`
 * (the kernel `@Endpoint` validator rejects anything else) and MUST be listed in
 * manifests/permission-registry.yaml under the `cases.*` namespace AND seeded into the `permissions` catalogue.
 * Confidential/privileged access (party contacts, privileged notes, confidential cases, decision/settlement
 * approval, evidence verification, platform config) is gated by dedicated privileged permissions; there is no
 * vague `cases.admin` (ADR-057).
 */
export const M13_PERMISSIONS = {
  // core case entity
  caseRead: 'cases.case.read',
  caseCreate: 'cases.case.create',
  caseUpdate: 'cases.case.update',
  caseOpen: 'cases.case.open',
  caseAssign: 'cases.case.assign',
  caseReassign: 'cases.case.reassign',
  caseTriage: 'cases.case.triage',
  caseResolve: 'cases.case.resolve',
  caseClose: 'cases.case.close',
  caseReopen: 'cases.case.reopen',
  caseArchive: 'cases.case.archive',
  // intake + M12 handoff
  handoffAccept: 'cases.handoff.accept',
  intakeCreate: 'cases.intake.create',
  // configuration
  typeRead: 'cases.type.read',
  typeManage: 'cases.type.manage',
  slaPolicyRead: 'cases.sla_policy.read',
  slaPolicyManage: 'cases.sla_policy.manage',
  // parties
  partyRead: 'cases.party.read',
  partyManage: 'cases.party.manage',
  partyContactRead: 'cases.party_contact.read',
  // activities + tasks
  activityRead: 'cases.activity.read',
  activityCreate: 'cases.activity.create',
  activityComplete: 'cases.activity.complete',
  taskRead: 'cases.task.read',
  taskManage: 'cases.task.manage',
  // documents + evidence
  documentRead: 'cases.document.read',
  documentLink: 'cases.document.link',
  evidenceRead: 'cases.evidence.read',
  evidenceManage: 'cases.evidence.manage',
  evidenceVerify: 'cases.evidence.verify',
  // investigation + findings
  investigationRead: 'cases.investigation.read',
  investigationManage: 'cases.investigation.manage',
  findingRead: 'cases.finding.read',
  findingManage: 'cases.finding.manage',
  // legal + hearings + deadlines
  legalRead: 'cases.legal.read',
  legalManage: 'cases.legal.manage',
  hearingRead: 'cases.hearing.read',
  hearingManage: 'cases.hearing.manage',
  deadlineRead: 'cases.deadline.read',
  deadlineManage: 'cases.deadline.manage',
  // decisions
  decisionRead: 'cases.decision.read',
  decisionSubmit: 'cases.decision.submit',
  decisionApprove: 'cases.decision.approve',
  // settlement + recovery
  settlementRead: 'cases.settlement.read',
  settlementManage: 'cases.settlement.manage',
  settlementApprove: 'cases.settlement.approve',
  recoveryRead: 'cases.recovery.read',
  recoveryManage: 'cases.recovery.manage',
  // confidentiality
  confidentialRead: 'cases.confidential.read',
  privilegedNotesRead: 'cases.privileged_notes.read',
  privilegedNotesCreate: 'cases.privileged_notes.create',
  // relationships
  relationshipRead: 'cases.relationship.read',
  relationshipManage: 'cases.relationship.manage',
  // reporting
  analyticsRead: 'cases.analytics.read',
  analyticsExport: 'cases.analytics.export',
  // platform
  platformAdminister: 'cases.platform.administer',
} as const;

export type M13Permission = (typeof M13_PERMISSIONS)[keyof typeof M13_PERMISSIONS];

export const ALL_M13_PERMISSIONS: readonly M13Permission[] = Object.values(M13_PERMISSIONS);

/** The privileged subset — sensitive reads + controlling/approval actions + configuration (seeded privileged). */
export const M13_PRIVILEGED_PERMISSIONS: readonly M13Permission[] = [
  M13_PERMISSIONS.caseArchive,
  M13_PERMISSIONS.caseReopen,
  M13_PERMISSIONS.typeManage,
  M13_PERMISSIONS.slaPolicyManage,
  M13_PERMISSIONS.partyContactRead,
  M13_PERMISSIONS.evidenceVerify,
  M13_PERMISSIONS.legalManage,
  M13_PERMISSIONS.decisionApprove,
  M13_PERMISSIONS.settlementApprove,
  M13_PERMISSIONS.recoveryManage,
  M13_PERMISSIONS.confidentialRead,
  M13_PERMISSIONS.privilegedNotesRead,
  M13_PERMISSIONS.privilegedNotesCreate,
  M13_PERMISSIONS.analyticsExport,
  M13_PERMISSIONS.platformAdminister,
];
