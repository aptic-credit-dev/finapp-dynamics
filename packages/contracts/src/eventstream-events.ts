import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The event-stream family — owned by m36-events (Stage 6D-4). One family: `eventstream.lifecycle`. Registered in
 * manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox that m06 owns
 * (ADR-004) — m36 owns no outbox. These are STREAM + CURSOR lifecycle transitions ONLY (a stream created/paused, a cursor
 * advanced). Payloads carry IDENTIFIERS, a bounded key, a status and REASON CODES ONLY — never an event payload body or
 * personal data (ADR-123).
 */
export const EVENTSTREAM_LIFECYCLE_FAMILY = 'eventstream.lifecycle';
export const EVENTSTREAM_LIFECYCLE_VERSION = 1;
export type EventstreamLifecycleEventType = 'StreamCreated' | 'StreamPaused' | 'CursorAdvanced';
export const EVENTSTREAM_LIFECYCLE_EVENT_TYPES: readonly EventstreamLifecycleEventType[] = [
  'StreamCreated',
  'StreamPaused',
  'CursorAdvanced',
];

/**
 * An event-stream lifecycle transition. Ids, a bounded stream key, a status and reason codes ONLY — never an event payload
 * body or personal data.
 */
export interface EventstreamLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly streamKey?: string;
  readonly reasonCode?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type EventstreamLifecycleEvent = DomainEventEnvelope<
  typeof EVENTSTREAM_LIFECYCLE_FAMILY,
  EventstreamLifecycleEventType,
  EventstreamLifecyclePayload
>;
