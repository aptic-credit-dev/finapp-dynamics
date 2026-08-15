import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The security event families — owned by m41-security (Stage 6H). SEVEN families:
 * `security.identity_lifecycle` · `security.privileged_lifecycle` · `security.dlp_lifecycle` · `security.crypto_lifecycle` ·
 * `security.grc_lifecycle` · `security.privacy_lifecycle` · `security.soc_lifecycle`. Registered in
 * manifests/event-registry.yaml. Delivered through the SINGLE transactional outbox that m06 owns (ADR-004) — m41 owns no
 * outbox. Payloads carry IDENTIFIERS, states, classifications, an approved-algorithm id and REASON CODES ONLY — NEVER a secret
 * value, ciphertext, a token, a credential or raw restricted content (ADR-128). A single shared payload shape keeps the seven
 * families consistent; each event names the safe fields it uses.
 */
export interface SecurityLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly fromState?: string;
  readonly toState?: string;
  readonly classification?: string;
  readonly algorithm?: string;
  readonly reasonCode?: string;
}

export const SECURITY_IDENTITY_LIFECYCLE_FAMILY = 'security.identity_lifecycle';
export const SECURITY_IDENTITY_LIFECYCLE_VERSION = 1;
export type SecurityIdentityLifecycleEventType = 'SecurityPostureDenied';
export const SECURITY_IDENTITY_LIFECYCLE_EVENT_TYPES: readonly SecurityIdentityLifecycleEventType[] = [
  'SecurityPostureDenied',
];
export type SecurityIdentityLifecycleEvent = DomainEventEnvelope<
  typeof SECURITY_IDENTITY_LIFECYCLE_FAMILY,
  SecurityIdentityLifecycleEventType,
  SecurityLifecyclePayload
>;

export const SECURITY_PRIVILEGED_LIFECYCLE_FAMILY = 'security.privileged_lifecycle';
export const SECURITY_PRIVILEGED_LIFECYCLE_VERSION = 1;
export type SecurityPrivilegedLifecycleEventType = 'RevealRequested' | 'RevealGranted';
export const SECURITY_PRIVILEGED_LIFECYCLE_EVENT_TYPES: readonly SecurityPrivilegedLifecycleEventType[] = [
  'RevealRequested',
  'RevealGranted',
];
export type SecurityPrivilegedLifecycleEvent = DomainEventEnvelope<
  typeof SECURITY_PRIVILEGED_LIFECYCLE_FAMILY,
  SecurityPrivilegedLifecycleEventType,
  SecurityLifecyclePayload
>;

export const SECURITY_DLP_LIFECYCLE_FAMILY = 'security.dlp_lifecycle';
export const SECURITY_DLP_LIFECYCLE_VERSION = 1;
export type SecurityDlpLifecycleEventType = 'DlpBlocked' | 'DlpCleared';
export const SECURITY_DLP_LIFECYCLE_EVENT_TYPES: readonly SecurityDlpLifecycleEventType[] = [
  'DlpBlocked',
  'DlpCleared',
];
export type SecurityDlpLifecycleEvent = DomainEventEnvelope<
  typeof SECURITY_DLP_LIFECYCLE_FAMILY,
  SecurityDlpLifecycleEventType,
  SecurityLifecyclePayload
>;

export const SECURITY_CRYPTO_LIFECYCLE_FAMILY = 'security.crypto_lifecycle';
export const SECURITY_CRYPTO_LIFECYCLE_VERSION = 1;
export type SecurityCryptoLifecycleEventType =
  'SecretActivated' | 'SecretRotated' | 'SecretRevoked' | 'SecretDestroyed';
export const SECURITY_CRYPTO_LIFECYCLE_EVENT_TYPES: readonly SecurityCryptoLifecycleEventType[] = [
  'SecretActivated',
  'SecretRotated',
  'SecretRevoked',
  'SecretDestroyed',
];
export type SecurityCryptoLifecycleEvent = DomainEventEnvelope<
  typeof SECURITY_CRYPTO_LIFECYCLE_FAMILY,
  SecurityCryptoLifecycleEventType,
  SecurityLifecyclePayload
>;

export const SECURITY_GRC_LIFECYCLE_FAMILY = 'security.grc_lifecycle';
export const SECURITY_GRC_LIFECYCLE_VERSION = 1;
export type SecurityGrcLifecycleEventType = 'ControlAssessed' | 'ControlRetired';
export const SECURITY_GRC_LIFECYCLE_EVENT_TYPES: readonly SecurityGrcLifecycleEventType[] = [
  'ControlAssessed',
  'ControlRetired',
];
export type SecurityGrcLifecycleEvent = DomainEventEnvelope<
  typeof SECURITY_GRC_LIFECYCLE_FAMILY,
  SecurityGrcLifecycleEventType,
  SecurityLifecyclePayload
>;

export const SECURITY_PRIVACY_LIFECYCLE_FAMILY = 'security.privacy_lifecycle';
export const SECURITY_PRIVACY_LIFECYCLE_VERSION = 1;
export type SecurityPrivacyLifecycleEventType = 'PrivacyRecordAdded' | 'ClassificationSet';
export const SECURITY_PRIVACY_LIFECYCLE_EVENT_TYPES: readonly SecurityPrivacyLifecycleEventType[] = [
  'PrivacyRecordAdded',
  'ClassificationSet',
];
export type SecurityPrivacyLifecycleEvent = DomainEventEnvelope<
  typeof SECURITY_PRIVACY_LIFECYCLE_FAMILY,
  SecurityPrivacyLifecycleEventType,
  SecurityLifecyclePayload
>;

export const SECURITY_SOC_LIFECYCLE_FAMILY = 'security.soc_lifecycle';
export const SECURITY_SOC_LIFECYCLE_VERSION = 1;
export type SecuritySocLifecycleEventType = 'IncidentRecorded';
export const SECURITY_SOC_LIFECYCLE_EVENT_TYPES: readonly SecuritySocLifecycleEventType[] = [
  'IncidentRecorded',
];
export type SecuritySocLifecycleEvent = DomainEventEnvelope<
  typeof SECURITY_SOC_LIFECYCLE_FAMILY,
  SecuritySocLifecycleEventType,
  SecurityLifecyclePayload
>;
