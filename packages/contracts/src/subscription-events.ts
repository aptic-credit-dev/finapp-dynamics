import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The subscription event family — owned by m39-saas (Stage 6F). One family: `subscription.lifecycle`. Registered in
 * manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox that m06 owns
 * (ADR-004) — m39 owns no outbox. These are SUBSCRIPTION lifecycle transitions ONLY (activated/suspended/cancelled/plan
 * changed) — NOT fake finance/payment events. Payloads carry IDENTIFIERS, a plan/version reference, states and REASON CODES
 * ONLY — never a secret, a credential, a full customer payload or personal data (ADR-126).
 */
export const SUBSCRIPTION_LIFECYCLE_FAMILY = 'subscription.lifecycle';
export const SUBSCRIPTION_LIFECYCLE_VERSION = 1;
export type SubscriptionLifecycleEventType =
  'SubscriptionActivated' | 'SubscriptionSuspended' | 'SubscriptionCancelled' | 'SubscriptionPlanChanged';
export const SUBSCRIPTION_LIFECYCLE_EVENT_TYPES: readonly SubscriptionLifecycleEventType[] = [
  'SubscriptionActivated',
  'SubscriptionSuspended',
  'SubscriptionCancelled',
  'SubscriptionPlanChanged',
];

/**
 * A subscription lifecycle transition. Ids, plan/version refs, states and reason codes ONLY — never a secret, a credential, a
 * full customer payload or personal data.
 */
export interface SubscriptionLifecyclePayload {
  readonly subscriptionId: string;
  readonly planId?: string;
  readonly planVersionId?: string;
  readonly fromState?: string;
  readonly toState?: string;
  readonly reasonCode?: string;
}

export type SubscriptionLifecycleEvent = DomainEventEnvelope<
  typeof SUBSCRIPTION_LIFECYCLE_FAMILY,
  SubscriptionLifecycleEventType,
  SubscriptionLifecyclePayload
>;
