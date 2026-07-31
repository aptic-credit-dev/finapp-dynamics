import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `glrecon.lifecycle` event family — owned by m20-glrecon (Stage 3).
 *
 * Registered in manifests/event-registry.yaml alongside this declaration and the module that emits it.
 * Delivered through the SINGLE transactional outbox that m06 owns (ADR-004/023) — m20 owns no outbox.
 * Classification `confidential`. m20 is GENERAL-LEDGER RECONCILIATION: it reconciles GL balances + transactions
 * against a source system, computes the balance invariant (opening + debits − credits = calculated closing) in
 * INTEGER MINOR UNITS, manages reconciling items + exceptions, certifies balances, and produces DRAFT journal
 * recommendations for m21. It owns NO chart of accounts (m19 — opaque account/period/currency refs), NO bank
 * reconciliation (m15), NO journal posting (m21), NO approval workflow (m22), NO integration posting (m23), NO AI
 * (m27). It NEVER posts a journal, writes to the general ledger, or approves anything. Money is INTEGER MINOR UNITS
 * (never float; ADR-007). Payloads carry IDENTIFIERS, STATES, MATCH TYPES, CONFIDENCE BANDS, SCORES, VARIANCES (minor
 * units), REASON CODES and DATES ONLY — never full GL account numbers, raw source content, counterparty PII, or
 * secrets. A consumer reads detail back through the GL-reconciliation API under its own permissions.
 */

export const GLRECON_LIFECYCLE_FAMILY = 'glrecon.lifecycle';
export const GLRECON_LIFECYCLE_VERSION = 1;

export type GlreconLifecycleEventType =
  | 'AccountRegistered'
  | 'AccountUpdated'
  | 'AccountDeactivated'
  | 'ImportCreated'
  | 'ImportValidated'
  | 'ImportAccepted'
  | 'ImportRejected'
  | 'SourceImported'
  | 'RulesetPublished'
  | 'RulesetSuperseded'
  | 'RunCreated'
  | 'RunStarted'
  | 'RunBalanceComputed'
  | 'RunCompleted'
  | 'RunFailed'
  | 'RunReopened'
  | 'MatchProposed'
  | 'MatchConfirmed'
  | 'MatchRejected'
  | 'MatchUnmatched'
  | 'GroupedMatchCreated'
  | 'ReconcilingItemRaised'
  | 'ReconcilingItemCleared'
  | 'ExceptionRaised'
  | 'ExceptionResolved'
  | 'ExceptionWaived'
  | 'ManualDecisionRecorded'
  | 'BalanceCertified'
  | 'CertificationRejected'
  | 'CertificationOverridden'
  | 'RecommendationCreated'
  | 'RecommendationWithdrawn'
  | 'RecommendationHandedOff';

export const GLRECON_LIFECYCLE_EVENT_TYPES: readonly GlreconLifecycleEventType[] = [
  'AccountRegistered',
  'AccountUpdated',
  'AccountDeactivated',
  'ImportCreated',
  'ImportValidated',
  'ImportAccepted',
  'ImportRejected',
  'SourceImported',
  'RulesetPublished',
  'RulesetSuperseded',
  'RunCreated',
  'RunStarted',
  'RunBalanceComputed',
  'RunCompleted',
  'RunFailed',
  'RunReopened',
  'MatchProposed',
  'MatchConfirmed',
  'MatchRejected',
  'MatchUnmatched',
  'GroupedMatchCreated',
  'ReconcilingItemRaised',
  'ReconcilingItemCleared',
  'ExceptionRaised',
  'ExceptionResolved',
  'ExceptionWaived',
  'ManualDecisionRecorded',
  'BalanceCertified',
  'CertificationRejected',
  'CertificationOverridden',
  'RecommendationCreated',
  'RecommendationWithdrawn',
  'RecommendationHandedOff',
];

/**
 * A GL-reconciliation lifecycle transition. Ids, states, match types, confidence bands, scores, variances (INTEGER
 * MINOR UNITS as strings), reason codes and dates ONLY — never GL account numbers, raw source content, counterparty
 * PII or secrets (money is minor units, never float; ADR-007). `recommendationDraft` is always true — m20 emits
 * DRAFT recommendations only; it never posts or approves.
 */
export interface GlreconLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly glAccountRef?: string;
  readonly runId?: string;
  readonly matchType?: string;
  readonly confidenceBand?: string;
  readonly score?: number;
  readonly amountVarianceMinor?: string;
  readonly balanceVarianceMinor?: string;
  readonly dateVarianceDays?: number;
  readonly exceptionType?: string;
  readonly itemType?: string;
  readonly reasonCode?: string;
  readonly rulesetVersion?: number;
  readonly matchedBy?: string;
  readonly lineCount?: number;
  readonly recommendationDraft?: boolean;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type GlreconLifecycleEvent = DomainEventEnvelope<
  typeof GLRECON_LIFECYCLE_FAMILY,
  GlreconLifecycleEventType,
  GlreconLifecyclePayload
>;
