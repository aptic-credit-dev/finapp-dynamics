import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `recovery.lifecycle` event family — owned by m17-recovery (Stage 4.3).
 *
 * Registered in manifests/event-registry.yaml alongside this declaration and the module that emits it.
 * Delivered through the SINGLE transactional outbox that m06 owns (ADR-004/023) — m17 owns no outbox.
 * Classification `confidential`. Payloads carry IDENTIFIERS, STATES, DATES, safe AMOUNTS (minor units), REASON
 * CODES and SAFE ANALYTICS DIMENSIONS ONLY — never debtor contact details, negotiation strategy, settlement terms,
 * bank/payment details, security valuations, document contents, or raw correspondence (ADR-072). A consumer that
 * needs detail reads it back through the recovery API under its own permissions. M17 CONSUMES an M16 enforcement
 * referral through a governed inbound contract and emits `RecoveryReferredFromProceeding` on this family. All
 * amounts are REFERENCES only — m17 performs no cash application, no ledger posting, no accounting write-off.
 */

export const RECOVERY_LIFECYCLE_FAMILY = 'recovery.lifecycle';
export const RECOVERY_LIFECYCLE_VERSION = 1;

export type RecoveryLifecycleEventType =
  | 'RecoveryCreated'
  | 'RecoveryReferredFromProceeding'
  | 'RecoveryAssigned'
  | 'RecoveryReassigned'
  | 'DebtorAdded'
  | 'InstrumentRegistered'
  | 'DemandIssued'
  | 'DemandResponded'
  | 'NegotiationOpened'
  | 'NegotiationClosed'
  | 'ArrangementCreated'
  | 'ArrangementActivated'
  | 'ArrangementDefaulted'
  | 'ArrangementCompleted'
  | 'InstallmentRecorded'
  | 'EnforcementActionInitiated'
  | 'EnforcementActionUpdated'
  | 'EnforcementActionCompleted'
  | 'SecurityRegistered'
  | 'SecurityRealized'
  | 'AgentInstructed'
  | 'AgentReportReceived'
  | 'ReceiptRecorded'
  | 'WaiverGranted'
  | 'WriteOffRecommended'
  | 'WriteOffApproved'
  | 'OutcomeRecorded'
  | 'DeadlineCreated'
  | 'DeadlineWarning'
  | 'DeadlineBreached'
  | 'SlaBreached'
  | 'RecoveryEscalated'
  | 'RecoveryResolved'
  | 'RecoveryClosed'
  | 'RecoveryReopened'
  | 'RecoveryArchived';

export const RECOVERY_LIFECYCLE_EVENT_TYPES: readonly RecoveryLifecycleEventType[] = [
  'RecoveryCreated',
  'RecoveryReferredFromProceeding',
  'RecoveryAssigned',
  'RecoveryReassigned',
  'DebtorAdded',
  'InstrumentRegistered',
  'DemandIssued',
  'DemandResponded',
  'NegotiationOpened',
  'NegotiationClosed',
  'ArrangementCreated',
  'ArrangementActivated',
  'ArrangementDefaulted',
  'ArrangementCompleted',
  'InstallmentRecorded',
  'EnforcementActionInitiated',
  'EnforcementActionUpdated',
  'EnforcementActionCompleted',
  'SecurityRegistered',
  'SecurityRealized',
  'AgentInstructed',
  'AgentReportReceived',
  'ReceiptRecorded',
  'WaiverGranted',
  'WriteOffRecommended',
  'WriteOffApproved',
  'OutcomeRecorded',
  'DeadlineCreated',
  'DeadlineWarning',
  'DeadlineBreached',
  'SlaBreached',
  'RecoveryEscalated',
  'RecoveryResolved',
  'RecoveryClosed',
  'RecoveryReopened',
  'RecoveryArchived',
];

/** A recovery/enforcement lifecycle / sub-entity transition. Ids, states, dates, safe amounts, reason codes only. */
export interface RecoveryLifecyclePayload {
  readonly recoveryId: string;
  readonly recoveryType?: string;
  readonly source?: string;
  readonly sourceProceedingId?: string;
  readonly sourceMatterId?: string;
  readonly instrumentType?: string;
  readonly strategy?: string;
  readonly enforcementStage?: string;
  readonly jurisdiction?: string;
  readonly riskRating?: string;
  readonly priority?: string;
  readonly confidentiality?: string;
  readonly amountMinor?: number;
  readonly currency?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly reasonCode?: string;
  readonly dueAt?: string;
  readonly ruleEvaluationId?: string;
}

export type RecoveryLifecycleEvent = DomainEventEnvelope<
  typeof RECOVERY_LIFECYCLE_FAMILY,
  RecoveryLifecycleEventType,
  RecoveryLifecyclePayload
>;
