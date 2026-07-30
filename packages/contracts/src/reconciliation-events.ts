import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `reconciliation.lifecycle` event family — owned by m15-recon (Stage 3).
 *
 * Registered in manifests/event-registry.yaml alongside this declaration and the module that emits it.
 * Delivered through the SINGLE transactional outbox that m06 owns (ADR-004/023) — m15 owns no outbox.
 * Classification `confidential`. m15 is BANK RECONCILIATION + the matching engine (m15a): it matches bank statement
 * lines against book/ledger entries with a deterministic, explainable rule engine (AI suggestions from m27 are
 * OPTIONAL — reconciliation works fully without them). It owns NO chart of accounts (m19), NO GL reconciliation
 * (m20), NO journals/postings (m21), NO approvals (m22), NO integration posting (m23). Money is INTEGER MINOR UNITS
 * (never float; ADR-007). Payloads carry IDENTIFIERS, STATES, MATCH TYPES, CONFIDENCE BANDS, SCORES, VARIANCES (minor
 * units), REASON CODES and DATES ONLY — never full bank account numbers, raw statement content, counterparty PII, or
 * secrets. A consumer reads detail back through the reconciliation API under its own permissions.
 */

export const RECONCILIATION_LIFECYCLE_FAMILY = 'reconciliation.lifecycle';
export const RECONCILIATION_LIFECYCLE_VERSION = 1;

export type ReconciliationLifecycleEventType =
  | 'BankAccountRegistered'
  | 'BankAccountUpdated'
  | 'BankAccountDeactivated'
  | 'StatementImported'
  | 'StatementImportRejected'
  | 'LedgerImported'
  | 'RunCreated'
  | 'RunMatchingStarted'
  | 'RunMatchingCompleted'
  | 'RunReviewStarted'
  | 'RunCompleted'
  | 'RunReopened'
  | 'MatchProposed'
  | 'MatchConfirmed'
  | 'MatchRejected'
  | 'MatchUnmatched'
  | 'SplitMatchCreated'
  | 'GroupedMatchCreated'
  | 'ExceptionRaised'
  | 'ExceptionResolved'
  | 'ExceptionWaived'
  | 'ManualDecisionRecorded'
  | 'RulesetPublished'
  | 'RulesetSuperseded';

export const RECONCILIATION_LIFECYCLE_EVENT_TYPES: readonly ReconciliationLifecycleEventType[] = [
  'BankAccountRegistered',
  'BankAccountUpdated',
  'BankAccountDeactivated',
  'StatementImported',
  'StatementImportRejected',
  'LedgerImported',
  'RunCreated',
  'RunMatchingStarted',
  'RunMatchingCompleted',
  'RunReviewStarted',
  'RunCompleted',
  'RunReopened',
  'MatchProposed',
  'MatchConfirmed',
  'MatchRejected',
  'MatchUnmatched',
  'SplitMatchCreated',
  'GroupedMatchCreated',
  'ExceptionRaised',
  'ExceptionResolved',
  'ExceptionWaived',
  'ManualDecisionRecorded',
  'RulesetPublished',
  'RulesetSuperseded',
];

/**
 * A bank-reconciliation lifecycle transition. Ids, states, match types, confidence bands, scores, variances (INTEGER
 * MINOR UNITS), reason codes and dates ONLY — never account numbers, raw statement content, counterparty PII or
 * secrets (money is minor units, never float; ADR-007).
 */
export interface ReconciliationLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly bankAccountRef?: string;
  readonly runId?: string;
  readonly matchType?: string;
  readonly confidenceBand?: string;
  readonly score?: number;
  readonly amountVarianceMinor?: string;
  readonly dateVarianceDays?: number;
  readonly exceptionType?: string;
  readonly reasonCode?: string;
  readonly rulesetVersion?: number;
  readonly matchedBy?: string;
  readonly lineCount?: number;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type ReconciliationLifecycleEvent = DomainEventEnvelope<
  typeof RECONCILIATION_LIFECYCLE_FAMILY,
  ReconciliationLifecycleEventType,
  ReconciliationLifecyclePayload
>;
