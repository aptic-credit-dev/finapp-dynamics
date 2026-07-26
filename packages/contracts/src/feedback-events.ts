import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `feedback.lifecycle` event family — owned by m12-feedback (Stage 3.1).
 *
 * Registered in manifests/event-registry.yaml alongside this declaration and the module that emits it.
 * Delivered through the SINGLE transactional outbox that m06 owns (ADR-004/023) — m12 owns no outbox.
 * Classification `confidential`. Payloads carry IDENTIFIERS, STATUSES, REASON CODES and SAFE ANALYTICS
 * DIMENSIONS ONLY — never customer contact details, full feedback narratives, confidential internal responses,
 * document contents, or notification destinations (ADR-055). A consumer that needs detail reads it back through
 * the feedback API under its own permissions.
 */

export const FEEDBACK_LIFECYCLE_FAMILY = 'feedback.lifecycle';
export const FEEDBACK_LIFECYCLE_VERSION = 1;

export type FeedbackLifecycleEventType =
  | 'TransactionIngested'
  | 'QueueItemCreated'
  | 'QueueItemClaimed'
  | 'ContactAttempted'
  | 'FeedbackCreated'
  | 'FeedbackCaptured'
  | 'FeedbackClassified'
  | 'FeedbackAssigned'
  | 'ActivityCreated'
  | 'ActivityCompleted'
  | 'ResponseSubmitted'
  | 'RootCauseRecorded'
  | 'ResolutionProposed'
  | 'FeedbackResolved'
  | 'CustomerConfirmationRequested'
  | 'CustomerConfirmationRecorded'
  | 'SlaWarning'
  | 'SlaBreached'
  | 'FeedbackEscalated'
  | 'FeedbackClosed'
  | 'FeedbackReopened'
  | 'CaseHandoffRequested'
  | 'CaseHandoffCompleted'
  | 'PositiveFeedbackRecognized';

export const FEEDBACK_LIFECYCLE_EVENT_TYPES: readonly FeedbackLifecycleEventType[] = [
  'TransactionIngested',
  'QueueItemCreated',
  'QueueItemClaimed',
  'ContactAttempted',
  'FeedbackCreated',
  'FeedbackCaptured',
  'FeedbackClassified',
  'FeedbackAssigned',
  'ActivityCreated',
  'ActivityCompleted',
  'ResponseSubmitted',
  'RootCauseRecorded',
  'ResolutionProposed',
  'FeedbackResolved',
  'CustomerConfirmationRequested',
  'CustomerConfirmationRecorded',
  'SlaWarning',
  'SlaBreached',
  'FeedbackEscalated',
  'FeedbackClosed',
  'FeedbackReopened',
  'CaseHandoffRequested',
  'CaseHandoffCompleted',
  'PositiveFeedbackRecognized',
];

/** A feedback-record lifecycle transition. Identifiers, statuses, reason codes + safe dimensions only. */
export interface FeedbackLifecyclePayload {
  readonly feedbackId: string;
  readonly sourceTransactionId?: string;
  readonly product?: string;
  readonly branch?: string;
  readonly department?: string;
  readonly channel?: string;
  readonly category?: string;
  readonly sentiment?: string;
  readonly severity?: string;
  readonly feedbackType?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly reasonCode?: string;
  readonly ruleEvaluationId?: string;
}

/** An ingestion event for a source transaction. Ids + safe dimensions only, never the raw source payload. */
export interface FeedbackIngestionPayload {
  readonly sourceTransactionId: string;
  readonly sourceSystem: string;
  readonly transactionType?: string;
  readonly product?: string;
  readonly status: string;
}

/** A case-handoff request/completion to m13. Ids + recommendation only. */
export interface FeedbackCaseHandoffPayload {
  readonly feedbackId: string;
  readonly handoffId: string;
  readonly recommendedCaseType?: string;
  readonly severity?: string;
  readonly status: string;
}

export type FeedbackEventPayload =
  FeedbackLifecyclePayload | FeedbackIngestionPayload | FeedbackCaseHandoffPayload;

export type FeedbackLifecycleEvent = DomainEventEnvelope<
  typeof FEEDBACK_LIFECYCLE_FAMILY,
  FeedbackLifecycleEventType,
  FeedbackEventPayload
>;
