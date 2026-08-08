/**
 * The M29 AI-Governance domain — PURE vocabulary, controlled state machines and the governance gates (HUMAN approval, No
 * AI SELF-APPROVAL, maker != checker, evaluation-evidence, waiver/override). No I/O. M29 is the enterprise oversight
 * layer for the AI lifecycle: it governs AI use cases + policies and the human-approved RELEASE of M24 assets, with
 * evaluation evidence, controlled exceptions, and suspension/withdrawal. THE LOAD-BEARING RULE: AI NEVER APPROVES ITS OWN
 * RELEASE — final release/waiver approval requires a HUMAN who is not the proposer, and (for a non-waiver release) a
 * passing evaluation. M29 governs AI; it performs NO domain action, NO deployment/runtime control and NO controlled
 * action. Confidence/accuracy are INTEGER basis points (0..10000); there is no float and no secret value here.
 */
export class AiGovernanceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AiGovernanceError';
    this.code = code;
  }
}

export const M29_LIMITS = {
  maxConfidenceBps: 10000,
  maxPageSize: 200,
  defaultPageSize: 50,
  maxReasonLength: 2000,
} as const;

// --- data classification (mirrors m24's public contract; gates sensitive governance evidence) ---------------------
export const DATA_CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];
export function isDataClassification(s: string): s is DataClassification {
  return (DATA_CLASSIFICATIONS as readonly string[]).includes(s);
}
export function isSensitiveClassification(s: string): boolean {
  return s === 'confidential' || s === 'restricted';
}

// --- risk tiers -------------------------------------------------------------------------------------------------
export const RISK_TIERS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];
export function isRiskTier(s: string): s is RiskTier {
  return (RISK_TIERS as readonly string[]).includes(s);
}

// --- release subject kinds (what is being released; every one is an M24 asset ref or a waiver) ------------------
export const SUBJECT_KINDS = [
  'model_version',
  'prompt_version',
  'provider_config',
  'policy_version',
  'use_case',
  'waiver_exception',
] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];
export function isSubjectKind(s: string): s is SubjectKind {
  return (SUBJECT_KINDS as readonly string[]).includes(s);
}
export function isWaiver(kind: string): boolean {
  return kind === 'waiver_exception';
}

// --- deployment status (use case) -------------------------------------------------------------------------------
export const DEPLOYMENT_STATUSES = ['proposed', 'approved', 'deployed', 'suspended', 'retired'] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];
export function isDeploymentStatus(s: string): s is DeploymentStatus {
  return (DEPLOYMENT_STATUSES as readonly string[]).includes(s);
}

// --- evaluation result vocab ------------------------------------------------------------------------------------
export const DLP_RESULTS = ['pass', 'block', 'na'] as const;
export const SAFETY_RESULTS = ['pass', 'fail', 'na'] as const;
export const CITATION_RESULTS = ['pass', 'fail', 'na'] as const;
export function isDlpResult(s: string): boolean {
  return (DLP_RESULTS as readonly string[]).includes(s);
}
export function isSafetyResult(s: string): boolean {
  return (SAFETY_RESULTS as readonly string[]).includes(s);
}
export function isCitationResult(s: string): boolean {
  return (CITATION_RESULTS as readonly string[]).includes(s);
}

// --- human decisions --------------------------------------------------------------------------------------------
export const DECISION_KINDS = ['approve', 'reject', 'release', 'suspend', 'withdraw'] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];
export function isDecisionKind(s: string): s is DecisionKind {
  return (DECISION_KINDS as readonly string[]).includes(s);
}

// --- release lifecycle (a HUMAN approves; the model/system never does) ------------------------------------------
export const RELEASE_STATUSES = [
  'draft',
  'assessment',
  'evaluation_pending',
  'review_pending',
  'approved',
  'released',
  'rejected',
  'suspended',
  'withdrawn',
  'superseded',
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];
const RELEASE_MACHINE: Record<string, string[]> = {
  draft: ['assessment', 'withdrawn'],
  assessment: ['evaluation_pending', 'rejected', 'withdrawn'],
  evaluation_pending: ['review_pending', 'rejected', 'withdrawn'],
  review_pending: ['approved', 'rejected', 'withdrawn'], // a HUMAN (not the proposer) approves/rejects — never the model
  approved: ['released', 'suspended', 'withdrawn', 'superseded'],
  released: ['suspended', 'withdrawn', 'superseded'],
  rejected: [],
  suspended: ['released', 'withdrawn', 'superseded'],
  withdrawn: [],
  superseded: [],
};
export function checkReleaseTransition(from: string, to: string): TransitionResult {
  return transition(RELEASE_MACHINE, from, to);
}
export function isReleaseTerminal(s: string): boolean {
  return s === 'rejected' || s === 'withdrawn' || s === 'superseded';
}

// --- waiver lifecycle (a controlled exception; requester != approver; AI cannot approve) ------------------------
export const WAIVER_STATUSES = [
  'draft',
  'review_pending',
  'approved',
  'rejected',
  'withdrawn',
  'expired',
] as const;
export type WaiverStatus = (typeof WAIVER_STATUSES)[number];
const WAIVER_MACHINE: Record<string, string[]> = {
  draft: ['review_pending', 'withdrawn'],
  review_pending: ['approved', 'rejected', 'withdrawn'],
  approved: ['expired', 'withdrawn'],
  rejected: [],
  withdrawn: [],
  expired: [],
};
export function checkWaiverTransition(from: string, to: string): TransitionResult {
  return transition(WAIVER_MACHINE, from, to);
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

// --- ABSOLUTE controls — governance boundaries that can NEVER be waived/overridden (fail closed) -----------------
export const ABSOLUTE_CONTROLS = [
  'no_production_provider',
  'no_secret_storage',
  'no_restricted_data_to_unapproved_provider',
  'no_ai_controlled_action',
  'no_ai_self_approval',
  'human_review_required',
] as const;
export type AbsoluteControl = (typeof ABSOLUTE_CONTROLS)[number];
export function isAbsoluteControl(code: string): boolean {
  return (ABSOLUTE_CONTROLS as readonly string[]).includes(code);
}

// --- spec status (policy) ---------------------------------------------------------------------------------------
export const SPEC_STATUSES = ['draft', 'active', 'superseded', 'retired'] as const;
export type SpecStatus = (typeof SPEC_STATUSES)[number];
export function isSpecFrozen(s: string): boolean {
  return s === 'active' || s === 'superseded' || s === 'retired';
}

// --- reason codes -----------------------------------------------------------------------------------------------
export const REASON_CODES = {
  useCaseRegistered: 'use_case_registered',
  policyPublished: 'policy_published',
  releaseProposed: 'release_proposed',
  assessmentStarted: 'assessment_started',
  evaluationRecorded: 'evaluation_recorded',
  evaluationPassed: 'evaluation_passed',
  evaluationFailed: 'evaluation_failed',
  reviewRequested: 'review_requested',
  releaseApproved: 'release_approved',
  releaseRejected: 'release_rejected',
  releaseReleased: 'release_released',
  releaseSuspended: 'release_suspended',
  releaseWithdrawn: 'release_withdrawn',
  releaseSuperseded: 'release_superseded',
  waiverRequested: 'waiver_requested',
  waiverApproved: 'waiver_approved',
  waiverRejected: 'waiver_rejected',
  waiverExpired: 'waiver_expired',
  // governance refusals (fail closed — no AI self-approval, no self-approval, no evidence, absolute control)
  aiSelfApprovalForbidden: 'ai_self_approval_forbidden',
  selfApprovalForbidden: 'self_approval_forbidden',
  humanApproverRequired: 'human_approver_required',
  evaluationRequired: 'evaluation_required',
  evaluationNotPassed: 'evaluation_not_passed',
  policyViolation: 'policy_violation',
  restrictedProviderBlocked: 'restricted_provider_blocked',
  absoluteControlNotWaivable: 'absolute_control_not_waivable',
  waiverExpiredNoEffect: 'waiver_expired_no_effect',
  staleVersion: 'stale_version',
  duplicateSuppressed: 'duplicate_suppressed',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

// --- confidence / accuracy (integer basis points; never a float) ------------------------------------------------
export function isConfidenceBps(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= M29_LIMITS.maxConfidenceBps;
}

/** A SYSTEM / AI actor can never be the final approver. `null`, blank, or a reserved system id is not a human. */
const SYSTEM_ACTOR_IDS = new Set(['system', 'ai', 'automation', 'service', 'model']);
export function isHumanActor(actor: string | null): actor is string {
  if (actor === null || actor.trim() === '') return false;
  return !SYSTEM_ACTOR_IDS.has(actor.trim().toLowerCase());
}

/**
 * THE NO-AI-SELF-APPROVAL / SEGREGATION-OF-DUTIES GATE for a release or waiver approval. Final approval requires a HUMAN
 * approver (never AI/system, never null) who is NOT the proposer (maker != checker / proposer != approver). Fails CLOSED.
 */
export interface SodGateInput {
  readonly proposedBy: string | null;
  readonly approverId: string | null;
}
export interface SodGateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}
export function evaluateSodGate(input: SodGateInput): SodGateResult {
  if (!isHumanActor(input.approverId)) {
    // A null/blank/system approver — the AI/system may never be the final approver.
    return { allowed: false, reasonCode: REASON_CODES.aiSelfApprovalForbidden };
  }
  if (input.proposedBy !== null && input.approverId === input.proposedBy) {
    return { allowed: false, reasonCode: REASON_CODES.selfApprovalForbidden };
  }
  return { allowed: true, reasonCode: REASON_CODES.releaseApproved };
}

/**
 * THE RELEASE GATE. A non-waiver release can only be APPROVED when: SoD holds (human, non-proposer), a passing evaluation
 * exists, and the policy allows the provider (a restricted provider is blocked unless the policy explicitly allows it —
 * which the DB forbids, so a restricted provider is always blocked). Fails CLOSED.
 */
export interface ReleaseGateInput {
  readonly subjectKind: string;
  readonly proposedBy: string | null;
  readonly approverId: string | null;
  readonly evaluationPassed: boolean;
  readonly providerRestricted: boolean;
  readonly policyAllowsRestrictedProvider: boolean;
}
export interface ReleaseGateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}
export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateResult {
  const sod = evaluateSodGate({ proposedBy: input.proposedBy, approverId: input.approverId });
  if (!sod.allowed) return sod;
  if (!isWaiver(input.subjectKind) && !input.evaluationPassed) {
    return { allowed: false, reasonCode: REASON_CODES.evaluationNotPassed };
  }
  if (input.providerRestricted && !input.policyAllowsRestrictedProvider) {
    return { allowed: false, reasonCode: REASON_CODES.restrictedProviderBlocked };
  }
  return { allowed: true, reasonCode: REASON_CODES.releaseApproved };
}

/**
 * THE WAIVER / OVERRIDE GATE. A waiver is a controlled exception: the requester cannot self-approve, AI cannot approve,
 * and an ABSOLUTE control (no-production-provider, no-secret, no-restricted-data, no-AI-executed-controlled-action) can
 * NEVER be waived. Fails CLOSED.
 */
export interface WaiverGateInput {
  readonly requestedBy: string | null;
  readonly approverId: string | null;
  readonly targetsAbsoluteControl: boolean;
}
export function evaluateWaiverGate(input: WaiverGateInput): SodGateResult {
  if (input.targetsAbsoluteControl) {
    return { allowed: false, reasonCode: REASON_CODES.absoluteControlNotWaivable };
  }
  const sod = evaluateSodGate({ proposedBy: input.requestedBy, approverId: input.approverId });
  if (!sod.allowed) return sod;
  return { allowed: true, reasonCode: REASON_CODES.waiverApproved };
}

/** An evaluation passes only with concrete non-failing results (no "passed" without evidence). */
export interface EvaluationInput {
  readonly dlpResult: string;
  readonly safetyResult: string;
  readonly citationResult: string;
  readonly accuracyBps: number;
  readonly minConfidenceBps: number;
}
export function evaluatePasses(input: EvaluationInput): boolean {
  if (input.dlpResult === 'block') return false;
  if (input.safetyResult === 'fail') return false;
  if (input.citationResult === 'fail') return false;
  if (!isConfidenceBps(input.accuracyBps)) return false;
  return input.accuracyBps >= input.minConfidenceBps;
}

// --- bounded pagination -----------------------------------------------------------------------------------------
export interface Page {
  readonly limit: number;
  readonly offset: number;
}
export function clampPage(limit: number | undefined, offset: number | undefined): Page {
  const l = limit === undefined || !Number.isFinite(limit) ? M29_LIMITS.defaultPageSize : Math.floor(limit);
  const o = offset === undefined || !Number.isFinite(offset) ? 0 : Math.floor(offset);
  return { limit: Math.max(1, Math.min(M29_LIMITS.maxPageSize, l)), offset: Math.max(0, o) };
}
