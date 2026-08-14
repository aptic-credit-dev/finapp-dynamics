import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The automation event family — owned by m38-automation (Stage 6E). One family: `automation.lifecycle`. Registered in
 * manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox that m06 owns
 * (ADR-004) — m38 owns no outbox. These are AUTOMATION + RUN lifecycle transitions ONLY (an automation activated/suspended, a
 * run succeeded/failed) — NOT fake downstream domain events. Payloads carry IDENTIFIERS, a status and REASON CODES ONLY —
 * never a secret, executable content, a full downstream payload or personal data (ADR-125).
 */
export const AUTOMATION_LIFECYCLE_FAMILY = 'automation.lifecycle';
export const AUTOMATION_LIFECYCLE_VERSION = 1;
export type AutomationLifecycleEventType =
  'AutomationActivated' | 'AutomationSuspended' | 'RunSucceeded' | 'RunFailed';
export const AUTOMATION_LIFECYCLE_EVENT_TYPES: readonly AutomationLifecycleEventType[] = [
  'AutomationActivated',
  'AutomationSuspended',
  'RunSucceeded',
  'RunFailed',
];

/**
 * An automation lifecycle transition. Ids, a status and reason codes ONLY — never a secret, executable content, a full
 * downstream payload or personal data.
 */
export interface AutomationLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly reasonCode?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type AutomationLifecycleEvent = DomainEventEnvelope<
  typeof AUTOMATION_LIFECYCLE_FAMILY,
  AutomationLifecycleEventType,
  AutomationLifecyclePayload
>;
