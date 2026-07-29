/**
 * The M19 finance-foundation state machines — PURE transition checkers, the single choke points every lifecycle
 * object goes through (mirrors m07/m08/m09/m12-m18). Ledger accounts, accounting periods, fiscal years and the
 * versioned finance configuration each have an explicit machine; callers fail closed on `!ok`. Period close/lock
 * is the cross-module gate downstream posting (m21) honours — but m19 never posts. No monetary state here.
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

// --- ledger account ---------------------------------------------------------------------------
const ACCOUNT_MACHINE: Record<string, string[]> = {
  draft: ['active', 'archived'],
  active: ['inactive', 'archived'],
  inactive: ['active', 'archived'],
  archived: [],
};
export function checkAccountTransition(from: string, to: string): TransitionResult {
  return transition(ACCOUNT_MACHINE, from, to);
}
export function isAccountTerminal(s: string): boolean {
  return s === 'archived';
}
/** An account may receive postings (be referenced by a journal line) only while active. */
export function isAccountPostable(status: string): boolean {
  return status === 'active';
}

// --- accounting period ------------------------------------------------------------------------
const PERIOD_MACHINE: Record<string, string[]> = {
  open: ['closed', 'locked'],
  closed: ['open', 'locked'],
  locked: [],
};
export function checkPeriodTransition(from: string, to: string): TransitionResult {
  return transition(PERIOD_MACHINE, from, to);
}
export function isPeriodTerminal(s: string): boolean {
  return s === 'locked';
}

// --- fiscal year ------------------------------------------------------------------------------
const FISCAL_YEAR_MACHINE: Record<string, string[]> = {
  open: ['closed'],
  closed: ['open'],
};
export function checkFiscalYearTransition(from: string, to: string): TransitionResult {
  return transition(FISCAL_YEAR_MACHINE, from, to);
}

// --- finance configuration (versioned spec; immutable-after-publish) --------------------------
export const CONFIG_STATUSES = ['draft', 'active', 'superseded', 'retired'] as const;
export type ConfigStatus = (typeof CONFIG_STATUSES)[number];
const CONFIG_MACHINE: Record<string, string[]> = {
  draft: ['active', 'retired'],
  active: ['superseded', 'retired'],
  superseded: ['retired'],
  retired: [],
};
export function checkConfigTransition(from: string, to: string): TransitionResult {
  return transition(CONFIG_MACHINE, from, to);
}
/** A published (active or beyond) config is immutable — a change is a new version. */
export function isConfigFrozen(s: string): boolean {
  return s === 'active' || s === 'superseded' || s === 'retired';
}
export function isConfigActive(s: string): boolean {
  return s === 'active';
}
