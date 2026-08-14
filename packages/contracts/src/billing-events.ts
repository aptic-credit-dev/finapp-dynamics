import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The billing event family — owned by m39-saas (Stage 6F). One family: `billing.lifecycle`. Registered in
 * manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox that m06 owns
 * (ADR-004) — m39 owns no outbox. These are commercial BILLING-CYCLE METADATA transitions ONLY (a cycle opened/closed) — NOT
 * fake accounting/payment transactions; m39 posts no journal and creates no payment. Payloads carry a subscription/cycle
 * reference, a status, a bounded amount/currency and REASON CODES ONLY — never a secret, a credential or personal data
 * (ADR-126).
 */
export const BILLING_LIFECYCLE_FAMILY = 'billing.lifecycle';
export const BILLING_LIFECYCLE_VERSION = 1;
export type BillingLifecycleEventType = 'BillingCycleOpened' | 'BillingCycleClosed';
export const BILLING_LIFECYCLE_EVENT_TYPES: readonly BillingLifecycleEventType[] = [
  'BillingCycleOpened',
  'BillingCycleClosed',
];

/**
 * A billing-cycle metadata transition. Subscription/cycle refs, a status, a bounded amount (minor units, as text) + currency
 * and reason codes ONLY — never a secret, a credential, a real payment/accounting entry or personal data.
 */
export interface BillingLifecyclePayload {
  readonly billingCycleId: string;
  readonly subscriptionId?: string;
  readonly status?: string;
  readonly amountMinor?: string;
  readonly currency?: string;
  readonly reasonCode?: string;
}

export type BillingLifecycleEvent = DomainEventEnvelope<
  typeof BILLING_LIFECYCLE_FAMILY,
  BillingLifecycleEventType,
  BillingLifecyclePayload
>;
