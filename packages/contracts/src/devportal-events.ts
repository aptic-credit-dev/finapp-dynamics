import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The developer-portal event family — owned by m35-devportal (Stage 6D-3). One family: `devportal.lifecycle`. Registered in
 * manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox that m06 owns
 * (ADR-004) — m35 owns no outbox. These are PRODUCT/CREDENTIAL/SUBSCRIPTION/APP lifecycle transitions ONLY (a product
 * published/deprecated, a credential issued/revoked, a subscription activated/suspended, an app suspended). Payloads carry
 * IDENTIFIERS, a bounded KEY/category, a version, status and REASON CODES ONLY — never a secret value or reference content,
 * an API credential, a config value, an external payload, or personal data (ADR-122).
 */
export const DEVPORTAL_LIFECYCLE_FAMILY = 'devportal.lifecycle';
export const DEVPORTAL_LIFECYCLE_VERSION = 1;
export type DevportalLifecycleEventType =
  | 'ProductPublished'
  | 'ProductDeprecated'
  | 'CredentialIssued'
  | 'CredentialRevoked'
  | 'SubscriptionActivated'
  | 'SubscriptionSuspended'
  | 'AppSuspended';
export const DEVPORTAL_LIFECYCLE_EVENT_TYPES: readonly DevportalLifecycleEventType[] = [
  'ProductPublished',
  'ProductDeprecated',
  'CredentialIssued',
  'CredentialRevoked',
  'SubscriptionActivated',
  'SubscriptionSuspended',
  'AppSuspended',
];

/**
 * A developer-portal lifecycle transition. Ids, a bounded key/category, a version, status and reason codes ONLY — never a
 * secret value/reference content, an API credential, a config value, an external payload or personal data.
 */
export interface DevportalLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly productKey?: string;
  readonly category?: string;
  readonly scope?: string;
  readonly version?: number;
  readonly reasonCode?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type DevportalLifecycleEvent = DomainEventEnvelope<
  typeof DEVPORTAL_LIFECYCLE_FAMILY,
  DevportalLifecycleEventType,
  DevportalLifecyclePayload
>;
