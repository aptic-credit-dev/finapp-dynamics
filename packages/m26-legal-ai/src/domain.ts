/**
 * The M26 Legal-AI domain — PURE vocabulary, controlled state machines and the governance gates (human review, citation,
 * ethical wall, fact-vs-inference). No I/O. M26 turns the M24 governed AI pipeline into human-reviewed, citation-backed
 * SUGGESTIONS for the legal domain (matters/cases from M14): summaries, chronology, issue/obligation/deadline
 * extraction, clause analysis, evidence-gap detection and drafting assistance. LEGAL-ADVISORY ONLY — it never files,
 * never reaches a legal conclusion, never settles or enforces, never mutates a matter; a human legal reviewer decides.
 * An AI inference is NEVER labelled a verified legal fact. Confidence is an INTEGER basis-points score (0..10000).
 * Matters/documents are referenced by OPAQUE id only, inside privilege + ethical-wall boundaries.
 */
export class LegalAiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LegalAiError';
    this.code = code;
  }
}

export const M26_LIMITS = {
  maxConfidenceBps: 10000,
  maxPageSize: 200,
  defaultPageSize: 50,
  maxReasonLength: 2000,
} as const;

// --- data classification (drives M24 DLP + approved-provider routing) --------------------------
export const LEGAL_CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type LegalClassification = (typeof LEGAL_CLASSIFICATIONS)[number];
export function isLegalClassification(s: string): s is LegalClassification {
  return (LEGAL_CLASSIFICATIONS as readonly string[]).includes(s);
}

// --- privilege classification (ethical-wall boundary) ------------------------------------------
export const PRIVILEGE_CLASSIFICATIONS = ['none', 'confidential', 'work_product', 'privileged'] as const;
export type PrivilegeClassification = (typeof PRIVILEGE_CLASSIFICATIONS)[number];
export function isPrivilegeClassification(s: string): s is PrivilegeClassification {
  return (PRIVILEGE_CLASSIFICATIONS as readonly string[]).includes(s);
}
/** Privileged / work-product material is behind the ethical wall — access requires the privileged-read permission. */
export function isBehindEthicalWall(p: string): boolean {
  return p === 'privileged' || p === 'work_product';
}

// --- legal subject (opaque m14 matter/case reference) ------------------------------------------
export const SUBJECT_TYPES = ['matter', 'case'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export function isSubjectType(s: string): s is SubjectType {
  return (SUBJECT_TYPES as readonly string[]).includes(s);
}

// --- analysis kinds (controlled vocabulary; assistive only — no executable legal operation) -----
export const ANALYSIS_KINDS = [
  'matter_summary',
  'case_summary',
  'chronology',
  'issue_extraction',
  'obligation_extraction',
  'deadline_extraction',
  'clause_analysis',
  'evidence_gap',
  'precedent_suggestion',
  'risk_suggestion',
  'filing_preparation',
  'draft_assistance',
  'next_action_suggestion',
] as const;
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number];
export function isAnalysisKind(s: string): s is AnalysisKind {
  return (ANALYSIS_KINDS as readonly string[]).includes(s);
}

// --- finding types + fact status (fact vs inference — never a "verified" legal fact) ------------
export const FINDING_TYPES = [
  'extracted_fact',
  'inferred_issue',
  'legal_suggestion',
  'procedural_suggestion',
  'drafting_suggestion',
  'risk_flag',
  'evidence_gap',
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];
export function isFindingType(s: string): s is FindingType {
  return (FINDING_TYPES as readonly string[]).includes(s);
}
/** A finding is an EXTRACTED datum or an INFERRED proposition — NEVER a "verified" legal fact (a human verifies). */
export const FACT_STATUSES = ['extracted', 'inferred'] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];
export function isFactStatus(s: string): s is FactStatus {
  return (FACT_STATUSES as readonly string[]).includes(s);
}

// --- suggestion types (advisory only — never filing/settlement/enforcement) ---------------------
export const SUGGESTION_TYPES = [
  'procedural',
  'drafting',
  'risk',
  'next_action',
  'precedent',
  'evidence_gap',
] as const;
export type SuggestionType = (typeof SUGGESTION_TYPES)[number];
export function isSuggestionType(s: string): s is SuggestionType {
  return (SUGGESTION_TYPES as readonly string[]).includes(s);
}

// --- citation source + evidence classification --------------------------------------------------
export const CITATION_SOURCE_TYPES = ['document', 'matter_record', 'precedent'] as const;
export type CitationSourceType = (typeof CITATION_SOURCE_TYPES)[number];
export function isCitationSourceType(s: string): s is CitationSourceType {
  return (CITATION_SOURCE_TYPES as readonly string[]).includes(s);
}
export const EVIDENCE_CLASSIFICATIONS = ['primary', 'secondary', 'supporting'] as const;
export type EvidenceClassification = (typeof EVIDENCE_CLASSIFICATIONS)[number];
export function isEvidenceClassification(s: string): s is EvidenceClassification {
  return (EVIDENCE_CLASSIFICATIONS as readonly string[]).includes(s);
}

// --- lifecycles (a HUMAN legal reviewer decides; the model never does) --------------------------
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
  review_pending: ['accepted', 'rejected', 'dismissed'], // a HUMAN legal reviewer decides
  accepted: [],
  rejected: [],
  dismissed: [],
  failed: [],
};
export const SUGGESTION_STATUSES = ['suggested', 'accepted', 'rejected', 'dismissed'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
const SUGGESTION_MACHINE: Record<string, string[]> = {
  suggested: ['accepted', 'rejected', 'dismissed'], // 'accepted' = a human chose to act; m26 never acts
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

// --- reason codes (LegalAiReasonCode) -----------------------------------------------------------
export const REASON_CODES = {
  subjectBound: 'subject_bound',
  analysisRequested: 'analysis_requested',
  analysisCompleted: 'analysis_completed',
  analysisBlocked: 'analysis_blocked',
  analysisFailed: 'analysis_failed',
  humanAccepted: 'human_accepted',
  humanRejected: 'human_rejected',
  humanDismissed: 'human_dismissed',
  legalAdvisoryOnly: 'legal_advisory_only',
  autonomousActionForbidden: 'autonomous_action_forbidden',
  aiOutputNotApproved: 'ai_output_not_approved',
  missingCitations: 'missing_required_citations',
  ethicalWallDenied: 'ethical_wall_denied',
  privilegedReadRecorded: 'privileged_read_recorded',
  lowConfidence: 'low_confidence',
  findingRecorded: 'finding_recorded',
  suggestionCreated: 'suggestion_created',
  duplicateSuppressed: 'duplicate_suppressed',
  staleVersion: 'stale_version',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

// --- confidence (ConfidenceBasisPoints — integer 0..10000; never a float) -----------------------
export function isConfidenceBps(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= M26_LIMITS.maxConfidenceBps;
}

/**
 * The ETHICAL-WALL gate. Privileged / work-product material may only be reached by a caller who holds the
 * privileged-read entitlement. Fails CLOSED (deny by default).
 */
export interface EthicalWallInput {
  readonly privilege: string;
  readonly hasPrivilegedRead: boolean;
}
export interface EthicalWallResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}
export function evaluateEthicalWall(input: EthicalWallInput): EthicalWallResult {
  if (isBehindEthicalWall(input.privilege) && !input.hasPrivilegedRead) {
    return { allowed: false, reasonCode: REASON_CODES.ethicalWallDenied };
  }
  return { allowed: true, reasonCode: REASON_CODES.privilegedReadRecorded };
}

/**
 * The HUMAN-review gate for a legal analysis / suggestion. A recommendation can only be acted on (accepted) by a HUMAN
 * legal reviewer, and — where the analysis requires citations — only with at least one citation. Fails CLOSED.
 */
export interface ReviewGateInput {
  readonly reviewerId: string | null;
  readonly decision: string;
  readonly citationsRequired: boolean;
  readonly citationCount: number;
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
    return { allowed: false, reasonCode: REASON_CODES.legalAdvisoryOnly };
  }
  // Citations are only mandatory to ACCEPT a citations-required analysis (reject/dismiss never need them).
  if (input.decision === 'accept' && input.citationsRequired && input.citationCount < 1) {
    return { allowed: false, reasonCode: REASON_CODES.missingCitations };
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
  const l = limit === undefined || !Number.isFinite(limit) ? M26_LIMITS.defaultPageSize : Math.floor(limit);
  const o = offset === undefined || !Number.isFinite(offset) ? 0 : Math.floor(offset);
  return { limit: Math.max(1, Math.min(M26_LIMITS.maxPageSize, l)), offset: Math.max(0, o) };
}
