/**
 * The M22 approval-workflow state machines — PURE transition checkers, the SINGLE choke points for the approval
 * request, its per-request steps, versioned policy/config specs and delegations. Callers fail closed on `!ok`. There
 * is NO direct status mutation anywhere else in the module: every status change goes through a service that consults
 * one of these machines, records append-only history, and CAS-guards the write. Terminal states (approved / rejected
 * / cancelled) have no outgoing edges — terminal-state protection. Controlled resubmission is the single
 * `returned -> draft|pending` edge; controlled cancellation is the `-> cancelled` edge from every non-terminal state.
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

// --- approval request (the one aggregate / choke point) ----------------------------------------
export const REQUEST_STATUSES = [
  'draft',
  'pending',
  'escalated',
  'returned',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
const REQUEST_MACHINE: Record<string, string[]> = {
  draft: ['pending', 'cancelled'],
  pending: ['approved', 'rejected', 'returned', 'escalated', 'cancelled'],
  escalated: ['approved', 'rejected', 'returned', 'cancelled'], // escalation is resolved by a decision
  returned: ['draft', 'pending', 'cancelled'], // controlled resubmission where allowed
  approved: [],
  rejected: [],
  cancelled: [],
};
export function checkRequestTransition(from: string, to: string): TransitionResult {
  return transition(REQUEST_MACHINE, from, to);
}
/** A request is still actionable (a decision can land) only while pending or escalated. */
export function isRequestActionable(s: string): boolean {
  return s === 'pending' || s === 'escalated';
}
/** Terminal states — no further transitions (terminal-state protection). */
export function isRequestTerminal(s: string): boolean {
  return s === 'approved' || s === 'rejected' || s === 'cancelled';
}

// --- per-request step --------------------------------------------------------------------------
export const STEP_STATUSES = ['pending', 'approved', 'rejected', 'skipped', 'escalated'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
const STEP_MACHINE: Record<string, string[]> = {
  pending: ['approved', 'rejected', 'skipped', 'escalated'],
  escalated: ['approved', 'rejected', 'skipped'],
  approved: [],
  rejected: [],
  skipped: [],
};
export function checkStepTransition(from: string, to: string): TransitionResult {
  return transition(STEP_MACHINE, from, to);
}
export function isStepTerminal(s: string): boolean {
  return s === 'approved' || s === 'rejected' || s === 'skipped';
}

// --- versioned spec (policy / config; immutable-after-publish) ----------------------------------
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
/** A published (active or beyond) policy/config is immutable — change = a new version. */
export function isSpecFrozen(s: string): boolean {
  return s === 'active' || s === 'superseded' || s === 'retired';
}

// --- delegation --------------------------------------------------------------------------------
export const DELEGATION_STATUSES = ['active', 'revoked', 'expired'] as const;
export type DelegationStatus = (typeof DELEGATION_STATUSES)[number];
const DELEGATION_MACHINE: Record<string, string[]> = {
  active: ['revoked', 'expired'],
  revoked: [],
  expired: [],
};
export function checkDelegationTransition(from: string, to: string): TransitionResult {
  return transition(DELEGATION_MACHINE, from, to);
}
