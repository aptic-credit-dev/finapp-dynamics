import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The usage event family — owned by m39-saas (Stage 6F). One family: `usage.lifecycle`. Registered in
 * manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox that m06 owns
 * (ADR-004) — m39 owns no outbox. These are commercial USAGE/QUOTA evidence transitions ONLY (usage recorded, a quota
 * threshold reached) — NOT arbitrary analytics or fake finance events. Payloads carry a meter/capability reference, a bounded
 * QUANTITY, a period key and REASON CODES ONLY — never a raw payload, a credential, a secret or personal data (ADR-126).
 */
export const USAGE_LIFECYCLE_FAMILY = 'usage.lifecycle';
export const USAGE_LIFECYCLE_VERSION = 1;
export type UsageLifecycleEventType = 'UsageRecorded' | 'QuotaThresholdReached';
export const USAGE_LIFECYCLE_EVENT_TYPES: readonly UsageLifecycleEventType[] = [
  'UsageRecorded',
  'QuotaThresholdReached',
];

/**
 * A usage/quota evidence transition. Meter/capability refs, a bounded quantity, a period key and reason codes ONLY — never a
 * raw application payload, a credential, a secret or personal data.
 */
export interface UsageLifecyclePayload {
  readonly capabilityKey: string;
  readonly meterKey: string;
  readonly quantity?: string;
  readonly periodKey?: string;
  readonly reasonCode?: string;
}

export type UsageLifecycleEvent = DomainEventEnvelope<
  typeof USAGE_LIFECYCLE_FAMILY,
  UsageLifecycleEventType,
  UsageLifecyclePayload
>;
