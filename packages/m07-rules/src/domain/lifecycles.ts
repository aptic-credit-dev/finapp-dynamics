/**
 * Rule-set-version lifecycle — PURE. Mirrors the m06 workflow definition lifecycle in shape (ADR-022): a
 * rule set version is authored in DRAFT, VALIDATED, then PUBLISHED (content FROZEN), ACTIVE (deployed),
 * RETIRED (no new evaluations bound to it), and finally ARCHIVED (terminal). Transitions are DATA;
 * `checkRuleSetTransition` is the single choke point services call — it never throws, it returns the next
 * status or a reason for refusal. Everything here is deterministic and exhaustively provable.
 */

export interface Transition<S extends string, A extends string> {
  readonly from: S;
  readonly action: A;
  readonly to: S;
}

export interface Machine<S extends string, A extends string> {
  readonly statuses: readonly S[];
  readonly initial: S;
  readonly terminal: ReadonlySet<S>;
  readonly transitions: readonly Transition<S, A>[];
}

export type TransitionResult<S extends string> =
  { readonly ok: true; readonly to: S } | { readonly ok: false; readonly reason: string };

/** The one transition checker. Returns the next status or a reason for refusal — never throws. */
export function checkTransition<S extends string, A extends string>(
  machine: Machine<S, A>,
  from: S,
  action: A,
): TransitionResult<S> {
  if (machine.terminal.has(from)) {
    return { ok: false, reason: `'${from}' is terminal; '${action}' is not permitted` };
  }
  const match = machine.transitions.find((tr) => tr.from === from && tr.action === action);
  if (match === undefined) {
    return { ok: false, reason: `'${action}' is not a legal transition from '${from}'` };
  }
  return { ok: true, to: match.to };
}

export const RULESET_STATUSES = ['DRAFT', 'VALIDATED', 'PUBLISHED', 'ACTIVE', 'RETIRED', 'ARCHIVED'] as const;
export type RuleSetStatus = (typeof RULESET_STATUSES)[number];

export const RULESET_ACTIONS = ['validate', 'revise', 'publish', 'activate', 'retire', 'archive'] as const;
export type RuleSetAction = (typeof RULESET_ACTIONS)[number];

export const RULESET_MACHINE: Machine<RuleSetStatus, RuleSetAction> = {
  statuses: RULESET_STATUSES,
  initial: 'DRAFT',
  terminal: new Set<RuleSetStatus>(['ARCHIVED']),
  transitions: [
    { from: 'DRAFT', action: 'validate', to: 'VALIDATED' },
    { from: 'VALIDATED', action: 'revise', to: 'DRAFT' },
    { from: 'VALIDATED', action: 'publish', to: 'PUBLISHED' },
    { from: 'PUBLISHED', action: 'activate', to: 'ACTIVE' },
    { from: 'ACTIVE', action: 'retire', to: 'RETIRED' },
    { from: 'PUBLISHED', action: 'retire', to: 'RETIRED' },
    { from: 'RETIRED', action: 'archive', to: 'ARCHIVED' },
  ],
};

/** Content (the spec) is immutable once a version reaches PUBLISHED — edits happen only in DRAFT. */
export function isRuleSetContentFrozen(status: RuleSetStatus): boolean {
  return status === 'PUBLISHED' || status === 'ACTIVE' || status === 'RETIRED' || status === 'ARCHIVED';
}

export function checkRuleSetTransition(
  from: RuleSetStatus,
  action: RuleSetAction,
): TransitionResult<RuleSetStatus> {
  return checkTransition(RULESET_MACHINE, from, action);
}
