import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `approval.lifecycle` event family — owned by m22-approval (Stage 3).
 *
 * Registered in manifests/event-registry.yaml alongside this declaration and the module that emits it. Delivered
 * through the SINGLE transactional outbox that m06 owns (ADR-004/023) — m22 owns no outbox. Classification
 * `confidential`. m22 is the FINANCE APPROVAL WORKFLOW (maker-checker + Segregation of Duties): the one lifecycle
 * choke point for controlled finance actions (e.g. posting an m21 journal). It NEVER approves on behalf of a human,
 * NEVER lets one identity both make and check a controlled action, and NEVER stands up a second workflow / timer /
 * notification engine — it reuses m06 (workflow + SLA + timers) and m08 (notifications) through OPAQUE references.
 * Payloads carry IDENTIFIERS, STATES, LEVELS, DECISIONS, REASON CODES, COUNTS, opaque REFERENCES and totals (INTEGER
 * MINOR UNITS as strings) ONLY — never subject narratives, counterparty PII, or secrets. A consumer reads detail back
 * through the approvals API under its own permissions. The subject_ref (what is being approved) is an opaque id owned
 * by another module; the outcome carries the approval reference that downstream modules (m21/m23) gate posting on.
 */

export const APPROVAL_LIFECYCLE_FAMILY = 'approval.lifecycle';
export const APPROVAL_LIFECYCLE_VERSION = 1;

export type ApprovalLifecycleEventType =
  | 'PolicyPublished'
  | 'RequestCreated'
  | 'RequestSubmitted'
  | 'DecisionRecorded'
  | 'StepApproved'
  | 'StepRejected'
  | 'RequestApproved'
  | 'RequestRejected'
  | 'RequestReturned'
  | 'RequestCancelled'
  | 'RequestEscalated'
  | 'Delegated'
  | 'DelegationRevoked'
  | 'Escalated'
  | 'Overridden'
  | 'OutcomeReleased';

export const APPROVAL_LIFECYCLE_EVENT_TYPES: readonly ApprovalLifecycleEventType[] = [
  'PolicyPublished',
  'RequestCreated',
  'RequestSubmitted',
  'DecisionRecorded',
  'StepApproved',
  'StepRejected',
  'RequestApproved',
  'RequestRejected',
  'RequestReturned',
  'RequestCancelled',
  'RequestEscalated',
  'Delegated',
  'DelegationRevoked',
  'Escalated',
  'Overridden',
  'OutcomeReleased',
];

/**
 * An approval lifecycle transition. Ids, states, levels, decisions, reason codes, counts, opaque references and totals
 * (INTEGER MINOR UNITS as strings) ONLY — never subject narratives, counterparty PII or secrets. `subjectRef`,
 * `workflowRef`, `timerRef`, `notificationRef` and `approvalRef` are OPAQUE ids in their owning modules. m22 never
 * approves on behalf of a human and never posts.
 */
export interface ApprovalLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly requestId?: string;
  readonly subjectType?: string;
  readonly subjectRef?: string;
  readonly policyRef?: string;
  readonly stepId?: string;
  readonly level?: number;
  readonly decision?: string;
  readonly reasonCode?: string;
  readonly outcome?: string;
  readonly approvalRef?: string;
  readonly workflowRef?: string;
  readonly timerRef?: string;
  readonly notificationRef?: string;
  readonly delegationRef?: string;
  readonly approvalsCount?: number;
  readonly requiredApprovals?: number;
  readonly escalationDepth?: number;
  readonly amountMinor?: string;
  readonly isControlled?: boolean;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type ApprovalLifecycleEvent = DomainEventEnvelope<
  typeof APPROVAL_LIFECYCLE_FAMILY,
  ApprovalLifecycleEventType,
  ApprovalLifecyclePayload
>;
