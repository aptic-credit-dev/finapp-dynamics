import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The M13 case-management event families — owned by m13-case (Stage 3.2).
 *
 * Two families, both registered in manifests/event-registry.yaml alongside this declaration and the module that
 * emits them, and both delivered through the SINGLE transactional outbox that m06 owns (ADR-004/023) — m13 owns
 * no outbox. Classification `confidential`. Payloads carry IDENTIFIERS, STATES, DATES, SAFE REASON CODES and SAFE
 * ANALYTICS DIMENSIONS ONLY — never privileged note contents, private party contacts, correspondence bodies,
 * full allegations, legal advice, document contents, confidential settlement terms, or notification destinations
 * (ADR-060). A consumer that needs detail reads it back through the cases API under its own permissions.
 *
 *  - `case.lifecycle`          — the case's own lifecycle + its structured sub-entities (m13-internal consumers).
 *  - `case.converted_to_matter` — the controlled boundary to m14 legal matters (m13 emits, m14 consumes).
 */

export const CASE_LIFECYCLE_FAMILY = 'case.lifecycle';
export const CASE_LIFECYCLE_VERSION = 1;

export type CaseLifecycleEventType =
  | 'CaseCreated'
  | 'CaseOpened'
  | 'CaseHandoffAccepted'
  | 'CaseTriaged'
  | 'CaseAssigned'
  | 'CaseReassigned'
  | 'PartyAdded'
  | 'ActivityCreated'
  | 'ActivityCompleted'
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'DocumentLinked'
  | 'EvidenceRegistered'
  | 'IssueCreated'
  | 'InvestigationStarted'
  | 'InvestigationCompleted'
  | 'FindingRecorded'
  | 'DecisionSubmitted'
  | 'DecisionApproved'
  | 'DeadlineCreated'
  | 'DeadlineWarning'
  | 'DeadlineBreached'
  | 'HearingScheduled'
  | 'HearingCompleted'
  | 'SettlementProposed'
  | 'SettlementApproved'
  | 'SlaBreached'
  | 'CaseEscalated'
  | 'CaseResolved'
  | 'CaseClosed'
  | 'CaseReopened'
  | 'CaseArchived';

export const CASE_LIFECYCLE_EVENT_TYPES: readonly CaseLifecycleEventType[] = [
  'CaseCreated',
  'CaseOpened',
  'CaseHandoffAccepted',
  'CaseTriaged',
  'CaseAssigned',
  'CaseReassigned',
  'PartyAdded',
  'ActivityCreated',
  'ActivityCompleted',
  'TaskCreated',
  'TaskCompleted',
  'DocumentLinked',
  'EvidenceRegistered',
  'IssueCreated',
  'InvestigationStarted',
  'InvestigationCompleted',
  'FindingRecorded',
  'DecisionSubmitted',
  'DecisionApproved',
  'DeadlineCreated',
  'DeadlineWarning',
  'DeadlineBreached',
  'HearingScheduled',
  'HearingCompleted',
  'SettlementProposed',
  'SettlementApproved',
  'SlaBreached',
  'CaseEscalated',
  'CaseResolved',
  'CaseClosed',
  'CaseReopened',
  'CaseArchived',
];

/** A case lifecycle / sub-entity transition. Identifiers, states, dates, reason codes + safe dimensions only. */
export interface CaseLifecyclePayload {
  readonly caseId: string;
  readonly caseType?: string;
  readonly caseSubtype?: string;
  readonly source?: string;
  readonly originatingFeedbackId?: string;
  readonly branch?: string;
  readonly department?: string;
  readonly severity?: string;
  readonly priority?: string;
  readonly confidentiality?: string;
  readonly legalStatus?: string;
  readonly recoveryState?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly reasonCode?: string;
  readonly dueAt?: string;
  readonly ruleEvaluationId?: string;
}

export type CaseLifecycleEvent = DomainEventEnvelope<
  typeof CASE_LIFECYCLE_FAMILY,
  CaseLifecycleEventType,
  CaseLifecyclePayload
>;

// --- the controlled boundary to m14 legal matters ---------------------------------------------

export const CASE_CONVERTED_TO_MATTER_FAMILY = 'case.converted_to_matter';
export const CASE_CONVERTED_TO_MATTER_VERSION = 1;

export type CaseConvertedToMatterEventType = 'CaseConvertedToMatter';

export const CASE_CONVERTED_TO_MATTER_EVENT_TYPES: readonly CaseConvertedToMatterEventType[] = [
  'CaseConvertedToMatter',
];

/** A case being promoted to an m14 legal matter. Identifiers + safe legal dimensions only. */
export interface CaseConvertedToMatterPayload {
  readonly caseId: string;
  readonly caseType?: string;
  readonly recommendedMatterType?: string;
  readonly legalStatus?: string;
  readonly courtReference?: string;
  readonly reasonCode?: string;
}

export type CaseConvertedToMatterEvent = DomainEventEnvelope<
  typeof CASE_CONVERTED_TO_MATTER_FAMILY,
  CaseConvertedToMatterEventType,
  CaseConvertedToMatterPayload
>;

export type CaseEventPayload = CaseLifecyclePayload | CaseConvertedToMatterPayload;
