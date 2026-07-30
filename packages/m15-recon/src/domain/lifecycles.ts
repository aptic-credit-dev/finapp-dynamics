/**
 * The M15 reconciliation state machines — PURE transition checkers, the single choke points for reconciliation
 * runs, matches, matching rulesets and exceptions. Callers fail closed on `!ok`. A run cannot auto-complete with
 * unresolved REQUIRED exceptions (enforced in the service using this machine + the exception state).
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
export const RUN_STATUSES = ['draft', 'matching', 'review', 'completed', 'reopened'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
const RUN_MACHINE: Record<string, string[]> = {
  draft: ['matching'],
  matching: ['review', 'draft'],
  review: ['completed', 'matching'],
  completed: ['reopened'],
  reopened: ['matching'],
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

// --- exception --------------------------------------------------------------------------------
export const EXCEPTION_STATUSES = ['open', 'resolved', 'waived'] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];
const EXCEPTION_MACHINE: Record<string, string[]> = {
  open: ['resolved', 'waived'],
  resolved: [],
  waived: [],
};
export function checkExceptionTransition(from: string, to: string): TransitionResult {
  return transition(EXCEPTION_MACHINE, from, to);
}
export function isExceptionOpen(s: string): boolean {
  return s === 'open';
}
