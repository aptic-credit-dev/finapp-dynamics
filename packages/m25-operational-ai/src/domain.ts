/**
 * The M25 Operational-AI domain — PURE vocabulary, state machines and the human-decision gate. No I/O. M25 turns the
 * M24 governed AI pipeline into human-reviewed SUGGESTIONS for Feedback (m12) and Case (m13): summaries, sentiment,
 * classification, root-cause hints, suggested activities and routing/escalation recommendations. It RECOMMENDS ONLY —
 * it never closes, escalates, reassigns or resolves a controlled item on its own; a human decides. Confidence is an
 * INTEGER basis-points score (0..10000), never a float. Subjects (feedback/case) are referenced by OPAQUE id only.
 */
export class OperationalAiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'OperationalAiError';
    this.code = code;
  }
}

export const M25_LIMITS = {
  maxConfidenceBps: 10000,
  maxPageSize: 200,
  defaultPageSize: 50,
  maxReasonLength: 2000,
} as const;

// --- operational subject (opaque m12 feedback / m13 case reference) -----------------------------
export const SUBJECT_TYPES = ['feedback', 'case'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export function isSubjectType(s: string): s is SubjectType {
  return (SUBJECT_TYPES as readonly string[]).includes(s);
}

// --- analysis kind (assistive only — never a controlled action) ---------------------------------
export const ANALYSIS_KINDS = ['summary', 'sentiment', 'classification', 'root_cause', 'routing'] as const;
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number];
export function isAnalysisKind(s: string): s is AnalysisKind {
  return (ANALYSIS_KINDS as readonly string[]).includes(s);
}

// --- sentiment label (a SUGGESTION; a human confirms) -------------------------------------------
export const SENTIMENT_LABELS = ['positive', 'neutral', 'negative', 'mixed'] as const;
export type SentimentLabel = (typeof SENTIMENT_LABELS)[number];
export function isSentimentLabel(s: string): s is SentimentLabel {
  return (SENTIMENT_LABELS as readonly string[]).includes(s);
}

// --- analysis lifecycle (wraps an m24 request/output; a HUMAN accepts/rejects) -------------------
export const ANALYSIS_STATUSES = [
  'requested',
  'review_pending',
  'accepted',
  'rejected',
  'dismissed',
  'failed',
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];
const ANALYSIS_MACHINE: Record<string, string[]> = {
  requested: ['review_pending', 'failed'],
  review_pending: ['accepted', 'rejected', 'dismissed'], // a HUMAN decides — never the model
  accepted: [],
  rejected: [],
  dismissed: [],
  failed: [],
};

// --- suggestion lifecycle (recommends only; a HUMAN acts, m25 never does) ------------------------
export const SUGGESTION_TYPES = ['activity', 'routing', 'escalation', 'reassignment'] as const;
export type SuggestionType = (typeof SUGGESTION_TYPES)[number];
export function isSuggestionType(s: string): s is SuggestionType {
  return (SUGGESTION_TYPES as readonly string[]).includes(s);
}
export const SUGGESTION_STATUSES = ['suggested', 'accepted', 'rejected', 'dismissed'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
const SUGGESTION_MACHINE: Record<string, string[]> = {
  suggested: ['accepted', 'rejected', 'dismissed'], // 'accepted' = a human chose to act; m25 never applies it
  accepted: [],
  rejected: [],
  dismissed: [],
};

export interface TransitionResult {
  readonly ok: boolean;
  readonly to?: string;
  readonly reason?: string;
}
function transition(machine: Record<string, string[]>, from: string, to: string): TransitionResult {
  const forState = machine[from];
  if (forState === undefined) return { ok: false, reason: `unknown state "${from}"` };
  if (!forState.includes(to)) return { ok: false, reason: `cannot move "${from}" -> "${to}"` };
  return { ok: true, to };
}
export function checkAnalysisTransition(from: string, to: string): TransitionResult {
  return transition(ANALYSIS_MACHINE, from, to);
}
export function isAnalysisTerminal(s: string): boolean {
  return s === 'accepted' || s === 'rejected' || s === 'dismissed' || s === 'failed';
}
export function checkSuggestionTransition(from: string, to: string): TransitionResult {
  return transition(SUGGESTION_MACHINE, from, to);
}
export function isSuggestionTerminal(s: string): boolean {
  return s === 'accepted' || s === 'rejected' || s === 'dismissed';
}

// --- config spec status -------------------------------------------------------------------------
export const SPEC_STATUSES = ['draft', 'active', 'superseded', 'retired'] as const;
export type SpecStatus = (typeof SPEC_STATUSES)[number];
export function isSpecFrozen(s: string): boolean {
  return s === 'active' || s === 'superseded' || s === 'retired';
}

// --- human decisions ----------------------------------------------------------------------------
export const DECISIONS = ['accept', 'reject', 'dismiss'] as const;
export type Decision = (typeof DECISIONS)[number];
export function isDecision(s: string): s is Decision {
  return (DECISIONS as readonly string[]).includes(s);
}
/** Map a human decision to the target terminal state. */
export function decisionToState(d: Decision): 'accepted' | 'rejected' | 'dismissed' {
  return d === 'accept' ? 'accepted' : d === 'reject' ? 'rejected' : 'dismissed';
}

// --- evidence / review source kinds -------------------------------------------------------------
export const EVIDENCE_SOURCES = ['feedback_answer', 'case_activity', 'document'] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];
export function isEvidenceSource(s: string): s is EvidenceSource {
  return (EVIDENCE_SOURCES as readonly string[]).includes(s);
}
export const REVIEW_TARGETS = ['analysis', 'suggestion'] as const;
export type ReviewTarget = (typeof REVIEW_TARGETS)[number];

// --- reason codes -------------------------------------------------------------------------------
export const REASON_CODES = {
  subjectBound: 'subject_bound',
  analysisRequested: 'analysis_requested',
  analysisGenerated: 'analysis_generated',
  analysisFailed: 'analysis_failed',
  humanAccepted: 'human_accepted',
  humanRejected: 'human_rejected',
  humanDismissed: 'human_dismissed',
  recommendsOnly: 'recommends_only',
  autonomousActionForbidden: 'autonomous_action_forbidden',
  aiOutputNotApproved: 'ai_output_not_approved',
  lowConfidence: 'low_confidence',
  suggestionCreated: 'suggestion_created',
  duplicateSuppressed: 'duplicate_suppressed',
  staleVersion: 'stale_version',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

// --- confidence (integer basis points; never a float) ------------------------------------------
export function isConfidenceBps(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= M25_LIMITS.maxConfidenceBps;
}

/**
 * The HUMAN-decision gate for an operational analysis or suggestion. A recommendation can only be acted on (accepted)
 * by a HUMAN reviewer; M25 recommends only and never acts autonomously. Fails CLOSED (no autonomous accept).
 */
export interface DecisionGateInput {
  readonly reviewerId: string | null;
  readonly decision: string;
}
export interface DecisionGateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}
export function evaluateDecisionGate(input: DecisionGateInput): DecisionGateResult {
  if (input.reviewerId === null || input.reviewerId.trim() === '') {
    return { allowed: false, reasonCode: REASON_CODES.autonomousActionForbidden };
  }
  if (!isDecision(input.decision)) {
    return { allowed: false, reasonCode: REASON_CODES.recommendsOnly };
  }
  const map: Record<Decision, string> = {
    accept: REASON_CODES.humanAccepted,
    reject: REASON_CODES.humanRejected,
    dismiss: REASON_CODES.humanDismissed,
  };
  return { allowed: true, reasonCode: map[input.decision] };
}

// --- bounded pagination ------------------------------------------------------------------------
export interface Page {
  readonly limit: number;
  readonly offset: number;
}
export function clampPage(limit: number | undefined, offset: number | undefined): Page {
  const l = limit === undefined || !Number.isFinite(limit) ? M25_LIMITS.defaultPageSize : Math.floor(limit);
  const o = offset === undefined || !Number.isFinite(offset) ? 0 : Math.floor(offset);
  return { limit: Math.max(1, Math.min(M25_LIMITS.maxPageSize, l)), offset: Math.max(0, o) };
}
