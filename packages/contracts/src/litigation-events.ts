import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `litigation.lifecycle` event family — owned by m16-litigation (Stage 4.2).
 *
 * Registered in manifests/event-registry.yaml alongside this declaration and the module that emits it.
 * Delivered through the SINGLE transactional outbox that m06 owns (ADR-004/023) — m16 owns no outbox.
 * Classification `confidential`. Payloads carry IDENTIFIERS, STATES, DATES, safe AMOUNTS (minor units), REASON
 * CODES and SAFE ANALYTICS DIMENSIONS ONLY — never legal strategy, full pleadings, witness statements, full
 * submissions, private witness/party contacts, full orders, document contents, or confidential outcome terms
 * (ADR-068). A consumer that needs detail reads it back through the litigation API under its own permissions.
 * M16 CONSUMES an M14 matter referral through a governed inbound contract and emits `ProceedingReferredFromMatter`
 * on this family; it emits `EnforcementReferralReady` (for m17) and `KnowledgeCandidateCreated` (for m18) as safe
 * downstream boundary signals — it owns none of those modules' families.
 */

export const LITIGATION_LIFECYCLE_FAMILY = 'litigation.lifecycle';
export const LITIGATION_LIFECYCLE_VERSION = 1;

export type LitigationLifecycleEventType =
  | 'ProceedingCreated'
  | 'ProceedingReferredFromMatter'
  | 'ProceedingAssigned'
  | 'ProceedingReassigned'
  | 'PartyAdded'
  | 'ClaimAdded'
  | 'FilingRegistered'
  | 'FilingFiled'
  | 'ServiceCompleted'
  | 'AppearanceScheduled'
  | 'AppearanceCompleted'
  | 'AppearanceAdjourned'
  | 'WitnessRegistered'
  | 'ExpertRegistered'
  | 'ExhibitRegistered'
  | 'ExhibitAdmitted'
  | 'BundleApproved'
  | 'BundleFiled'
  | 'OrderRecorded'
  | 'ComplianceObligationCreated'
  | 'ComplianceCompleted'
  | 'ComplianceBreached'
  | 'RulingRecorded'
  | 'JudgmentRecorded'
  | 'AppealInitiated'
  | 'DeadlineCreated'
  | 'DeadlineWarning'
  | 'DeadlineBreached'
  | 'SlaBreached'
  | 'ProceedingEscalated'
  | 'ProceedingConcluded'
  | 'ProceedingClosed'
  | 'ProceedingReopened'
  | 'ProceedingArchived'
  | 'EnforcementReferralReady'
  | 'KnowledgeCandidateCreated';

export const LITIGATION_LIFECYCLE_EVENT_TYPES: readonly LitigationLifecycleEventType[] = [
  'ProceedingCreated',
  'ProceedingReferredFromMatter',
  'ProceedingAssigned',
  'ProceedingReassigned',
  'PartyAdded',
  'ClaimAdded',
  'FilingRegistered',
  'FilingFiled',
  'ServiceCompleted',
  'AppearanceScheduled',
  'AppearanceCompleted',
  'AppearanceAdjourned',
  'WitnessRegistered',
  'ExpertRegistered',
  'ExhibitRegistered',
  'ExhibitAdmitted',
  'BundleApproved',
  'BundleFiled',
  'OrderRecorded',
  'ComplianceObligationCreated',
  'ComplianceCompleted',
  'ComplianceBreached',
  'RulingRecorded',
  'JudgmentRecorded',
  'AppealInitiated',
  'DeadlineCreated',
  'DeadlineWarning',
  'DeadlineBreached',
  'SlaBreached',
  'ProceedingEscalated',
  'ProceedingConcluded',
  'ProceedingClosed',
  'ProceedingReopened',
  'ProceedingArchived',
  'EnforcementReferralReady',
  'KnowledgeCandidateCreated',
];

/** A litigation proceeding lifecycle / sub-entity transition. Ids, states, dates, safe amounts, reason codes only. */
export interface LitigationLifecyclePayload {
  readonly proceedingId: string;
  readonly proceedingType?: string;
  readonly source?: string;
  readonly sourceMatterId?: string;
  readonly jurisdiction?: string;
  readonly forum?: string;
  readonly station?: string;
  readonly division?: string;
  readonly organizationRole?: string;
  readonly litigationRisk?: string;
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

export type LitigationLifecycleEvent = DomainEventEnvelope<
  typeof LITIGATION_LIFECYCLE_FAMILY,
  LitigationLifecycleEventType,
  LitigationLifecyclePayload
>;
