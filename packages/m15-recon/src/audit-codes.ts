/**
 * M15 audit codes — every controlled reconciliation mutation records one through the kernel `AUDIT` port in the
 * SAME transaction. SCREAMING_SNAKE `RECON_<ENTITY>_<ACTION>` (>= 3 segments), registered in
 * manifests/audit-code-registry.yaml (unregistered codes fail CI, ADR-005). Payloads carry ids, states, match
 * types, confidence bands, scores, variances (minor units), reason codes and dates only — never full account
 * numbers, raw statement content, counterparty PII or secrets.
 */
export const M15_AUDIT_CODES = {
  bankAccountRegistered: 'RECON_BANK_ACCOUNT_REGISTERED',
  bankAccountUpdated: 'RECON_BANK_ACCOUNT_UPDATED',
  bankAccountDeactivated: 'RECON_BANK_ACCOUNT_DEACTIVATED',
  statementImported: 'RECON_STATEMENT_IMPORTED',
  statementImportRejected: 'RECON_STATEMENT_IMPORT_REJECTED',
  ledgerImported: 'RECON_LEDGER_IMPORTED',
  runCreated: 'RECON_RUN_CREATED',
  runMatchingStarted: 'RECON_RUN_MATCHING_STARTED',
  runMatchingCompleted: 'RECON_RUN_MATCHING_COMPLETED',
  runReviewStarted: 'RECON_RUN_REVIEW_STARTED',
  runCompleted: 'RECON_RUN_COMPLETED',
  runReopened: 'RECON_RUN_REOPENED',
  matchProposed: 'RECON_MATCH_PROPOSED',
  matchConfirmed: 'RECON_MATCH_CONFIRMED',
  matchRejected: 'RECON_MATCH_REJECTED',
  matchUnmatched: 'RECON_MATCH_UNMATCHED',
  splitMatchCreated: 'RECON_SPLIT_MATCH_CREATED',
  groupedMatchCreated: 'RECON_GROUPED_MATCH_CREATED',
  exceptionRaised: 'RECON_EXCEPTION_RAISED',
  exceptionResolved: 'RECON_EXCEPTION_RESOLVED',
  exceptionWaived: 'RECON_EXCEPTION_WAIVED',
  manualDecisionRecorded: 'RECON_MANUAL_DECISION_RECORDED',
  rulesetCreated: 'RECON_RULESET_CREATED',
  ruleAdded: 'RECON_RULE_ADDED',
  rulesetPublished: 'RECON_RULESET_PUBLISHED',
  rulesetSuperseded: 'RECON_RULESET_SUPERSEDED',
  noteAdded: 'RECON_NOTE_ADDED',
  analyticsExported: 'RECON_ANALYTICS_EXPORTED',
} as const;

export type M15AuditCode = (typeof M15_AUDIT_CODES)[keyof typeof M15_AUDIT_CODES];
export const ALL_M15_AUDIT_CODES: readonly M15AuditCode[] = Object.values(M15_AUDIT_CODES);
export const RECON_AUDIT_PREFIX = 'RECON_';
