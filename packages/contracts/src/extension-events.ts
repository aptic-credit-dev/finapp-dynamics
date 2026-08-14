import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The extension event family — owned by m38-automation (Stage 6E). One family: `extension.lifecycle`. Registered in
 * manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox that m06 owns
 * (ADR-004) — m38 owns no outbox. These are EXTENSION + INSTALLATION lifecycle transitions ONLY (an extension published/
 * deprecated, an installation enabled/disabled). Payloads carry IDENTIFIERS, a trust tier, a status and REASON CODES ONLY —
 * never a secret, executable content or personal data (ADR-125).
 */
export const EXTENSION_LIFECYCLE_FAMILY = 'extension.lifecycle';
export const EXTENSION_LIFECYCLE_VERSION = 1;
export type ExtensionLifecycleEventType =
  'ExtensionPublished' | 'ExtensionDeprecated' | 'ExtensionInstalled' | 'ExtensionDisabled';
export const EXTENSION_LIFECYCLE_EVENT_TYPES: readonly ExtensionLifecycleEventType[] = [
  'ExtensionPublished',
  'ExtensionDeprecated',
  'ExtensionInstalled',
  'ExtensionDisabled',
];

/**
 * An extension lifecycle transition. Ids, a trust tier, a status and reason codes ONLY — never a secret, executable content
 * or personal data.
 */
export interface ExtensionLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly trustTier?: string;
  readonly reasonCode?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type ExtensionLifecycleEvent = DomainEventEnvelope<
  typeof EXTENSION_LIFECYCLE_FAMILY,
  ExtensionLifecycleEventType,
  ExtensionLifecyclePayload
>;
