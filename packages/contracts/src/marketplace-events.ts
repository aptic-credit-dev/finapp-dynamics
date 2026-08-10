import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The marketplace event family — owned by m34-marketplace (Stage 6D-2). One family: `marketplace.lifecycle`. Registered in
 * manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox that m06
 * owns (ADR-004) — m34 owns no outbox. These are LISTING/INSTALLATION/CONSENT/UPGRADE lifecycle transitions ONLY (a
 * listing published/deprecated, an installation activated/suspended, consent granted/revoked, an upgrade applied).
 * Payloads carry IDENTIFIERS, a bounded KEY/category, an OPAQUE connector reference, a version, status and REASON CODES
 * ONLY — never a connection/install config value, a SECRET value or reference content, an external payload, or personal
 * data (ADR-121).
 */
export const MARKETPLACE_LIFECYCLE_FAMILY = 'marketplace.lifecycle';
export const MARKETPLACE_LIFECYCLE_VERSION = 1;
export type MarketplaceLifecycleEventType =
  | 'ListingPublished'
  | 'ListingDeprecated'
  | 'InstallationActivated'
  | 'InstallationSuspended'
  | 'ConsentGranted'
  | 'ConsentRevoked'
  | 'UpgradeApplied';
export const MARKETPLACE_LIFECYCLE_EVENT_TYPES: readonly MarketplaceLifecycleEventType[] = [
  'ListingPublished',
  'ListingDeprecated',
  'InstallationActivated',
  'InstallationSuspended',
  'ConsentGranted',
  'ConsentRevoked',
  'UpgradeApplied',
];

/**
 * A marketplace lifecycle transition. Ids, a bounded key/category, an OPAQUE connector reference, a version, status and
 * reason codes ONLY — never a config value, a secret value/reference content, an external payload or personal data.
 */
export interface MarketplaceLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly listingKey?: string;
  readonly connectorRef?: string;
  readonly category?: string;
  readonly scope?: string;
  readonly version?: number;
  readonly reasonCode?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type MarketplaceLifecycleEvent = DomainEventEnvelope<
  typeof MARKETPLACE_LIFECYCLE_FAMILY,
  MarketplaceLifecycleEventType,
  MarketplaceLifecyclePayload
>;
