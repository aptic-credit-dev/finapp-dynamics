/**
 * The M27 Finance-AI domain — PURE vocabulary, controlled state machines and the governance gates (human review,
 * explainability, no-autopost). No I/O. M27 turns the M24 governed AI pipeline into human-reviewed, EXPLAINABLE
 * SUGGESTIONS for reconciliation and finance (bank recon from M15/M15a, GL recon from M20): match suggestions,
 * exception classification, anomaly detection, risk flagging and journal-recommendation drafting. It NEVER auto-posts,
 * never approves, never auto-matches, never auto-reconciles and never mutates a finance record — a human decides and
 * the owning finance module executes. A suggestion is never a confirmed accounting fact. Confidence is an INTEGER
 * basis-points score (0..10000); money is bigint minor units (never a float). Subjects are OPAQUE M15/M20 references.
 */
export class FinanceAiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'FinanceAiError';
    this.code = code;
  }
}

export const M27_LIMITS = {
  maxConfidenceBps: 10000,
  maxPageSize: 200,
  defaultPageSize: 50,
  maxReasonLength: 2000,
} as const;

// --- data classification (drives M24 DLP + approved-provider routing) --------------------------
export const FINANCE_CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type FinanceClassification = (typeof FINANCE_CLASSIFICATIONS)[number];
export function isFinanceClassification(s: string): s is FinanceClassification {
  return (FINANCE_CLASSIFICATIONS as readonly string[]).includes(s);
}

// --- reconciliation subject (opaque M15 bank-recon / M20 GL-recon reference) --------------------
export const SUBJECT_TYPES = ['bank_recon', 'gl_recon'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export function isSubjectType(s: string): s is SubjectType {
  return (SUBJECT_TYPES as readonly string[]).includes(s);
}

// --- analysis kinds (controlled vocabulary; assistive only — never an executable finance action) -
export const ANALYSIS_KINDS = [
  'match_suggestion',
  'exception_classification',
  'anomaly_detection',
  'risk_flagging',
  'journal_recommendation',
  'transaction_classification',
] as const;
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number];
export function isAnalysisKind(s: string): s is AnalysisKind {
  return (ANALYSIS_KINDS as readonly string[]).includes(s);
}

// --- suggestion types (explainable match categories — advisory only) ---------------------------
export const SUGGESTION_TYPES = [
  'exact_reference_match',
  'amount_date_match',
  'fuzzy_reference_match',
  'split_match',
  'duplicate_candidate',
  'timing_difference',
  'fee_or_charge',
  'reversal_candidate',
  'transfer_pair',
  'journal_adjustment_candidate',
  'unresolved_exception',
  'anomaly_flag',
] as const;
export type SuggestionType = (typeof SUGGESTION_TYPES)[number];
export function isSuggestionType(s: string): s is SuggestionType {
  return (SUGGESTION_TYPES as readonly string[]).includes(s);
}

// --- exception categories (classification of a recon exception) --------------------------------
export const EXCEPTION_CATEGORIES = [
  'unmatched',
  'timing_difference',
  'fee_or_charge',
  'duplicate',
  'fx_difference',
  'missing_entry',
  'other',
] as const;
export type ExceptionCategory = (typeof EXCEPTION_CATEGORIES)[number];
export function isExceptionCategory(s: string): s is ExceptionCategory {
  return (EXCEPTION_CATEGORIES as readonly string[]).includes(s);
}

// --- matched feature types (explainability) ----------------------------------------------------
export const FEATURE_TYPES = ['reference', 'amount', 'date', 'counterparty', 'narrative', 'pattern'] as const;
export type FeatureType = (typeof FEATURE_TYPES)[number];
export function isFeatureType(s: string): s is FeatureType {
  return (FEATURE_TYPES as readonly string[]).includes(s);
}

// --- evidence source types ---------------------------------------------------------------------
export const EVIDENCE_SOURCES = ['bank_line', 'gl_line', 'statement', 'journal', 'document'] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];
export function isEvidenceSource(s: string): s is EvidenceSource {
  return (EVIDENCE_SOURCES as readonly string[]).includes(s);
}

// --- lifecycles (a HUMAN reviewer decides; the model never does) --------------------------------
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
  review_pending: ['accepted', 'rejected', 'dismissed'],
  accepted: [],
  rejected: [],
  dismissed: [],
  failed: [],
};
export const SUGGESTION_STATUSES = ['suggested', 'accepted', 'rejected', 'dismissed'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
const SUGGESTION_MACHINE: Record<string, string[]> = {
  suggested: ['accepted', 'rejected', 'dismissed'], // 'accepted' = a human chose to act; m27 never posts/matches
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
export const REVIEW_DECISIONS = ['accept', 'reject', 'dismiss'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export function isReviewDecision(s: string): s is ReviewDecision {
  return (REVIEW_DECISIONS as readonly string[]).includes(s);
}
export function decisionToState(d: ReviewDecision): 'accepted' | 'rejected' | 'dismissed' {
  return d === 'accept' ? 'accepted' : d === 'reject' ? 'rejected' : 'dismissed';
}
export const REVIEW_TARGETS = ['analysis', 'suggestion'] as const;
export type ReviewTarget = (typeof REVIEW_TARGETS)[number];

// --- reason codes -------------------------------------------------------------------------------
export const REASON_CODES = {
  subjectBound: 'subject_bound',
  analysisRequested: 'analysis_requested',
  analysisCompleted: 'analysis_completed',
  analysisBlocked: 'analysis_blocked',
  analysisFailed: 'analysis_failed',
  humanAccepted: 'human_accepted',
  humanRejected: 'human_rejected',
  humanDismissed: 'human_dismissed',
  suggestionOnly: 'suggestion_only',
  noAutopost: 'no_autopost',
  autonomousActionForbidden: 'autonomous_action_forbidden',
  aiOutputNotApproved: 'ai_output_not_approved',
  notExplainable: 'not_explainable',
  lowConfidence: 'low_confidence',
  suggestionCreated: 'suggestion_created',
  exceptionClassified: 'exception_classified',
  featureRecorded: 'feature_recorded',
  duplicateSuppressed: 'duplicate_suppressed',
  staleVersion: 'stale_version',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

// --- confidence (integer basis points; never a float) ------------------------------------------
export function isConfidenceBps(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= M27_LIMITS.maxConfidenceBps;
}
// --- money (bigint minor units; never a float) — a suggested amount is a SAFE-INTEGER minor-unit value -
export function isMinorUnits(v: number): boolean {
  return Number.isInteger(v) && Number.isSafeInteger(v);
}

/**
 * The HUMAN-review gate for a finance-AI analysis / suggestion. A recommendation can only be acted on (accepted) by a
 * HUMAN reviewer, and — where the suggestion requires explainability — only with at least one matched feature (an
 * unexplained match can never be accepted). Fails CLOSED (no autonomous action). M27 NEVER auto-posts/auto-matches.
 */
export interface ReviewGateInput {
  readonly reviewerId: string | null;
  readonly decision: string;
  readonly explainabilityRequired: boolean;
  readonly featureCount: number;
}
export interface ReviewGateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}
export function evaluateReviewGate(input: ReviewGateInput): ReviewGateResult {
  if (input.reviewerId === null || input.reviewerId.trim() === '') {
    return { allowed: false, reasonCode: REASON_CODES.autonomousActionForbidden };
  }
  if (!isReviewDecision(input.decision)) {
    return { allowed: false, reasonCode: REASON_CODES.suggestionOnly };
  }
  // Explainable matches: an unexplained match (no features) can never be ACCEPTED (reject/dismiss never need them).
  if (input.decision === 'accept' && input.explainabilityRequired && input.featureCount < 1) {
    return { allowed: false, reasonCode: REASON_CODES.notExplainable };
  }
  const map: Record<ReviewDecision, string> = {
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
  const l = limit === undefined || !Number.isFinite(limit) ? M27_LIMITS.defaultPageSize : Math.floor(limit);
  const o = offset === undefined || !Number.isFinite(offset) ? 0 : Math.floor(offset);
  return { limit: Math.max(1, Math.min(M27_LIMITS.maxPageSize, l)), offset: Math.max(0, o) };
}
