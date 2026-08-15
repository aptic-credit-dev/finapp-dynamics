import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The disaster-recovery event family — owned by m40-resilience (Stage 6G). One family: `dr.lifecycle`. Registered in
 * manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox that m06 owns
 * (ADR-004) — m40 owns no outbox. These are DR/BC control transitions ONLY (a restore/failover approved, a DR test completed)
 * — NOT actual infrastructure execution and NOT fake downstream events. Payloads carry a request/plan reference, a state,
 * bounded integer recovery seconds and REASON CODES ONLY — never a secret, a credential or personal data (ADR-127).
 */
export const DR_LIFECYCLE_FAMILY = 'dr.lifecycle';
export const DR_LIFECYCLE_VERSION = 1;
export type DrLifecycleEventType = 'RestoreApproved' | 'DrTestCompleted';
export const DR_LIFECYCLE_EVENT_TYPES: readonly DrLifecycleEventType[] = [
  'RestoreApproved',
  'DrTestCompleted',
];

/**
 * A DR/BC control transition. Request/plan refs, a state, a bounded recovery-seconds value and reason codes ONLY — never a
 * secret, a credential or personal data.
 */
export interface DrLifecyclePayload {
  readonly recordId: string;
  readonly planId?: string;
  readonly kind?: string;
  readonly toState?: string;
  readonly recoverySeconds?: string;
  readonly reasonCode?: string;
}

export type DrLifecycleEvent = DomainEventEnvelope<
  typeof DR_LIFECYCLE_FAMILY,
  DrLifecycleEventType,
  DrLifecyclePayload
>;
