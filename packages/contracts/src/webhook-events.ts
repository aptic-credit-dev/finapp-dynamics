import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The webhook event family — owned by m36-events (Stage 6D-4). One family: `webhook.lifecycle`. Registered in
 * manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox that m06 owns
 * (ADR-004) — m36 owns no outbox. These are ENDPOINT + DELIVERY lifecycle transitions ONLY (an endpoint approved/suspended,
 * a delivery succeeded/failed). Payloads carry IDENTIFIERS, an event family/type, a status and REASON CODES ONLY — never a
 * signing secret, an event payload body, an endpoint credential or personal data (ADR-123).
 */
export const WEBHOOK_LIFECYCLE_FAMILY = 'webhook.lifecycle';
export const WEBHOOK_LIFECYCLE_VERSION = 1;
export type WebhookLifecycleEventType =
  'EndpointApproved' | 'EndpointSuspended' | 'DeliverySucceeded' | 'DeliveryFailed';
export const WEBHOOK_LIFECYCLE_EVENT_TYPES: readonly WebhookLifecycleEventType[] = [
  'EndpointApproved',
  'EndpointSuspended',
  'DeliverySucceeded',
  'DeliveryFailed',
];

/**
 * A webhook lifecycle transition. Ids, an event family/type, a status and reason codes ONLY — never a signing secret, an
 * event payload body, an endpoint credential or personal data.
 */
export interface WebhookLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly eventFamily?: string;
  readonly eventType?: string;
  readonly reasonCode?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type WebhookLifecycleEvent = DomainEventEnvelope<
  typeof WEBHOOK_LIFECYCLE_FAMILY,
  WebhookLifecycleEventType,
  WebhookLifecyclePayload
>;
