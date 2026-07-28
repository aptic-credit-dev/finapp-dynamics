/**
 * M16 audit codes — the authoritative constant map. Every controlled litigation mutation records one of these
 * through the kernel `AUDIT` port (m03 AuditService) in the SAME transaction as the state change. Codes are
 * SCREAMING_SNAKE `LITIGATION_<ENTITY>_<ACTION>` (>= 3 segments) and MUST be registered in
 * manifests/audit-code-registry.yaml (unregistered codes fail CI, ADR-005). Payloads never carry legal strategy,
 * full pleadings, witness statements, full submissions, private witness/party contacts, document contents,
 * confidential order/outcome terms, secrets, or notification destinations (ADR-068).
 */
export const M16_AUDIT_CODES = {
  proceedingTypeCreated: 'LITIGATION_PROCEEDING_TYPE_CREATED',
  proceedingTypePublished: 'LITIGATION_PROCEEDING_TYPE_PUBLISHED',
  slaPolicyPublished: 'LITIGATION_SLA_POLICY_PUBLISHED',
  proceedingCreated: 'LITIGATION_PROCEEDING_CREATED',
  proceedingReferred: 'LITIGATION_PROCEEDING_REFERRED',
  proceedingAssigned: 'LITIGATION_PROCEEDING_ASSIGNED',
  proceedingReassigned: 'LITIGATION_PROCEEDING_REASSIGNED',
  partyAdded: 'LITIGATION_PARTY_ADDED',
  partyRemoved: 'LITIGATION_PARTY_REMOVED',
  partyContactAccessed: 'LITIGATION_PARTY_CONTACT_ACCESSED',
  claimAdded: 'LITIGATION_CLAIM_ADDED',
  claimUpdated: 'LITIGATION_CLAIM_UPDATED',
  filingRegistered: 'LITIGATION_FILING_REGISTERED',
  filingReviewed: 'LITIGATION_FILING_REVIEWED',
  filingApproved: 'LITIGATION_FILING_APPROVED',
  filingFiled: 'LITIGATION_FILING_FILED',
  serviceRecorded: 'LITIGATION_SERVICE_RECORDED',
  serviceCompleted: 'LITIGATION_SERVICE_COMPLETED',
  serviceVerified: 'LITIGATION_SERVICE_VERIFIED',
  appearanceScheduled: 'LITIGATION_APPEARANCE_SCHEDULED',
  appearanceUpdated: 'LITIGATION_APPEARANCE_UPDATED',
  appearanceCompleted: 'LITIGATION_APPEARANCE_COMPLETED',
  appearanceAdjourned: 'LITIGATION_APPEARANCE_ADJOURNED',
  recordCaptured: 'LITIGATION_RECORD_CAPTURED',
  witnessAdded: 'LITIGATION_WITNESS_ADDED',
  witnessStatementLinked: 'LITIGATION_WITNESS_STATEMENT_LINKED',
  expertAdded: 'LITIGATION_EXPERT_ADDED',
  exhibitRegistered: 'LITIGATION_EXHIBIT_REGISTERED',
  exhibitAdmitted: 'LITIGATION_EXHIBIT_ADMITTED',
  bundleCreated: 'LITIGATION_BUNDLE_CREATED',
  bundleApproved: 'LITIGATION_BUNDLE_APPROVED',
  bundleFiled: 'LITIGATION_BUNDLE_FILED',
  orderRecorded: 'LITIGATION_ORDER_RECORDED',
  complianceCreated: 'LITIGATION_COMPLIANCE_CREATED',
  complianceCompleted: 'LITIGATION_COMPLIANCE_COMPLETED',
  complianceBreached: 'LITIGATION_COMPLIANCE_BREACHED',
  rulingRecorded: 'LITIGATION_RULING_RECORDED',
  judgmentRecorded: 'LITIGATION_JUDGMENT_RECORDED',
  appealInitiated: 'LITIGATION_APPEAL_INITIATED',
  deadlineCreated: 'LITIGATION_DEADLINE_CREATED',
  deadlineExtended: 'LITIGATION_DEADLINE_EXTENDED',
  deadlineBreached: 'LITIGATION_DEADLINE_BREACHED',
  costRecorded: 'LITIGATION_COST_RECORDED',
  noteCreated: 'LITIGATION_NOTE_CREATED',
  relationshipCreated: 'LITIGATION_RELATIONSHIP_CREATED',
  closureEvaluated: 'LITIGATION_CLOSURE_EVALUATED',
  proceedingConcluded: 'LITIGATION_PROCEEDING_CONCLUDED',
  proceedingClosed: 'LITIGATION_PROCEEDING_CLOSED',
  proceedingReopened: 'LITIGATION_PROCEEDING_REOPENED',
  proceedingArchived: 'LITIGATION_PROCEEDING_ARCHIVED',
  privilegedAccessed: 'LITIGATION_PRIVILEGED_ACCESSED',
  confidentialAccessed: 'LITIGATION_CONFIDENTIAL_ACCESSED',
  exportRequested: 'LITIGATION_EXPORT_REQUESTED',
  slaStarted: 'LITIGATION_SLA_STARTED',
  slaBreached: 'LITIGATION_SLA_BREACHED',
  escalationTriggered: 'LITIGATION_ESCALATION_TRIGGERED',
  enforcementReferralReady: 'LITIGATION_ENFORCEMENT_REFERRAL_READY',
  knowledgeCandidateCreated: 'LITIGATION_KNOWLEDGE_CANDIDATE_CREATED',
} as const;

export type M16AuditCode = (typeof M16_AUDIT_CODES)[keyof typeof M16_AUDIT_CODES];

export const ALL_M16_AUDIT_CODES: readonly M16AuditCode[] = Object.values(M16_AUDIT_CODES);

export const LITIGATION_AUDIT_PREFIX = 'LITIGATION_';
