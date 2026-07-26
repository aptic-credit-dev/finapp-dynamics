import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `notification.lifecycle` event family — owned by m08-notify (Stage 2.4).
 *
 * Registered in manifests/event-registry.yaml alongside this declaration and the module that emits it.
 * Delivered through the SINGLE transactional outbox that m06 owns (ADR-004/023) — m08 owns no outbox.
 * Classification `confidential`. Payloads carry IDENTIFIERS, CHANNEL, STATUS and REASON CODES ONLY — never
 * raw recipient destinations, rendered message bodies, provider credentials, or template variable values
 * (a notification may concern regulated/personal data). A consumer that needs detail reads it back through
 * the notifications API under its own permissions (ADR-039/041).
 */

export const NOTIFICATION_LIFECYCLE_FAMILY = 'notification.lifecycle';
export const NOTIFICATION_LIFECYCLE_VERSION = 1;

export type NotificationLifecycleEventType =
  | 'TemplateCreated'
  | 'TemplatePublished'
  | 'TemplateActivated'
  | 'TemplateRetired'
  | 'NotificationRequested'
  | 'NotificationQueued'
  | 'NotificationDelivered'
  | 'NotificationFailed'
  | 'NotificationRetryScheduled'
  | 'NotificationExhausted'
  | 'NotificationCancelled'
  | 'NotificationExpired'
  | 'NotificationSuppressed'
  | 'EscalationCreated'
  | 'EscalationActivated'
  | 'EscalationAdvanced'
  | 'EscalationAcknowledged'
  | 'EscalationResolved'
  | 'EscalationCancelled'
  | 'InboxNotificationCreated'
  | 'InboxNotificationRead';

export const NOTIFICATION_LIFECYCLE_EVENT_TYPES: readonly NotificationLifecycleEventType[] = [
  'TemplateCreated',
  'TemplatePublished',
  'TemplateActivated',
  'TemplateRetired',
  'NotificationRequested',
  'NotificationQueued',
  'NotificationDelivered',
  'NotificationFailed',
  'NotificationRetryScheduled',
  'NotificationExhausted',
  'NotificationCancelled',
  'NotificationExpired',
  'NotificationSuppressed',
  'EscalationCreated',
  'EscalationActivated',
  'EscalationAdvanced',
  'EscalationAcknowledged',
  'EscalationResolved',
  'EscalationCancelled',
  'InboxNotificationCreated',
  'InboxNotificationRead',
];

/** A notification-template / version lifecycle transition. Identifiers only. */
export interface NotificationTemplateLifecyclePayload {
  readonly templateId: string;
  readonly versionId?: string;
  readonly versionNumber?: number;
  readonly code: string;
  readonly channel?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly reason?: string;
}

/**
 * A notification-request lifecycle transition. Carries the request id, channel and status — never the raw
 * destination, rendered body, or variable values (ADR-041). `id` is the aggregate id the outbox keys on.
 */
export interface NotificationRequestPayload {
  readonly id: string;
  readonly channel: string;
  readonly status: string;
  readonly attempt?: number;
  readonly originModule?: string;
  readonly originEntityType?: string;
  readonly originEntityId?: string;
  readonly reasonCode?: string;
}

/** An escalation lifecycle transition. Identifiers, level and status only. */
export interface EscalationPayload {
  readonly id: string;
  readonly policyId?: string;
  readonly level?: number;
  readonly status: string;
  readonly originModule?: string;
  readonly originEntityType?: string;
  readonly originEntityId?: string;
  readonly reason?: string;
}

/** An in-app inbox notification lifecycle event. Identifiers + severity only, never the body. */
export interface InboxNotificationPayload {
  readonly id: string;
  readonly recipientId: string;
  readonly severity: string;
  readonly status: string;
}

export type NotificationLifecyclePayload =
  | NotificationTemplateLifecyclePayload
  | NotificationRequestPayload
  | EscalationPayload
  | InboxNotificationPayload;

export type NotificationLifecycleEvent = DomainEventEnvelope<
  typeof NOTIFICATION_LIFECYCLE_FAMILY,
  NotificationLifecycleEventType,
  NotificationLifecyclePayload
>;
