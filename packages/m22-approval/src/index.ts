/**
 * @finapp/m22-approval — the FINANCE APPROVAL WORKFLOW (Stage 3): maker-checker + Segregation of Duties.
 *
 * The one lifecycle choke point for controlled finance actions (e.g. posting an m21 journal): a single aggregate
 * (approval_request) with explicit valid transitions, transition reason codes, service-layer authorization, optimistic
 * concurrency, idempotency, append-only status/decision history, audit, `approval.lifecycle` events, workflow +
 * notification hooks, deterministic (clock-driven) escalation, controlled cancellation + resubmission, and terminal-
 * state protection. It NEVER approves on behalf of a human, NEVER lets one identity both make and check a controlled
 * action (SoD, DB CHECK), NEVER posts to a ledger (m21/m23 do, gated on the approval reference it releases), and NEVER
 * stands up a second workflow / timer / notification engine — it reuses m06 (workflow + SLA + timers + the ONE outbox
 * m06 owns) and m08 (notifications) through OPAQUE references. Services run inside `db.withTenant` with m03 audit +
 * events on that one outbox.
 */

// Permissions + audit codes
export { M22_PERMISSIONS, ALL_M22_PERMISSIONS, M22_PRIVILEGED_PERMISSIONS } from './permissions.ts';
export type { M22Permission } from './permissions.ts';
export { M22_AUDIT_CODES, ALL_M22_AUDIT_CODES, APPROVAL_AUDIT_PREFIX } from './audit-codes.ts';
export type { M22AuditCode } from './audit-codes.ts';

// Domain — vocabulary + reason codes
export {
  M22_LIMITS,
  ApprovalError,
  SUBJECT_TYPES,
  isSubjectType,
  SOD_MODES,
  isSodMode,
  SOD_RULES,
  SOD_VERDICTS,
  DECISION_KINDS,
  isDecisionKind,
  APPROVING_DECISIONS,
  OVERRIDE_TYPES,
  ASSIGNMENT_TYPES,
  PARTICIPANT_ROLES,
  ESCALATION_MODES,
  isEscalationMode,
  OUTCOME_KINDS,
  NOTE_TYPES,
  isNoteType,
  REASON_SEVERITIES,
  REASON_CATEGORIES,
  REASON_CODES,
  ALL_REASON_CODES,
  reasonCodeOf,
} from './domain/vocab.ts';
export type {
  SubjectType,
  SodMode,
  SodRule,
  SodVerdict,
  DecisionKind,
  OverrideType,
  AssignmentType,
  ParticipantRole,
  EscalationMode,
  OutcomeKind,
  NoteType,
  ReasonSeverity,
  ReasonCategory,
  ReasonCode,
  ReasonCodeKey,
} from './domain/vocab.ts';

// Domain — lifecycles
export {
  REQUEST_STATUSES,
  checkRequestTransition,
  isRequestActionable,
  isRequestTerminal,
  STEP_STATUSES,
  checkStepTransition,
  isStepTerminal,
  SPEC_STATUSES,
  checkSpecTransition,
  isSpecFrozen,
  DELEGATION_STATUSES,
  checkDelegationTransition,
} from './domain/lifecycles.ts';
export type {
  TransitionResult,
  RequestStatus,
  StepStatus,
  SpecStatus,
  DelegationStatus,
} from './domain/lifecycles.ts';

// The PURE SoD + quorum engine
export { evaluateSod, sodPermits, checkQuorum, canEscalate, ApprovalEngineError } from './engine.ts';
export type {
  SodFinding,
  SodInput,
  SodResult,
  QuorumInput,
  QuorumResult,
  EscalationInput,
} from './engine.ts';

// Ports + errors + emit
export { SystemClock, FixedClock } from './ports.ts';
export type { Clock } from './ports.ts';
export { badRequest, sodForbidden } from './errors.ts';
export { M22Emitter } from './emit.ts';

// Persistence
export { ApprovalRepository } from './repository.ts';
export type {
  ApprovalPolicyRow,
  ApprovalPolicyStepRow,
  ApprovalConfigRow,
  ApprovalReasonCodeRow,
  ApprovalRequestRow,
  ApprovalRequestStepRow,
  ApprovalDecisionRow,
  ApprovalHistoryRow,
  ApprovalDelegationRow,
  ApprovalSodCheckRow,
  ApprovalParticipantRow,
  ApprovalAssignmentRow,
  ApprovalEscalationRow,
  ApprovalTimerRow,
  ApprovalNotificationRow,
  ApprovalWorkflowLinkRow,
  ApprovalIdempotencyRow,
  ApprovalNoteRow,
  ApprovalEvidenceRow,
  ApprovalOutcomeRow,
  ApprovalOverrideRow,
} from './repository.ts';

// Services
export { CatalogService } from './catalog.service.ts';
export { RequestService } from './request.service.ts';
export { DecisionService } from './decision.service.ts';
export type { DecisionResult } from './decision.service.ts';
export { DelegationService } from './delegation.service.ts';
export { EscalationService } from './escalation.service.ts';
