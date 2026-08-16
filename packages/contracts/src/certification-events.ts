import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The certification event families — owned by m42-certification (Stage 6I). FIVE families:
 * `certification.programme_lifecycle` · `certification.migration_lifecycle` · `certification.uat_lifecycle` ·
 * `certification.pilot_lifecycle` · `certification.release_lifecycle`. Registered in manifests/event-registry.yaml. Delivered
 * through the SINGLE transactional outbox that m06 owns (ADR-004) — m42 owns no outbox. Payloads carry IDENTIFIERS, states,
 * domain/aspect keys, a verdict and REASON CODES + OPAQUE evidence references ONLY — NEVER a secret, a credential, a full log or
 * a raw report/evidence body. A single shared payload shape keeps the five families consistent.
 */
export interface CertificationLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly domainKey?: string;
  readonly aspectKey?: string;
  readonly decision?: string;
  readonly reasonCode?: string;
}

export const CERTIFICATION_PROGRAMME_LIFECYCLE_FAMILY = 'certification.programme_lifecycle';
export const CERTIFICATION_PROGRAMME_LIFECYCLE_VERSION = 1;
export type CertificationProgrammeLifecycleEventType =
  | 'ProgrammeOpened'
  | 'AssessmentRecorded'
  | 'FindingRaised'
  | 'WaiverApproved'
  | 'DecisionIssued'
  | 'ClosureIssued';
export const CERTIFICATION_PROGRAMME_LIFECYCLE_EVENT_TYPES: readonly CertificationProgrammeLifecycleEventType[] =
  [
    'ProgrammeOpened',
    'AssessmentRecorded',
    'FindingRaised',
    'WaiverApproved',
    'DecisionIssued',
    'ClosureIssued',
  ];
export type CertificationProgrammeLifecycleEvent = DomainEventEnvelope<
  typeof CERTIFICATION_PROGRAMME_LIFECYCLE_FAMILY,
  CertificationProgrammeLifecycleEventType,
  CertificationLifecyclePayload
>;

export const CERTIFICATION_MIGRATION_LIFECYCLE_FAMILY = 'certification.migration_lifecycle';
export const CERTIFICATION_MIGRATION_LIFECYCLE_VERSION = 1;
export type CertificationMigrationLifecycleEventType = 'MigrationEvidenceRecorded';
export const CERTIFICATION_MIGRATION_LIFECYCLE_EVENT_TYPES: readonly CertificationMigrationLifecycleEventType[] =
  ['MigrationEvidenceRecorded'];
export type CertificationMigrationLifecycleEvent = DomainEventEnvelope<
  typeof CERTIFICATION_MIGRATION_LIFECYCLE_FAMILY,
  CertificationMigrationLifecycleEventType,
  CertificationLifecyclePayload
>;

export const CERTIFICATION_UAT_LIFECYCLE_FAMILY = 'certification.uat_lifecycle';
export const CERTIFICATION_UAT_LIFECYCLE_VERSION = 1;
export type CertificationUatLifecycleEventType = 'UatRecorded';
export const CERTIFICATION_UAT_LIFECYCLE_EVENT_TYPES: readonly CertificationUatLifecycleEventType[] = [
  'UatRecorded',
];
export type CertificationUatLifecycleEvent = DomainEventEnvelope<
  typeof CERTIFICATION_UAT_LIFECYCLE_FAMILY,
  CertificationUatLifecycleEventType,
  CertificationLifecyclePayload
>;

export const CERTIFICATION_PILOT_LIFECYCLE_FAMILY = 'certification.pilot_lifecycle';
export const CERTIFICATION_PILOT_LIFECYCLE_VERSION = 1;
export type CertificationPilotLifecycleEventType = 'PilotRecorded';
export const CERTIFICATION_PILOT_LIFECYCLE_EVENT_TYPES: readonly CertificationPilotLifecycleEventType[] = [
  'PilotRecorded',
];
export type CertificationPilotLifecycleEvent = DomainEventEnvelope<
  typeof CERTIFICATION_PILOT_LIFECYCLE_FAMILY,
  CertificationPilotLifecycleEventType,
  CertificationLifecyclePayload
>;

export const CERTIFICATION_RELEASE_LIFECYCLE_FAMILY = 'certification.release_lifecycle';
export const CERTIFICATION_RELEASE_LIFECYCLE_VERSION = 1;
export type CertificationReleaseLifecycleEventType = 'ReleaseReadinessRecorded';
export const CERTIFICATION_RELEASE_LIFECYCLE_EVENT_TYPES: readonly CertificationReleaseLifecycleEventType[] =
  ['ReleaseReadinessRecorded'];
export type CertificationReleaseLifecycleEvent = DomainEventEnvelope<
  typeof CERTIFICATION_RELEASE_LIFECYCLE_FAMILY,
  CertificationReleaseLifecycleEventType,
  CertificationLifecyclePayload
>;
