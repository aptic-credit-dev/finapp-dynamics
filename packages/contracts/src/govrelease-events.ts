import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The integration-governance/release event family — owned by m37-govrelease (Stage 6D-5). One family: `govrelease.lifecycle`.
 * Registered in manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox
 * that m06 owns (ADR-004) — m37 owns no outbox. These are ARTIFACT + RELEASE lifecycle transitions ONLY (a release requested,
 * QA passed, released, rolled back; an artifact retired). Payloads carry IDENTIFIERS, a release key, a version, a status and
 * REASON CODES ONLY — never a signature value/reference content, a QA report body or personal data (ADR-124).
 */
export const GOVRELEASE_LIFECYCLE_FAMILY = 'govrelease.lifecycle';
export const GOVRELEASE_LIFECYCLE_VERSION = 1;
export type GovreleaseLifecycleEventType =
  | 'ReleaseRequested'
  | 'QaPassed'
  | 'ReleaseReleased'
  | 'ReleaseRejected'
  | 'ReleaseRolledBack'
  | 'ArtifactRetired';
export const GOVRELEASE_LIFECYCLE_EVENT_TYPES: readonly GovreleaseLifecycleEventType[] = [
  'ReleaseRequested',
  'QaPassed',
  'ReleaseReleased',
  'ReleaseRejected',
  'ReleaseRolledBack',
  'ArtifactRetired',
];

/**
 * A governance/release lifecycle transition. Ids, a release key, a version, a status and reason codes ONLY — never a
 * signature value/reference content, a QA report body or personal data.
 */
export interface GovreleaseLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly releaseKey?: string;
  readonly version?: number;
  readonly reasonCode?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type GovreleaseLifecycleEvent = DomainEventEnvelope<
  typeof GOVRELEASE_LIFECYCLE_FAMILY,
  GovreleaseLifecycleEventType,
  GovreleaseLifecyclePayload
>;
