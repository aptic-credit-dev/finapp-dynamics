/**
 * M20 audit codes — every controlled GL-reconciliation mutation records one through the kernel `AUDIT` port in the
 * SAME transaction. SCREAMING_SNAKE `GLRECON_<ENTITY>_<ACTION>` (>= 3 segments), registered in
 * manifests/audit-code-registry.yaml (unregistered codes fail CI, ADR-005). Payloads carry ids, states, match types,
 * confidence bands, scores, variances (minor units), reason codes and dates only — never GL account numbers, raw
 * source content, counterparty PII or secrets.
 */
export const M20_AUDIT_CODES = {
  accountRegistered: 'GLRECON_ACCOUNT_REGISTERED',
  accountUpdated: 'GLRECON_ACCOUNT_UPDATED',
  accountDeactivated: 'GLRECON_ACCOUNT_DEACTIVATED',
  importCreated: 'GLRECON_IMPORT_CREATED',
  importValidated: 'GLRECON_IMPORT_VALIDATED',
  importAccepted: 'GLRECON_IMPORT_ACCEPTED',
  importRejected: 'GLRECON_IMPORT_REJECTED',
  sourceImported: 'GLRECON_SOURCE_IMPORTED',
  rulesetCreated: 'GLRECON_RULESET_CREATED',
  ruleAdded: 'GLRECON_RULE_ADDED',
  rulesetPublished: 'GLRECON_RULESET_PUBLISHED',
  rulesetSuperseded: 'GLRECON_RULESET_SUPERSEDED',
  runCreated: 'GLRECON_RUN_CREATED',
  runStarted: 'GLRECON_RUN_STARTED',
  balanceComputed: 'GLRECON_BALANCE_COMPUTED',
  runCompleted: 'GLRECON_RUN_COMPLETED',
  runFailed: 'GLRECON_RUN_FAILED',
  runReopened: 'GLRECON_RUN_REOPENED',
  matchProposed: 'GLRECON_MATCH_PROPOSED',
  matchConfirmed: 'GLRECON_MATCH_CONFIRMED',
  matchRejected: 'GLRECON_MATCH_REJECTED',
  matchUnmatched: 'GLRECON_MATCH_UNMATCHED',
  groupedMatchCreated: 'GLRECON_GROUPED_MATCH_CREATED',
  reconcilingItemRaised: 'GLRECON_RECONCILING_ITEM_RAISED',
  reconcilingItemCleared: 'GLRECON_RECONCILING_ITEM_CLEARED',
  exceptionRaised: 'GLRECON_EXCEPTION_RAISED',
  exceptionAssigned: 'GLRECON_EXCEPTION_ASSIGNED',
  exceptionResolved: 'GLRECON_EXCEPTION_RESOLVED',
  exceptionWaived: 'GLRECON_EXCEPTION_WAIVED',
  manualDecisionRecorded: 'GLRECON_MANUAL_DECISION_RECORDED',
  certificationCreated: 'GLRECON_CERTIFICATION_CREATED',
  certificationRejected: 'GLRECON_CERTIFICATION_REJECTED',
  certificationOverridden: 'GLRECON_CERTIFICATION_OVERRIDDEN',
  recommendationCreated: 'GLRECON_RECOMMENDATION_CREATED',
  recommendationWithdrawn: 'GLRECON_RECOMMENDATION_WITHDRAWN',
  recommendationHandedOff: 'GLRECON_RECOMMENDATION_HANDED_OFF',
  noteAdded: 'GLRECON_NOTE_ADDED',
} as const;

export type M20AuditCode = (typeof M20_AUDIT_CODES)[keyof typeof M20_AUDIT_CODES];
export const ALL_M20_AUDIT_CODES: readonly M20AuditCode[] = Object.values(M20_AUDIT_CODES);
export const GLRECON_AUDIT_PREFIX = 'GLRECON_';
