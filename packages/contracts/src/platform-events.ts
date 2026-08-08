import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The platform event family — owned by m30-platform (Stage 6A). One family: `platform.lifecycle`. Registered in
 * manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox that m06
 * owns (ADR-004) — m30 owns no outbox. Payloads carry IDENTIFIERS, KEYS, SCOPES, STATES, REASON CODES and BOUNDED
 * metadata ONLY — never configuration values, secret values, secret references' resolved content, or personal data.
 * `scope` distinguishes a platform (control-plane) change from a tenant change.
 */
export const PLATFORM_LIFECYCLE_FAMILY = 'platform.lifecycle';
export const PLATFORM_LIFECYCLE_VERSION = 1;
export type PlatformLifecycleEventType =
  | 'MetadataUpdated'
  | 'ConfigDefined'
  | 'ConfigPublished'
  | 'FeatureDefined'
  | 'FeatureAssigned'
  | 'SecretReferenceRegistered'
  | 'SecretReferenceRotated'
  | 'SecretReferenceRevoked';
export const PLATFORM_LIFECYCLE_EVENT_TYPES: readonly PlatformLifecycleEventType[] = [
  'MetadataUpdated',
  'ConfigDefined',
  'ConfigPublished',
  'FeatureDefined',
  'FeatureAssigned',
  'SecretReferenceRegistered',
  'SecretReferenceRotated',
  'SecretReferenceRevoked',
];

/**
 * A platform-foundation lifecycle transition. Ids, a bounded key, scope, states and reason codes ONLY — never a
 * configuration value, a secret value or a resolved secret reference.
 */
export interface PlatformLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly key?: string;
  readonly scope?: string;
  readonly category?: string;
  readonly valueType?: string;
  readonly enabled?: boolean;
  readonly isAbsolute?: boolean;
  readonly secretBearing?: boolean;
  readonly reasonCode?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type PlatformLifecycleEvent = DomainEventEnvelope<
  typeof PLATFORM_LIFECYCLE_FAMILY,
  PlatformLifecycleEventType,
  PlatformLifecyclePayload
>;
