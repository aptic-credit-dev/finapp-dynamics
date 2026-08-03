/**
 * M21 audit codes — every controlled journal-engine mutation records one through the kernel `AUDIT` port in the SAME
 * transaction. SCREAMING_SNAKE `JOURNAL_<ENTITY>_<ACTION>` (>= 3 segments), registered in
 * manifests/audit-code-registry.yaml (unregistered codes fail CI, ADR-005). Payloads carry ids, states, totals
 * (minor units), reason codes and dates only — never account numbers, line narratives, counterparty PII or secrets.
 */
export const M21_AUDIT_CODES = {
  recommendationIngested: 'JOURNAL_RECOMMENDATION_INGESTED',
  recommendationAccepted: 'JOURNAL_RECOMMENDATION_ACCEPTED',
  recommendationDismissed: 'JOURNAL_RECOMMENDATION_DISMISSED',
  recommendationConverted: 'JOURNAL_RECOMMENDATION_CONVERTED',
  typeCreated: 'JOURNAL_TYPE_CREATED',
  typeUpdated: 'JOURNAL_TYPE_UPDATED',
  configCreated: 'JOURNAL_CONFIG_CREATED',
  configPublished: 'JOURNAL_CONFIG_PUBLISHED',
  reasonCodeRegistered: 'JOURNAL_REASON_CODE_REGISTERED',
  draftCreated: 'JOURNAL_DRAFT_CREATED',
  draftEdited: 'JOURNAL_DRAFT_EDITED',
  draftValidated: 'JOURNAL_DRAFT_VALIDATED',
  draftSubmitted: 'JOURNAL_DRAFT_SUBMITTED',
  draftWithdrawn: 'JOURNAL_DRAFT_WITHDRAWN',
  draftPosted: 'JOURNAL_DRAFT_POSTED',
  lineAdded: 'JOURNAL_LINE_ADDED',
  lineUpdated: 'JOURNAL_LINE_UPDATED',
  lineRemoved: 'JOURNAL_LINE_REMOVED',
  noteAdded: 'JOURNAL_NOTE_ADDED',
  postingRequestCreated: 'JOURNAL_POSTING_REQUEST_CREATED',
  postingRequestAuthorized: 'JOURNAL_POSTING_REQUEST_AUTHORIZED',
  postingRequestCancelled: 'JOURNAL_POSTING_REQUEST_CANCELLED',
  postingResultRecorded: 'JOURNAL_POSTING_RESULT_RECORDED',
} as const;

export type M21AuditCode = (typeof M21_AUDIT_CODES)[keyof typeof M21_AUDIT_CODES];
export const ALL_M21_AUDIT_CODES: readonly M21AuditCode[] = Object.values(M21_AUDIT_CODES);
export const JOURNAL_AUDIT_PREFIX = 'JOURNAL_';
