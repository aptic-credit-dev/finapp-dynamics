import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `journal.lifecycle` event family — owned by m21-journal (Stage 3).
 *
 * Registered in manifests/event-registry.yaml alongside this declaration and the module that emits it.
 * Delivered through the SINGLE transactional outbox that m06 owns (ADR-004/023) — m21 owns no outbox.
 * Classification `confidential`. m21 is the JOURNAL ENGINE (DRAFT-first MVP): it turns m20 draft
 * recommendations (and operational inputs) into BALANCED, decimal-safe journal DRAFTS (debits == credits),
 * runs deterministic validation, and manages the draft lifecycle up to submission for approval. It owns NO
 * chart of accounts / fiscal periods (m19 — opaque account/period/currency refs), NO GL reconciliation (m20),
 * NO approval workflow (m22 — maker-checker + SoD), NO integration/posting push (m23/m33). It NEVER approves a
 * journal, posts to a ledger or external system, or auto-posts. Money is INTEGER MINOR UNITS (never float;
 * ADR-007) — carried in payloads as STRINGS. Payloads carry IDENTIFIERS, STATES, TOTALS (minor units),
 * REASON CODES, COUNTS and DATES ONLY — never account numbers, line narratives, counterparty PII, or secrets.
 * A consumer reads detail back through the journals API under its own permissions.
 */

export const JOURNAL_LIFECYCLE_FAMILY = 'journal.lifecycle';
export const JOURNAL_LIFECYCLE_VERSION = 1;

export type JournalLifecycleEventType =
  | 'RecommendationIngested'
  | 'RecommendationAccepted'
  | 'RecommendationDismissed'
  | 'RecommendationConverted'
  | 'JournalTypeCreated'
  | 'JournalConfigPublished'
  | 'DraftCreated'
  | 'DraftEdited'
  | 'LineAdded'
  | 'LineUpdated'
  | 'LineRemoved'
  | 'DraftValidated'
  | 'DraftSubmitted'
  | 'DraftWithdrawn'
  | 'DraftPosted'
  | 'NoteAdded';

export const JOURNAL_LIFECYCLE_EVENT_TYPES: readonly JournalLifecycleEventType[] = [
  'RecommendationIngested',
  'RecommendationAccepted',
  'RecommendationDismissed',
  'RecommendationConverted',
  'JournalTypeCreated',
  'JournalConfigPublished',
  'DraftCreated',
  'DraftEdited',
  'LineAdded',
  'LineUpdated',
  'LineRemoved',
  'DraftValidated',
  'DraftSubmitted',
  'DraftWithdrawn',
  'DraftPosted',
  'NoteAdded',
];

/**
 * A journal lifecycle transition. Ids, states, totals (INTEGER MINOR UNITS as strings), balance flag, reason
 * codes, counts and dates ONLY — never account numbers, line narratives, counterparty PII or secrets (money is
 * minor units, never float; ADR-007). `isDraft` is always true in the MVP — m21 never posts or approves.
 */
export interface JournalLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly draftId?: string;
  readonly recommendationId?: string;
  readonly entityRef?: string;
  readonly periodRef?: string;
  readonly currencyRef?: string;
  readonly journalType?: string;
  readonly sourceType?: string;
  readonly confidenceBand?: string;
  readonly totalDebitsMinor?: string;
  readonly totalCreditsMinor?: string;
  readonly balanced?: boolean;
  readonly lineCount?: number;
  readonly reasonCode?: string;
  readonly reasonCodes?: readonly string[];
  readonly isDraft?: boolean;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type JournalLifecycleEvent = DomainEventEnvelope<
  typeof JOURNAL_LIFECYCLE_FAMILY,
  JournalLifecycleEventType,
  JournalLifecyclePayload
>;
