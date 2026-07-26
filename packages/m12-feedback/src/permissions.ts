/**
 * M12 permission catalogue — the authoritative constant map consumed by controllers' `@Endpoint` decorators and
 * enforced server-side inside the services (default deny). Every code is three segments
 * `feedback.<entity>.<action>` (the kernel `@Endpoint` validator rejects anything else) and MUST be listed in
 * manifests/permission-registry.yaml under the `feedback.*` namespace AND seeded into the `permissions`
 * catalogue. Customer-contact + confidential-notes access is gated by dedicated privileged permissions; there is
 * no vague `feedback.admin` (ADR-052).
 */
export const M12_PERMISSIONS = {
  queueRead: 'feedback.queue.read',
  queueClaim: 'feedback.queue.claim',
  queueAssign: 'feedback.queue.assign',
  recordRead: 'feedback.record.read',
  recordCreate: 'feedback.record.create',
  recordCapture: 'feedback.record.capture',
  recordUpdate: 'feedback.record.update',
  recordClassify: 'feedback.record.classify',
  recordClose: 'feedback.record.close',
  recordReopen: 'feedback.record.reopen',
  activityRead: 'feedback.activity.read',
  activityCreate: 'feedback.activity.create',
  activityComplete: 'feedback.activity.complete',
  assignmentRead: 'feedback.assignment.read',
  assignmentManage: 'feedback.assignment.manage',
  responseRead: 'feedback.response.read',
  responseSubmit: 'feedback.response.submit',
  rootCauseManage: 'feedback.root_cause.manage',
  resolutionSubmit: 'feedback.resolution.submit',
  resolutionApprove: 'feedback.resolution.approve',
  confirmationRecord: 'feedback.confirmation.record',
  slaRead: 'feedback.sla.read',
  slaManage: 'feedback.sla.manage',
  escalationRead: 'feedback.escalation.read',
  escalationTrigger: 'feedback.escalation.trigger',
  questionnaireRead: 'feedback.questionnaire.read',
  questionnaireManage: 'feedback.questionnaire.manage',
  categoryManage: 'feedback.category.manage',
  slaPolicyManage: 'feedback.sla_policy.manage',
  sourceManage: 'feedback.source.manage',
  sourceIngest: 'feedback.source.ingest',
  caseHandoffRead: 'feedback.case_handoff.read',
  caseHandoffRequest: 'feedback.case_handoff.request',
  analyticsRead: 'feedback.analytics.read',
  analyticsExport: 'feedback.analytics.export',
  customerContactRead: 'feedback.customer_contact.read',
  platformAdminister: 'feedback.platform.administer',
} as const;

export type M12Permission = (typeof M12_PERMISSIONS)[keyof typeof M12_PERMISSIONS];

export const ALL_M12_PERMISSIONS: readonly M12Permission[] = Object.values(M12_PERMISSIONS);
