/**
 * The M24 AI-foundation domain — PURE vocabulary, state machines, the confidence/citation gates and the approved-
 * provider routing decision. No I/O, so it is exhaustively unit-tested and shared by the services, the DB CHECKs
 * (mirrored) and the contracts. M24 is the GOVERNED AI layer: AI assists (summarise / classify / recommend) with
 * confidence + citations; it NEVER approves, posts, files or executes a controlled action, and NEVER routes restricted
 * data to an unapproved provider. Confidence is an INTEGER basis-points score (0..10000) — never a binary float.
 */
export class AiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AiError';
    this.code = code;
  }
}

export const M24_LIMITS = {
  maxConfidenceBps: 10000,
  maxPageSize: 200,
  defaultPageSize: 50,
  maxReasonLength: 2000,
} as const;

// --- data classification (drives DLP + approved-provider routing) ------------------------------
export const DATA_CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];
export function isDataClassification(s: string): s is DataClassification {
  return (DATA_CLASSIFICATIONS as readonly string[]).includes(s);
}

// --- provider / model / prompt / policy spec status --------------------------------------------
export const SPEC_STATUSES = ['draft', 'active', 'superseded', 'retired'] as const;
export type SpecStatus = (typeof SPEC_STATUSES)[number];
export function isSpecFrozen(s: string): boolean {
  return s === 'active' || s === 'superseded' || s === 'retired';
}

// --- AI request lifecycle ----------------------------------------------------------------------
export const REQUEST_STATUSES = [
  'received',
  'dlp_checked',
  'routed',
  'generating',
  'generated',
  'review_pending',
  'completed',
  'rejected',
  'failed',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
const REQUEST_MACHINE: Record<string, string[]> = {
  received: ['dlp_checked', 'rejected', 'cancelled'],
  dlp_checked: ['routed', 'rejected', 'cancelled'], // DLP must clear before routing (no restricted data to unapproved provider)
  routed: ['generating', 'failed', 'cancelled'],
  generating: ['generated', 'failed'],
  generated: ['review_pending', 'failed'],
  review_pending: ['completed', 'rejected'], // a HUMAN completes/rejects — never the model
  completed: [],
  rejected: [],
  failed: [],
  cancelled: [],
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
export function checkRequestTransition(from: string, to: string): TransitionResult {
  return transition(REQUEST_MACHINE, from, to);
}
export function isRequestTerminal(s: string): boolean {
  return s === 'completed' || s === 'rejected' || s === 'failed' || s === 'cancelled';
}

// --- AI output lifecycle (an output is a RECOMMENDATION; a human approves) ----------------------
export const OUTPUT_STATUSES = ['draft', 'validated', 'review_pending', 'approved', 'rejected'] as const;
export type OutputStatus = (typeof OUTPUT_STATUSES)[number];
const OUTPUT_MACHINE: Record<string, string[]> = {
  draft: ['validated', 'rejected'],
  validated: ['review_pending', 'rejected'],
  review_pending: ['approved', 'rejected'], // 'approved' requires a human reviewer + (where required) citations
  approved: [],
  rejected: [],
};
export function checkOutputTransition(from: string, to: string): TransitionResult {
  return transition(OUTPUT_MACHINE, from, to);
}
export function isOutputTerminal(s: string): boolean {
  return s === 'approved' || s === 'rejected';
}

// --- output kinds (assistive only — never a controlled action) ---------------------------------
export const OUTPUT_KINDS = ['summary', 'classification', 'extraction', 'recommendation', 'answer'] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];
export function isOutputKind(s: string): s is OutputKind {
  return (OUTPUT_KINDS as readonly string[]).includes(s);
}

// --- DLP actions -------------------------------------------------------------------------------
export const DLP_ACTIONS = ['allow', 'redact', 'block'] as const;
export type DlpAction = (typeof DLP_ACTIONS)[number];

// --- reason codes ------------------------------------------------------------------------------
export const REASON_CODES = {
  received: 'request_received',
  dlpCleared: 'dlp_cleared',
  dlpBlocked: 'dlp_blocked',
  routedApproved: 'routed_to_approved_provider',
  unapprovedProvider: 'unapproved_provider_for_classification',
  generated: 'output_generated',
  humanApproved: 'human_approved',
  humanRejected: 'human_rejected',
  lowConfidence: 'low_confidence',
  missingCitations: 'missing_required_citations',
  autonomousActionForbidden: 'autonomous_action_forbidden',
  duplicateSuppressed: 'duplicate_suppressed',
  staleVersion: 'stale_version',
  cancelled: 'request_cancelled',
  failed: 'request_failed',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

// --- confidence (integer basis points; never a float) ------------------------------------------
export function isConfidenceBps(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= M24_LIMITS.maxConfidenceBps;
}

/**
 * The approved-provider ROUTING decision (deterministic). Restricted/confidential data may only route to a provider
 * explicitly APPROVED for that classification; public/internal may use any active approved provider. Fails CLOSED.
 */
export interface RoutingInput {
  readonly classification: string;
  readonly providerApproved: boolean;
  readonly providerClassifications: readonly string[];
  readonly providerActive: boolean;
}
export interface RoutingResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}
export function evaluateRouting(input: RoutingInput): RoutingResult {
  if (!input.providerActive || !input.providerApproved) {
    return { allowed: false, reasonCode: REASON_CODES.unapprovedProvider };
  }
  const gated = input.classification === 'restricted' || input.classification === 'confidential';
  if (gated && !input.providerClassifications.includes(input.classification)) {
    return { allowed: false, reasonCode: REASON_CODES.unapprovedProvider };
  }
  return { allowed: true, reasonCode: REASON_CODES.routedApproved };
}

/**
 * The human-approval GATE for an AI output. An output can only be approved by a HUMAN reviewer, and — where the output
 * requires citations — only with at least one source citation. Fails CLOSED (no autonomous approval).
 */
export interface ApprovalGateInput {
  readonly reviewerId: string | null;
  readonly citationsRequired: boolean;
  readonly citationCount: number;
}
export interface ApprovalGateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}
export function evaluateApprovalGate(input: ApprovalGateInput): ApprovalGateResult {
  if (input.reviewerId === null || input.reviewerId.trim() === '') {
    return { allowed: false, reasonCode: REASON_CODES.autonomousActionForbidden };
  }
  if (input.citationsRequired && input.citationCount < 1) {
    return { allowed: false, reasonCode: REASON_CODES.missingCitations };
  }
  return { allowed: true, reasonCode: REASON_CODES.humanApproved };
}

// --- secret reference (a provider holds a pointer, never a secret) -----------------------------
export const SECRET_REFERENCE_PATTERN = /^secretref:[A-Za-z0-9_.:/-]{3,200}$/;
export function isSecretReference(s: string): boolean {
  return SECRET_REFERENCE_PATTERN.test(s);
}

// --- bounded pagination ------------------------------------------------------------------------
export interface Page {
  readonly limit: number;
  readonly offset: number;
}
export function clampPage(limit: number | undefined, offset: number | undefined): Page {
  const l = limit === undefined || !Number.isFinite(limit) ? M24_LIMITS.defaultPageSize : Math.floor(limit);
  const o = offset === undefined || !Number.isFinite(offset) ? 0 : Math.floor(offset);
  return { limit: Math.max(1, Math.min(M24_LIMITS.maxPageSize, l)), offset: Math.max(0, o) };
}
