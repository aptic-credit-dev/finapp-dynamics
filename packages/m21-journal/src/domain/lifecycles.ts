/**
 * The M21 journal-engine state machines — PURE transition checkers, the single choke points for draft journals,
 * recommendations, journal types/config, posting requests and posting results. Callers fail closed on `!ok`. A draft
 * can only leave 'draft' once balanced (enforced by the service + the DB balanced-before-advance CHECK). A posting
 * request can only leave 'prepared' with an m22 approval reference (no posting without approval), never targets a
 * closed/locked period, and its approver is never its requester (SoD) — enforced in the service using these machines
 * + the DB CHECKs. m21 NEVER approves or posts; posting is deferred (draft-first MVP).
 */
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

// --- draft journal ----------------------------------------------------------------------------
export const DRAFT_STATUSES = ['draft', 'validated', 'submitted', 'posted', 'withdrawn'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];
const DRAFT_MACHINE: Record<string, string[]> = {
  draft: ['validated', 'withdrawn'],
  validated: ['draft', 'submitted', 'withdrawn'], // editing a validated draft returns it to 'draft'
  submitted: ['posted', 'withdrawn'], // 'posted' is post-MVP (m23/m33); reachable only after approval + posting
  posted: [],
  withdrawn: [],
};
export function checkDraftTransition(from: string, to: string): TransitionResult {
  return transition(DRAFT_MACHINE, from, to);
}
/** A draft is still editable only in 'draft' (editing a 'validated' draft first reverts it to 'draft'). */
export function isDraftEditable(s: string): boolean {
  return s === 'draft';
}
/** Terminal states — no further transitions. */
export function isDraftTerminal(s: string): boolean {
  return s === 'posted' || s === 'withdrawn';
}

// --- recommendation ---------------------------------------------------------------------------
export const RECOMMENDATION_STATUSES = ['proposed', 'accepted', 'dismissed', 'converted'] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];
const RECOMMENDATION_MACHINE: Record<string, string[]> = {
  proposed: ['accepted', 'dismissed'],
  accepted: ['converted', 'dismissed'],
  converted: [],
  dismissed: [],
};
export function checkRecommendationTransition(from: string, to: string): TransitionResult {
  return transition(RECOMMENDATION_MACHINE, from, to);
}

// --- journal type / config (versioned spec; immutable-after-publish) --------------------------
export const SPEC_STATUSES = ['draft', 'active', 'superseded', 'retired'] as const;
export type SpecStatus = (typeof SPEC_STATUSES)[number];
const SPEC_MACHINE: Record<string, string[]> = {
  draft: ['active', 'retired'],
  active: ['superseded', 'retired'],
  superseded: ['retired'],
  retired: [],
};
export function checkSpecTransition(from: string, to: string): TransitionResult {
  return transition(SPEC_MACHINE, from, to);
}
/** A published (active or beyond) type/config is immutable — change = a new version. */
export function isSpecFrozen(s: string): boolean {
  return s === 'active' || s === 'superseded' || s === 'retired';
}

// --- posting request (DRAFT-first; posting deferred) ------------------------------------------
export const POSTING_REQUEST_STATUSES = [
  'prepared',
  'ready',
  'submitted',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type PostingRequestStatus = (typeof POSTING_REQUEST_STATUSES)[number];
const POSTING_REQUEST_MACHINE: Record<string, string[]> = {
  prepared: ['ready', 'cancelled'],
  ready: ['submitted', 'cancelled'],
  submitted: ['succeeded', 'failed'],
  succeeded: [],
  failed: ['ready', 'cancelled'], // a failed attempt may be retried once the cause is fixed
  cancelled: [],
};
export function checkPostingRequestTransition(from: string, to: string): TransitionResult {
  return transition(POSTING_REQUEST_MACHINE, from, to);
}

// --- posting result ---------------------------------------------------------------------------
export const POSTING_RESULT_STATUSES = ['pending', 'succeeded', 'failed'] as const;
export type PostingResultStatus = (typeof POSTING_RESULT_STATUSES)[number];
const POSTING_RESULT_MACHINE: Record<string, string[]> = {
  pending: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
};
export function checkPostingResultTransition(from: string, to: string): TransitionResult {
  return transition(POSTING_RESULT_MACHINE, from, to);
}
