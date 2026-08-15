import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The mobile event family — owned by m40-resilience (Stage 6G). One family: `mobile.lifecycle`. Registered in
 * manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox that m06 owns
 * (ADR-004) — m40 owns no outbox. These are MOBILE-DEVICE + OFFLINE-SYNC lifecycle transitions ONLY (a device registered/
 * revoked, an offline sync applied/rejected) — NOT fake downstream business events. Payloads carry IDENTIFIERS, a state and
 * REASON CODES ONLY — never a secret, a token, a full offline business payload or personal data (ADR-127).
 */
export const MOBILE_LIFECYCLE_FAMILY = 'mobile.lifecycle';
export const MOBILE_LIFECYCLE_VERSION = 1;
export type MobileLifecycleEventType =
  'DeviceRegistered' | 'DeviceRevoked' | 'OfflineSyncApplied' | 'OfflineSyncRejected';
export const MOBILE_LIFECYCLE_EVENT_TYPES: readonly MobileLifecycleEventType[] = [
  'DeviceRegistered',
  'DeviceRevoked',
  'OfflineSyncApplied',
  'OfflineSyncRejected',
];

/**
 * A mobile/offline lifecycle transition. Ids, a state and reason codes ONLY — never a secret, a token, a full offline payload
 * or personal data.
 */
export interface MobileLifecyclePayload {
  readonly recordId: string;
  readonly deviceId?: string;
  readonly downstreamRef?: string;
  readonly toState?: string;
  readonly reasonCode?: string;
}

export type MobileLifecycleEvent = DomainEventEnvelope<
  typeof MOBILE_LIFECYCLE_FAMILY,
  MobileLifecycleEventType,
  MobileLifecyclePayload
>;
