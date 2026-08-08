import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The studio event family — owned by m31-studio (Stage 6B). One family: `studio.lifecycle`. Registered in
 * manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox that m06
 * owns (ADR-004) — m31 owns no outbox. These are DESIGN-TIME transitions ONLY (an artifact created, a version
 * validated, a review requested, an artifact published/superseded/archived) — NEVER a runtime workflow/rule execution
 * event (those stay m06/m07). Payloads carry IDENTIFIERS, a bounded KEY, the artifact KIND, SCOPE, STATES and REASON
 * CODES ONLY — never a design spec, a form definition/field, a configuration/secret value or personal data (ADR-118).
 */
export const STUDIO_LIFECYCLE_FAMILY = 'studio.lifecycle';
export const STUDIO_LIFECYCLE_VERSION = 1;
export type StudioLifecycleEventType =
  | 'ArtifactCreated'
  | 'VersionValidated'
  | 'ReviewRequested'
  | 'ArtifactPublished'
  | 'ArtifactSuperseded'
  | 'ArtifactArchived';
export const STUDIO_LIFECYCLE_EVENT_TYPES: readonly StudioLifecycleEventType[] = [
  'ArtifactCreated',
  'VersionValidated',
  'ReviewRequested',
  'ArtifactPublished',
  'ArtifactSuperseded',
  'ArtifactArchived',
];

/**
 * A design-time Studio lifecycle transition. Ids, a bounded key/kind, scope, version number, target engine, states and
 * reason codes ONLY — never a design spec, a form field, a configuration value, a secret value or a resolved reference.
 */
export interface StudioLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly projectId?: string;
  readonly artifactKind?: string;
  readonly artifactKey?: string;
  readonly versionNo?: number;
  readonly targetEngine?: string;
  readonly reasonCode?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type StudioLifecycleEvent = DomainEventEnvelope<
  typeof STUDIO_LIFECYCLE_FAMILY,
  StudioLifecycleEventType,
  StudioLifecyclePayload
>;
