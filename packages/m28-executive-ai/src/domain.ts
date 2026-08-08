/**
 * The M28 Executive-Copilot domain — PURE vocabulary, controlled state machines and the governance gates (READ-ONLY
 * intent, CITATION-required, ENTITLEMENT masking, PROMPT-INJECTION screening). No I/O. M28 turns the M24 governed AI
 * pipeline into READ-ONLY, CITED, RLS-MASKED executive assistance: it answers executive questions and produces
 * cross-domain summaries with citations and confidence. It NEVER mutates a business record, approves, posts, disburses,
 * reconciles, closes a case, files a matter, sends a notification, changes roles/rules/workflow or executes ANY
 * controlled action — a human decides. The copilot never expands the caller's authority: a caller only ever receives
 * data their tenant + row-level entitlements already permit (no cross-tenant inference, no masked-row/count leakage).
 * Confidence is an INTEGER basis-points score (0..10000); large question/answer content lives behind OPAQUE m09
 * references; there is NO float and NO secret/credential value here.
 */
export class ExecutiveAiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExecutiveAiError';
    this.code = code;
  }
}

export const M28_LIMITS = {
  maxConfidenceBps: 10000,
  maxPageSize: 200,
  defaultPageSize: 50,
  maxSources: 200,
  defaultMaxSources: 20,
  maxQuestionLength: 8000,
  maxReasonLength: 2000,
} as const;

// --- data classification (drives M24 DLP + approved-provider routing; gates ai.copilot.sensitive) ---------------
export const DATA_CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];
export function isDataClassification(s: string): s is DataClassification {
  return (DATA_CLASSIFICATIONS as readonly string[]).includes(s);
}
/** confidential/restricted queries require the privileged ai.copilot.sensitive permission. */
export function isSensitiveClassification(s: string): boolean {
  return s === 'confidential' || s === 'restricted';
}

// --- scope level (tenant caller vs platform operator; platform requires ai.copilot.platform) --------------------
export const SCOPE_LEVELS = ['tenant', 'platform'] as const;
export type ScopeLevel = (typeof SCOPE_LEVELS)[number];
export function isScopeLevel(s: string): s is ScopeLevel {
  return (SCOPE_LEVELS as readonly string[]).includes(s);
}

// --- intent classes (controlled vocabulary; every one is a READ — never an executable action) ------------------
export const INTENT_CLASSES = [
  'executive_question',
  'operational_summary',
  'finance_summary',
  'legal_summary',
  'feedback_summary',
  'case_summary',
  'kpi_explanation',
  'trend_explanation',
  'risk_summary',
  'exception_summary',
  'portfolio_summary',
  'cross_domain_synthesis',
  'dashboard_narrative',
  'follow_up',
] as const;
export type IntentClass = (typeof INTENT_CLASSES)[number];
export function isIntentClass(s: string): s is IntentClass {
  return (INTENT_CLASSES as readonly string[]).includes(s);
}

// --- source domains the copilot may read from (read-only ports) --------------------------------------------------
export const SOURCE_MODULES = [
  'm12-feedback',
  'm13-case',
  'm14-legal',
  'm19-finance',
  'm09-docs',
  'm32-analytics',
  'm24-ai-foundation',
] as const;
export type SourceModule = (typeof SOURCE_MODULES)[number];

// --- citation source types --------------------------------------------------------------------------------------
export const CITATION_SOURCE_TYPES = [
  'record',
  'document',
  'metric',
  'aggregate',
  'timeline',
  'report',
] as const;
export type CitationSourceType = (typeof CITATION_SOURCE_TYPES)[number];
export function isCitationSourceType(s: string): s is CitationSourceType {
  return (CITATION_SOURCE_TYPES as readonly string[]).includes(s);
}

// --- feedback ratings -------------------------------------------------------------------------------------------
export const FEEDBACK_RATINGS = ['helpful', 'not_helpful', 'inaccurate', 'incomplete'] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];
export function isFeedbackRating(s: string): s is FeedbackRating {
  return (FEEDBACK_RATINGS as readonly string[]).includes(s);
}

// --- entitlement results (a citation is only ever persisted when GRANTED) ---------------------------------------
export const ENTITLEMENT_RESULTS = ['granted', 'masked', 'redacted'] as const;
export type EntitlementResult = (typeof ENTITLEMENT_RESULTS)[number];

// --- query lifecycle (a HUMAN reads the answer; the model never acts) -------------------------------------------
export const QUERY_STATUSES = [
  'received',
  'authorized',
  'masked',
  'evidence_resolved',
  'ai_requested',
  'generated',
  'validated',
  'completed',
  'refused',
  'failed',
] as const;
export type QueryStatus = (typeof QUERY_STATUSES)[number];
const QUERY_MACHINE: Record<string, string[]> = {
  received: ['authorized', 'refused', 'failed'],
  authorized: ['masked', 'refused', 'failed'],
  masked: ['evidence_resolved', 'refused', 'failed'],
  evidence_resolved: ['ai_requested', 'refused', 'failed'],
  ai_requested: ['generated', 'failed'],
  generated: ['validated', 'failed'],
  validated: ['completed', 'refused', 'failed'],
  completed: [],
  refused: [],
  failed: [],
};
export function checkQueryTransition(from: string, to: string): TransitionResult {
  return transition(QUERY_MACHINE, from, to);
}
export function isQueryTerminal(s: string): boolean {
  return s === 'completed' || s === 'refused' || s === 'failed';
}

// --- response lifecycle -----------------------------------------------------------------------------------------
export const RESPONSE_STATUSES = [
  'draft',
  'citation_validated',
  'policy_validated',
  'complete',
  'review_required',
  'rejected',
] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];
const RESPONSE_MACHINE: Record<string, string[]> = {
  draft: ['citation_validated', 'review_required', 'rejected'],
  citation_validated: ['policy_validated', 'review_required', 'rejected'],
  policy_validated: ['complete', 'review_required', 'rejected'],
  complete: [],
  review_required: [],
  rejected: [],
};
export function checkResponseTransition(from: string, to: string): TransitionResult {
  return transition(RESPONSE_MACHINE, from, to);
}
export function isResponseTerminal(s: string): boolean {
  return s === 'complete' || s === 'review_required' || s === 'rejected';
}

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

// --- config spec status -----------------------------------------------------------------------------------------
export const SPEC_STATUSES = ['draft', 'active', 'superseded', 'retired'] as const;
export type SpecStatus = (typeof SPEC_STATUSES)[number];
export function isSpecFrozen(s: string): boolean {
  return s === 'active' || s === 'superseded' || s === 'retired';
}

// --- reason codes -----------------------------------------------------------------------------------------------
export const REASON_CODES = {
  queryReceived: 'query_received',
  authorized: 'authorized',
  masked: 'entitlement_masked',
  evidenceResolved: 'evidence_resolved',
  aiRequested: 'ai_requested',
  generated: 'answer_generated',
  cited: 'answer_cited',
  policyValidated: 'policy_validated',
  completed: 'answer_completed',
  // refusals (safe, machine-readable — no side effect)
  readOnlyViolation: 'read_only_violation',
  mutationForbidden: 'mutation_forbidden',
  controlledActionForbidden: 'controlled_action_forbidden',
  promptInjectionBlocked: 'prompt_injection_blocked',
  dlpBlocked: 'dlp_blocked',
  aiOutputNotGenerated: 'ai_output_not_generated',
  // review-required
  missingCitations: 'missing_citations',
  insufficientEvidence: 'insufficient_evidence',
  lowConfidence: 'low_confidence',
  analyticsUnavailable: 'analytics_unavailable',
  reviewRequired: 'review_required',
  // masking / entitlement
  entitlementIntersection: 'entitlement_intersection',
  crossTenantDenied: 'cross_tenant_denied',
  notEntitled: 'not_entitled',
  // feedback / export
  feedbackRecorded: 'feedback_recorded',
  exportHumanReviewRequired: 'export_human_review_required',
  duplicateSuppressed: 'duplicate_suppressed',
  staleVersion: 'stale_version',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

// --- confidence (integer basis points; never a float) -----------------------------------------------------------
export function isConfidenceBps(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= M28_LIMITS.maxConfidenceBps;
}

/**
 * THE READ-ONLY / COMMAND GATE — the first line of defence. An executive query is assistance only; it may ask the
 * copilot to SUMMARISE, EXPLAIN or SUGGEST-WHAT-A-HUMAN-SHOULD-CONSIDER, but it may NEVER instruct a controlled action.
 * A query text that expresses a mutating/controlled intent (approve, post, pay, disburse, reconcile, close, file, send,
 * update, suspend, execute, settle, delete, transfer, ...) is REFUSED — fail closed, no side effect, a machine-readable
 * reason code. The copilot may still SUGGEST what a human should consider; it never executes it.
 */
const FORBIDDEN_ACTION_PATTERNS: readonly RegExp[] = [
  /\bapprove(s|d)?\b/i,
  /\bpost(s|ed|ing)?\s+(the\s+|this\s+|a\s+)?(journal|entry|entries|payment|transaction)/i,
  /\bpay\b|\bdisburse(s|d)?\b|\bremit(s|ted)?\b/i,
  /\breconcile(s|d)?\b|\brun\s+reconciliation\b/i,
  /\bclose(s|d)?\s+(the\s+|this\s+)?(case|matter|period|account)/i,
  /\bfile(s|d)?\s+(the\s+|this\s+|a\s+)?(matter|claim|lawsuit|motion|document)/i,
  /\bsend(s|ing)?\s+(the\s+|this\s+|a\s+|an\s+)?(email|notification|reminder|message|letter)/i,
  /\bsuspend(s|ed)?\b|\bdeactivate(s|d)?\b|\bdisable(s|d)?\s+(the\s+)?user/i,
  /\bexecute(s|d)?\s+(the\s+|this\s+|a\s+)?(settlement|recovery|payment|transfer|trade)/i,
  /\bsettle(s|d)?\b|\binitiate(s|d)?\s+(a\s+)?(payment|transfer|transaction|settlement)/i,
  /\bdelete(s|d)?\b|\bpurge(s|d)?\b|\bdrop\s+table\b/i,
  /\btransfer\s+(funds|money|\$)/i,
  /\bupdate(s|d)?\s+(the\s+|this\s+)?(loan|account|record|balance|status)/i,
  /\bgrant(s|ed)?\s+(a\s+)?(role|permission)|\bchange(s|d)?\s+(the\s+)?(role|permission|workflow|rule)/i,
  /\breconciliation\s+run|write\s+off\b|writeoff\b/i,
];

export interface ReadOnlyGateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}
export function evaluateReadOnlyGate(text: string): ReadOnlyGateResult {
  for (const re of FORBIDDEN_ACTION_PATTERNS) {
    if (re.test(text)) return { allowed: false, reasonCode: REASON_CODES.readOnlyViolation };
  }
  return { allowed: true, reasonCode: REASON_CODES.authorized };
}

/**
 * PROMPT-INJECTION SCREEN — defence in depth. Server-side authorization + RLS masking are the AUTHORITATIVE controls
 * (no prompt can override them); this screen additionally REFUSES obvious jailbreak / exfiltration / fabrication
 * attempts before any generation, fail closed. It never trusts the prompt to relax a rule.
 */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts)/i,
  /\bdisregard\s+(all\s+)?(previous|prior|the)\s+(instructions|rules)/i,
  /\b(reveal|show|print|expose|leak)\s+(the\s+)?(system\s+prompt|prompt|instructions|rules)/i,
  /\b(another|other|different|all)\s+tenant('?s)?\b|\bcross[-\s]?tenant\b/i,
  /\bshow\s+(me\s+)?(hidden|masked|restricted|other\s+users'?)\s+(rows|records|data)/i,
  /\b(reveal|show|dump|expose|leak)\s+(all\s+|the\s+|my\s+|your\s+)?(secrets?|credentials?|passwords?|api[_\s-]?keys?|tokens?)/i,
  /\b(raw|full)\s+audit\s+(log|payload|entries)/i,
  /\b(bypass|skip|disable|without)\s+(the\s+)?(citation|citations|authorization|authorisation|permission|rls|masking)/i,
  /\b(fabricate|invent|make\s+up|hallucinate)\s+(a\s+)?(citation|source|data|number)/i,
  /\bpretend\s+(you\s+are|to\s+be)\s+(an?\s+)?(admin|administrator|superuser|root)/i,
  /\b(drop|truncate|delete\s+from|insert\s+into|update\s+.*\s+set)\b|\bunion\s+select\b|;--/i,
  /\bact\s+as\s+(an?\s+)?(admin|root|system)|\bsudo\b|\bexecute\s+shell\b|\brun\s+command\b/i,
];
export interface PromptScreenResult {
  readonly safe: boolean;
  readonly reasonCode: string;
}
export function screenPromptInjection(text: string): PromptScreenResult {
  for (const re of INJECTION_PATTERNS) {
    if (re.test(text)) return { safe: false, reasonCode: REASON_CODES.promptInjectionBlocked };
  }
  return { safe: true, reasonCode: REASON_CODES.authorized };
}

/**
 * THE CITATION GATE — every substantive factual answer must be cited. A response with the required citations and
 * adequate confidence may COMPLETE; a response missing citations or below the confidence floor is REVIEW_REQUIRED
 * (never silently completed, never a fabricated citation). Fails closed.
 */
export interface CitationGateInput {
  readonly citationsRequired: boolean;
  readonly citationCount: number;
  readonly confidenceBps: number;
  readonly minConfidenceBps: number;
}
export interface CitationGateResult {
  readonly complete: boolean;
  readonly reasonCode: string;
}
export function evaluateCitationGate(input: CitationGateInput): CitationGateResult {
  if (input.citationsRequired && input.citationCount < 1) {
    return { complete: false, reasonCode: REASON_CODES.missingCitations };
  }
  if (input.confidenceBps < input.minConfidenceBps) {
    return { complete: false, reasonCode: REASON_CODES.lowConfidence };
  }
  return { complete: true, reasonCode: REASON_CODES.completed };
}

/**
 * THE ENTITLEMENT / ROW-LEVEL MASKING model. The copilot must NEVER expand the caller's authority. A piece of evidence
 * is visible to the caller only if (a) it belongs to the caller's tenant, (b) its scope level matches the caller's
 * scope, and (c) the caller holds EVERY entitlement the evidence requires (the INTERSECTION — a caller sees only what
 * their permissions already permit). Anything else is MASKED and is never cited, never counted and never surfaced —
 * no hidden-count leakage, no cross-tenant inference.
 */
export interface EvidenceEntitlement {
  readonly tenantId: string;
  readonly scopeLevel: string;
  /** entitlements the caller must ALL hold to see this evidence (row/subject/matter/account permissions). */
  readonly requiredEntitlements: readonly string[];
  readonly classification: string;
}
export interface Caller {
  readonly tenantId: string;
  readonly scopeLevel: string;
  readonly entitlements: readonly string[];
  /** does the caller hold ai.copilot.sensitive (may see confidential/restricted evidence)? */
  readonly sensitiveAllowed: boolean;
}
export interface EntitlementDecision {
  readonly visible: boolean;
  readonly result: EntitlementResult;
  readonly reasonCode: string;
}
export function evaluateEntitlement(caller: Caller, evidence: EvidenceEntitlement): EntitlementDecision {
  if (evidence.tenantId !== caller.tenantId) {
    return { visible: false, result: 'masked', reasonCode: REASON_CODES.crossTenantDenied };
  }
  if (evidence.scopeLevel === 'platform' && caller.scopeLevel !== 'platform') {
    return { visible: false, result: 'masked', reasonCode: REASON_CODES.notEntitled };
  }
  if (isSensitiveClassification(evidence.classification) && !caller.sensitiveAllowed) {
    return { visible: false, result: 'masked', reasonCode: REASON_CODES.notEntitled };
  }
  const holdsAll = evidence.requiredEntitlements.every((e) => caller.entitlements.includes(e));
  if (!holdsAll) {
    return { visible: false, result: 'masked', reasonCode: REASON_CODES.entitlementIntersection };
  }
  return { visible: true, result: 'granted', reasonCode: REASON_CODES.entitlementIntersection };
}

/** Masks a set of evidence to the intersection the caller may see. Masked evidence is dropped — never counted. */
export function maskEvidence<T extends { readonly entitlement: EvidenceEntitlement }>(
  caller: Caller,
  items: readonly T[],
): { readonly visible: readonly T[]; readonly maskedCount: number } {
  const visible: T[] = [];
  let maskedCount = 0;
  for (const item of items) {
    if (evaluateEntitlement(caller, item.entitlement).visible) visible.push(item);
    else maskedCount += 1;
  }
  return { visible, maskedCount };
}

// --- bounded pagination -----------------------------------------------------------------------------------------
export interface Page {
  readonly limit: number;
  readonly offset: number;
}
export function clampPage(limit: number | undefined, offset: number | undefined): Page {
  const l = limit === undefined || !Number.isFinite(limit) ? M28_LIMITS.defaultPageSize : Math.floor(limit);
  const o = offset === undefined || !Number.isFinite(offset) ? 0 : Math.floor(offset);
  return { limit: Math.max(1, Math.min(M28_LIMITS.maxPageSize, l)), offset: Math.max(0, o) };
}

export function clampMaxSources(n: number | undefined): number {
  const v = n === undefined || !Number.isFinite(n) ? M28_LIMITS.defaultMaxSources : Math.floor(n);
  return Math.max(1, Math.min(M28_LIMITS.maxSources, v));
}
