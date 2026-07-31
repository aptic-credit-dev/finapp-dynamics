/**
 * The PURE, deterministic GL BALANCE engine (m20's own logic) + the shared LINE-matching engine (REUSED from
 * @finapp/m15a-matching — m20 never duplicates the matching algorithm). This module owns only the general-ledger
 * balance invariant and the balance-reconciliation classification: given opening balance, aggregated debits and
 * credits (all INTEGER MINOR UNITS), it computes the calculated closing (opening + debits − credits), compares it to
 * the source closing, and returns the exact variance with a machine-readable reason. Same inputs => same output (no
 * ambient clock, no randomness, no float money). Line matching (score/confidence band/reason codes) delegates to the
 * m15a engine so there is exactly one matching implementation in the platform.
 */
import {
  assertMinorUnits,
  scoreCandidate,
  bestCandidate,
  confidenceOf,
  classifyMatchType,
  sumMinor,
  balances,
  amountVarianceMinor,
  dateVarianceDays,
  type MatchableLine,
  type Ruleset,
  type CandidateScore,
} from '@finapp/m15a-matching';

// Re-export the REUSED m15a line-matching engine so consumers import one surface (never a second copy).
export {
  assertMinorUnits,
  scoreCandidate,
  bestCandidate,
  confidenceOf,
  classifyMatchType,
  sumMinor,
  balances,
  amountVarianceMinor,
  dateVarianceDays,
};
export type { MatchableLine, Ruleset, CandidateScore };

export class GlBalanceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'GlBalanceError';
    this.code = code;
  }
}

/** A GL line reduced to what the balance aggregation needs. Money is INTEGER MINOR UNITS. */
export interface DirectionalAmount {
  readonly amountMinor: number;
  readonly direction: 'debit' | 'credit';
}

/**
 * Aggregate directional amounts into total debits + credits, in EXACT INTEGER MINOR UNITS. Every amount is validated
 * as integer minor units (a float fails closed) — the sums never pass through a binary float.
 */
export function aggregateByDirection(lines: readonly DirectionalAmount[]): {
  debitsMinor: number;
  creditsMinor: number;
} {
  let debitsMinor = 0;
  let creditsMinor = 0;
  for (const line of lines) {
    const amt = assertMinorUnits(line.amountMinor, 'gl line amount');
    if (line.direction === 'debit') debitsMinor += amt;
    else creditsMinor += amt;
  }
  return { debitsMinor, creditsMinor };
}

/**
 * THE GL BALANCE INVARIANT (deterministic, exact minor units): calculated closing = opening + debits − credits. This
 * is the single sign convention m20 uses (also DB-enforced by gl_balance_invariant_ck / gl_run_balance_invariant_ck).
 */
export function calculatedClosingMinor(
  openingMinor: number,
  debitsMinor: number,
  creditsMinor: number,
): number {
  return (
    assertMinorUnits(openingMinor, 'opening') +
    assertMinorUnits(debitsMinor, 'debits') -
    assertMinorUnits(creditsMinor, 'credits')
  );
}

export interface BalanceReconciliation {
  readonly openingMinor: number;
  readonly debitsMinor: number;
  readonly creditsMinor: number;
  readonly calculatedClosingMinor: number;
  readonly sourceClosingMinor: number;
  /** sourceClosing − calculatedClosing, exact integer minor units (positive => source is higher). */
  readonly varianceMinor: number;
  readonly balanced: boolean;
  readonly reasonCode: string;
}

/**
 * Reconcile a GL balance against a source closing balance. Deterministic + explainable: computes the calculated
 * closing from the invariant, the exact variance against the source, whether it balances (variance == 0), and a
 * stable reason code. A tolerance of 0 means an EXACT match is required; a positive tolerance (from a ruleset) allows
 * a bounded absolute variance — never a float, always integer minor units.
 */
export function reconcileBalance(input: {
  openingMinor: number;
  debitsMinor: number;
  creditsMinor: number;
  sourceClosingMinor: number;
  toleranceMinor?: number;
}): BalanceReconciliation {
  const openingMinor = assertMinorUnits(input.openingMinor, 'opening');
  const debitsMinor = assertMinorUnits(input.debitsMinor, 'debits');
  const creditsMinor = assertMinorUnits(input.creditsMinor, 'credits');
  const sourceClosingMinor = assertMinorUnits(input.sourceClosingMinor, 'source closing');
  const tolerance = assertMinorUnits(input.toleranceMinor ?? 0, 'tolerance');
  if (tolerance < 0) throw new GlBalanceError('BAD_TOLERANCE', 'tolerance cannot be negative');

  const calc = calculatedClosingMinor(openingMinor, debitsMinor, creditsMinor);
  const varianceMinor = sourceClosingMinor - calc;
  const absVariance = varianceMinor < 0 ? -varianceMinor : varianceMinor;
  const balanced = varianceMinor === 0;
  const reasonCode = balanced
    ? 'balance_exact'
    : absVariance <= tolerance
      ? 'balance_within_tolerance'
      : varianceMinor > 0
        ? 'source_exceeds_gl'
        : 'gl_exceeds_source';

  return {
    openingMinor,
    debitsMinor,
    creditsMinor,
    calculatedClosingMinor: calc,
    sourceClosingMinor,
    varianceMinor,
    balanced,
    reasonCode,
  };
}
