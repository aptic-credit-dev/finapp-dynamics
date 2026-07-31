/**
 * The M20 GL-reconciliation state machines — PURE transition checkers, the single choke points for reconciliation
 * runs, matches, matching rulesets, reconciling items, exceptions and balance certifications. Callers fail closed on
 * `!ok`. A run cannot auto-complete with unresolved REQUIRED exceptions, and a balance cannot be certified over open
 * blockers without a privileged override (enforced in the services using these machines + the exception state).
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

// --- reconciliation run -----------------------------------------------------------------------
export const RUN_STATUSES = [
  'draft',
  'running',
  'review_required',
  'completed',
  'failed',
  'reopened',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
const RUN_MACHINE: Record<string, string[]> = {
  draft: ['running'],
  running: ['review_required', 'failed', 'draft'],
  review_required: ['completed', 'running'],
  completed: ['reopened'],
  failed: ['reopened', 'draft'],
  reopened: ['running'],
};
export function checkRunTransition(from: string, to: string): TransitionResult {
  return transition(RUN_MACHINE, from, to);
}
export function isRunOpen(s: string): boolean {
  return s !== 'completed';
}

// --- match ------------------------------------------------------------------------------------
export const MATCH_STATUSES = ['proposed', 'confirmed', 'rejected', 'unmatched'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];
const MATCH_MACHINE: Record<string, string[]> = {
  proposed: ['confirmed', 'rejected'],
  confirmed: ['unmatched'],
  rejected: [],
  unmatched: [],
};
export function checkMatchTransition(from: string, to: string): TransitionResult {
  return transition(MATCH_MACHINE, from, to);
}

// --- matching ruleset (versioned spec; immutable-after-publish) -------------------------------
export const RULESET_STATUSES = ['draft', 'active', 'superseded', 'retired'] as const;
export type RulesetStatus = (typeof RULESET_STATUSES)[number];
const RULESET_MACHINE: Record<string, string[]> = {
  draft: ['active', 'retired'],
  active: ['superseded', 'retired'],
  superseded: ['retired'],
  retired: [],
};
export function checkRulesetTransition(from: string, to: string): TransitionResult {
  return transition(RULESET_MACHINE, from, to);
}
/** A published (active or beyond) ruleset is immutable — change = a new version. */
export function isRulesetFrozen(s: string): boolean {
  return s === 'active' || s === 'superseded' || s === 'retired';
}

// --- reconciling item -------------------------------------------------------------------------
export const ITEM_STATUSES = ['open', 'cleared', 'waived'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
const ITEM_MACHINE: Record<string, string[]> = {
  open: ['cleared', 'waived'],
  cleared: [],
  waived: [],
};
export function checkItemTransition(from: string, to: string): TransitionResult {
  return transition(ITEM_MACHINE, from, to);
}
export function isItemOpen(s: string): boolean {
  return s === 'open';
}

// --- exception (open -> under_review -> resolved/waived) --------------------------------------
export const EXCEPTION_STATUSES = ['open', 'under_review', 'resolved', 'waived'] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];
const EXCEPTION_MACHINE: Record<string, string[]> = {
  open: ['under_review', 'resolved', 'waived'],
  under_review: ['resolved', 'waived', 'open'],
  resolved: [],
  waived: [],
};
export function checkExceptionTransition(from: string, to: string): TransitionResult {
  return transition(EXCEPTION_MACHINE, from, to);
}
export function isExceptionOpen(s: string): boolean {
  return s === 'open' || s === 'under_review';
}

// --- balance certification (draft -> certified/rejected) --------------------------------------
export const CERTIFICATION_STATUSES = ['draft', 'certified', 'rejected'] as const;
export type CertificationStatus = (typeof CERTIFICATION_STATUSES)[number];
const CERTIFICATION_MACHINE: Record<string, string[]> = {
  draft: ['certified', 'rejected'],
  certified: [],
  rejected: [],
};
export function checkCertificationTransition(from: string, to: string): TransitionResult {
  return transition(CERTIFICATION_MACHINE, from, to);
}
