import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The AI event families — owned by m24-ai-foundation (Stage 5). Three families: `ai.request_lifecycle`,
 * `ai.output_lifecycle`, `ai.governance_lifecycle`. Registered in manifests/event-registry.yaml alongside these
 * declarations. Delivered through the SINGLE transactional outbox that m06 owns (ADR-004/023) — m24 owns no outbox.
 * Classification `confidential`. m24 is the GOVERNED AI layer: AI assists (summarise / classify / recommend) with
 * confidence + citations; it NEVER approves, posts, files, reaches a conclusion or executes a controlled action, and
 * NEVER routes restricted data to an unapproved provider. Payloads carry IDENTIFIERS, STATES, REASON CODES, CONFIDENCE
 * (integer basis points), COUNTS and OPAQUE references (m09 document refs, provider/model/prompt ids) ONLY — never
 * prompt/output content, secrets, provider credentials or restricted data. `isAssistive` is always true — no output is
 * a controlled action.
 */

// --- ai.request_lifecycle ----------------------------------------------------------------------
export const AI_REQUEST_LIFECYCLE_FAMILY = 'ai.request_lifecycle';
export const AI_REQUEST_LIFECYCLE_VERSION = 1;
export type AiRequestLifecycleEventType =
  | 'RequestReceived'
  | 'DlpChecked'
  | 'RequestRouted'
  | 'RequestGenerated'
  | 'RequestCompleted'
  | 'RequestRejected'
  | 'RequestFailed'
  | 'RequestCancelled';
export const AI_REQUEST_LIFECYCLE_EVENT_TYPES: readonly AiRequestLifecycleEventType[] = [
  'RequestReceived',
  'DlpChecked',
  'RequestRouted',
  'RequestGenerated',
  'RequestCompleted',
  'RequestRejected',
  'RequestFailed',
  'RequestCancelled',
];

// --- ai.output_lifecycle -----------------------------------------------------------------------
export const AI_OUTPUT_LIFECYCLE_FAMILY = 'ai.output_lifecycle';
export const AI_OUTPUT_LIFECYCLE_VERSION = 1;
export type AiOutputLifecycleEventType =
  | 'OutputDrafted'
  | 'OutputValidated'
  | 'OutputReviewPending'
  | 'OutputApproved'
  | 'OutputRejected'
  | 'CitationRecorded';
export const AI_OUTPUT_LIFECYCLE_EVENT_TYPES: readonly AiOutputLifecycleEventType[] = [
  'OutputDrafted',
  'OutputValidated',
  'OutputReviewPending',
  'OutputApproved',
  'OutputRejected',
  'CitationRecorded',
];

// --- ai.governance_lifecycle -------------------------------------------------------------------
export const AI_GOVERNANCE_LIFECYCLE_FAMILY = 'ai.governance_lifecycle';
export const AI_GOVERNANCE_LIFECYCLE_VERSION = 1;
export type AiGovernanceLifecycleEventType =
  'DlpBlocked' | 'ProviderApproved' | 'GovernanceControlUpdated' | 'UsageRecorded';
export const AI_GOVERNANCE_LIFECYCLE_EVENT_TYPES: readonly AiGovernanceLifecycleEventType[] = [
  'DlpBlocked',
  'ProviderApproved',
  'GovernanceControlUpdated',
  'UsageRecorded',
];

/**
 * An AI lifecycle transition. Ids, states, reason codes, confidence (integer basis points), counts and OPAQUE refs
 * (m09 document refs, provider/model/prompt/output ids) ONLY — never prompt/output content, secrets or restricted data.
 * `isAssistive` is always true (AI never approves/posts/executes a controlled action).
 */
export interface AiLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly requestId?: string;
  readonly outputId?: string;
  readonly subjectType?: string;
  readonly subjectRef?: string;
  readonly moduleRef?: string;
  readonly providerRef?: string;
  readonly modelRef?: string;
  readonly promptRef?: string;
  readonly outputKind?: string;
  readonly classification?: string;
  readonly confidenceBps?: number;
  readonly citationCount?: number;
  readonly reviewerId?: string;
  readonly inputDocumentRef?: string;
  readonly outputDocumentRef?: string;
  readonly totalTokens?: number;
  readonly costMinor?: string;
  readonly reasonCode?: string;
  readonly isAssistive?: boolean;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type AiRequestLifecycleEvent = DomainEventEnvelope<
  typeof AI_REQUEST_LIFECYCLE_FAMILY,
  AiRequestLifecycleEventType,
  AiLifecyclePayload
>;
export type AiOutputLifecycleEvent = DomainEventEnvelope<
  typeof AI_OUTPUT_LIFECYCLE_FAMILY,
  AiOutputLifecycleEventType,
  AiLifecyclePayload
>;
export type AiGovernanceLifecycleEvent = DomainEventEnvelope<
  typeof AI_GOVERNANCE_LIFECYCLE_FAMILY,
  AiGovernanceLifecycleEventType,
  AiLifecyclePayload
>;
