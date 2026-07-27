import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `legal.lifecycle` event family — owned by m14-legal (Stage 4.1).
 *
 * Registered in manifests/event-registry.yaml alongside this declaration and the module that emits it.
 * Delivered through the SINGLE transactional outbox that m06 owns (ADR-004/023) — m14 owns no outbox.
 * Classification `confidential`. Payloads carry IDENTIFIERS, STATES, DATES, safe AMOUNTS (minor units), REASON
 * CODES and SAFE ANALYTICS DIMENSIONS ONLY — never legal advice, legal strategy, full legal opinions, privileged
 * notes, private party contacts, full pleadings, document contents, confidential settlement terms, counsel
 * bank/payment details, or raw correspondence (ADR-064). A consumer that needs detail reads it back through the
 * legal API under its own permissions. m14 CONSUMES m13's `case.converted_to_matter`; it emits
 * `MatterConvertedFromCase` on this family (litigation/recovery/legaldocs families belong to m16/m17/m18).
 */

export const LEGAL_LIFECYCLE_FAMILY = 'legal.lifecycle';
export const LEGAL_LIFECYCLE_VERSION = 1;

export type LegalLifecycleEventType =
  | 'MatterCreated'
  | 'MatterConvertedFromCase'
  | 'InstructionReceived'
  | 'InstructionAccepted'
  | 'InstructionRejected'
  | 'MatterOpened'
  | 'MatterAssigned'
  | 'MatterReassigned'
  | 'PartyAdded'
  | 'ActivityCreated'
  | 'ActivityCompleted'
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'PleadingRegistered'
  | 'PleadingFiled'
  | 'DocumentLinked'
  | 'CourtEventScheduled'
  | 'CourtEventCompleted'
  | 'DeadlineCreated'
  | 'DeadlineWarning'
  | 'DeadlineBreached'
  | 'IssueCreated'
  | 'OpinionRegistered'
  | 'ExternalCounselInstructed'
  | 'CounselReportReceived'
  | 'SettlementProposed'
  | 'SettlementApproved'
  | 'JudgmentRecorded'
  | 'AppealInitiated'
  | 'EnforcementUpdated'
  | 'SlaBreached'
  | 'MatterEscalated'
  | 'MatterResolved'
  | 'MatterClosed'
  | 'MatterReopened'
  | 'MatterArchived';

export const LEGAL_LIFECYCLE_EVENT_TYPES: readonly LegalLifecycleEventType[] = [
  'MatterCreated',
  'MatterConvertedFromCase',
  'InstructionReceived',
  'InstructionAccepted',
  'InstructionRejected',
  'MatterOpened',
  'MatterAssigned',
  'MatterReassigned',
  'PartyAdded',
  'ActivityCreated',
  'ActivityCompleted',
  'TaskCreated',
  'TaskCompleted',
  'PleadingRegistered',
  'PleadingFiled',
  'DocumentLinked',
  'CourtEventScheduled',
  'CourtEventCompleted',
  'DeadlineCreated',
  'DeadlineWarning',
  'DeadlineBreached',
  'IssueCreated',
  'OpinionRegistered',
  'ExternalCounselInstructed',
  'CounselReportReceived',
  'SettlementProposed',
  'SettlementApproved',
  'JudgmentRecorded',
  'AppealInitiated',
  'EnforcementUpdated',
  'SlaBreached',
  'MatterEscalated',
  'MatterResolved',
  'MatterClosed',
  'MatterReopened',
  'MatterArchived',
];

/** A legal-matter lifecycle / sub-entity transition. Ids, states, dates, safe amounts, reason codes + dims only. */
export interface LegalLifecyclePayload {
  readonly matterId: string;
  readonly matterType?: string;
  readonly source?: string;
  readonly sourceCaseId?: string;
  readonly jurisdiction?: string;
  readonly forum?: string;
  readonly branch?: string;
  readonly department?: string;
  readonly legalRisk?: string;
  readonly priority?: string;
  readonly confidentiality?: string;
  readonly privileged?: boolean;
  readonly amountMinor?: number;
  readonly currency?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly reasonCode?: string;
  readonly dueAt?: string;
  readonly ruleEvaluationId?: string;
}

export type LegalLifecycleEvent = DomainEventEnvelope<
  typeof LEGAL_LIFECYCLE_FAMILY,
  LegalLifecycleEventType,
  LegalLifecyclePayload
>;
