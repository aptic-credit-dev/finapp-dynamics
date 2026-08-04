/**
 * The M22 approval-workflow vocabulary + engine limits — the small, closed sets the whole module agrees on, plus the
 * deterministic, explainable reason-code registry. Everything here is PURE (no I/O), so it is exhaustively unit-tested
 * and shared verbatim by the services, the DB CHECKs (mirrored) and the contracts. m22 is the maker-checker + SoD
 * choke point for controlled finance actions; it never approves on behalf of a human and never lets one identity both
 * make and check a controlled action.
 */

export class ApprovalError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
  }
}

/** Engine bounds. Escalation depth is bounded so a mis-configured policy cannot escalate forever. */
export const M22_LIMITS = {
  maxLevels: 20,
  maxEscalationDepth: 10,
  maxStepsPerRequest: 50,
  maxReasonLength: 2000,
} as const;

// --- subject of a controlled action (what is being approved) ------------------------------------
// Configurable, not Aptic-/finance-specific beyond the MVP's needs. A subject_ref is an OPAQUE id in the owning
// module (e.g. an m21 posting-request id); m22 never reads that module's tables.
export const SUBJECT_TYPES = [
  'journal_posting',
  'journal_draft',
  'payment',
  'adjustment',
  'reconciliation',
  'manual',
] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export function isSubjectType(s: string): s is SubjectType {
  return (SUBJECT_TYPES as readonly string[]).includes(s);
}

// --- segregation-of-duties modes + rules --------------------------------------------------------
export const SOD_MODES = ['strict', 'relaxed'] as const;
export type SodMode = (typeof SOD_MODES)[number];
export function isSodMode(s: string): s is SodMode {
  return (SOD_MODES as readonly string[]).includes(s);
}

/** The SoD relationships checked at decision time. Each maps to a reason code when it BLOCKS. */
export const SOD_RULES = ['maker_checker', 'preparer_checker', 'delegate_maker', 'single_approver'] as const;
export type SodRule = (typeof SOD_RULES)[number];

export const SOD_VERDICTS = ['allowed', 'blocked'] as const;
export type SodVerdict = (typeof SOD_VERDICTS)[number];

// --- decisions ----------------------------------------------------------------------------------
export const DECISION_KINDS = [
  'approve',
  'reject',
  'return',
  'abstain',
  'escalate',
  'cancel',
  'override_request',
  'override_approve',
  'override_reject',
] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];
export function isDecisionKind(s: string): s is DecisionKind {
  return (DECISION_KINDS as readonly string[]).includes(s);
}
/** The decisions that count as an APPROVING act by the actor — SoD (maker != checker) applies to these. */
export const APPROVING_DECISIONS: readonly DecisionKind[] = ['approve', 'override_approve'];

export const OVERRIDE_TYPES = ['override_request', 'override_approve', 'override_reject'] as const;
export type OverrideType = (typeof OVERRIDE_TYPES)[number];

// --- assignment / participants ------------------------------------------------------------------
export const ASSIGNMENT_TYPES = ['candidate', 'assigned', 'delegated'] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

export const PARTICIPANT_ROLES = [
  'maker',
  'preparer',
  'checker',
  'approver',
  'delegate',
  'escalation_target',
] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

// --- escalation ---------------------------------------------------------------------------------
export const ESCALATION_MODES = ['notify_only', 'reassign'] as const;
export type EscalationMode = (typeof ESCALATION_MODES)[number];
export function isEscalationMode(s: string): s is EscalationMode {
  return (ESCALATION_MODES as readonly string[]).includes(s);
}

// --- outcomes -----------------------------------------------------------------------------------
export const OUTCOME_KINDS = ['approved', 'rejected', 'cancelled', 'returned'] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

// --- notes --------------------------------------------------------------------------------------
export const NOTE_TYPES = ['general', 'review', 'decision', 'escalation', 'override'] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export function isNoteType(s: string): s is NoteType {
  return (NOTE_TYPES as readonly string[]).includes(s);
}

// --- reason-code registry (deterministic + explainable) -----------------------------------------
export const REASON_SEVERITIES = ['error', 'warning', 'info'] as const;
export type ReasonSeverity = (typeof REASON_SEVERITIES)[number];
export const REASON_CATEGORIES = [
  'sod',
  'authorization',
  'lifecycle',
  'concurrency',
  'escalation',
  'quorum',
] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

export interface ReasonCode {
  readonly code: string;
  readonly category: ReasonCategory;
  readonly severity: ReasonSeverity;
}
export const REASON_CODES = {
  // success
  approved: { code: 'approved', category: 'quorum', severity: 'info' },
  quorumMet: { code: 'quorum_met', category: 'quorum', severity: 'info' },
  rejected: { code: 'rejected', category: 'lifecycle', severity: 'info' },
  returned: { code: 'returned_for_changes', category: 'lifecycle', severity: 'info' },
  overrideApplied: { code: 'override_applied', category: 'authorization', severity: 'warning' },
  // SoD failures (fail closed)
  makerIsChecker: { code: 'maker_is_checker', category: 'sod', severity: 'error' },
  preparerIsChecker: { code: 'preparer_is_checker', category: 'sod', severity: 'error' },
  delegateIsMaker: { code: 'delegate_is_maker', category: 'sod', severity: 'error' },
  singleApprover: { code: 'single_approver', category: 'sod', severity: 'error' },
  // authorization
  unauthorizedActor: { code: 'unauthorized_actor', category: 'authorization', severity: 'error' },
  actorNotAssigned: { code: 'actor_not_assigned', category: 'authorization', severity: 'error' },
  policyNotActive: { code: 'policy_not_active', category: 'authorization', severity: 'error' },
  // lifecycle / concurrency
  terminalState: { code: 'terminal_state', category: 'lifecycle', severity: 'error' },
  invalidTransition: { code: 'invalid_transition', category: 'lifecycle', severity: 'error' },
  resubmissionNotAllowed: { code: 'resubmission_not_allowed', category: 'lifecycle', severity: 'error' },
  staleVersion: { code: 'stale_version', category: 'concurrency', severity: 'error' },
  duplicateRequest: { code: 'duplicate_request', category: 'concurrency', severity: 'error' },
  // quorum / escalation
  insufficientApprovals: { code: 'insufficient_approvals', category: 'quorum', severity: 'error' },
  escalationTimeout: { code: 'escalation_timeout', category: 'escalation', severity: 'warning' },
  escalationDepthExceeded: { code: 'escalation_depth_exceeded', category: 'escalation', severity: 'error' },
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES).map((r) => r.code);
export function reasonCodeOf(key: ReasonCodeKey): string {
  return REASON_CODES[key].code;
}
