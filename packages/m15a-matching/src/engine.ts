/**
 * The PURE, deterministic, EXPLAINABLE matching engine. Given a statement line, a candidate ledger entry and a
 * versioned ruleset, it returns a reproducible score, confidence band, colour status, the exact variances (money in
 * INTEGER MINOR UNITS), the reference/description comparison and machine-readable reason codes. Same inputs + same
 * ruleset version => same output (no ambient clock, no randomness, no float money). AI suggestions (m27) are a
 * SEPARATE optional layer — this engine stands alone.
 */
import {
  MatchingError,
  amountVarianceMinor,
  dateVarianceDays,
  assertMinorUnits,
  type ConfidenceBand,
  type MatchType,
  COLOUR_STATUS,
  isRuleKind,
} from './domain.ts';

/** A line to be matched — either a bank statement line or a book/ledger entry. Money is integer minor units. */
export interface MatchableLine {
  readonly id: string;
  readonly amountMinor: number;
  readonly direction: 'debit' | 'credit';
  readonly date: string; // ISO YYYY-MM-DD
  readonly reference?: string;
  readonly description?: string;
}

export interface MatchRuleConfig {
  readonly code: string;
  readonly kind: string;
  readonly weight: number; // integer points this rule contributes at full strength
}

export interface Ruleset {
  readonly version: number;
  readonly dateWindowDays: number;
  readonly amountToleranceMinor: number;
  readonly requireOppositeDirection: boolean;
  readonly rules: readonly MatchRuleConfig[];
}

export interface CandidateScore {
  readonly statementLineId: string;
  readonly ledgerEntryId: string;
  readonly score: number; // integer 0..100
  readonly confidenceBand: ConfidenceBand;
  readonly colourStatus: string;
  readonly amountVarianceMinor: number;
  readonly dateVarianceDays: number;
  readonly referenceMatch: 'exact' | 'partial' | 'none';
  readonly descriptionScore: number; // ratio 0..1 (text similarity, not money)
  readonly directionCompatible: boolean;
  readonly reasonCodes: readonly string[];
  readonly ruleCodes: readonly string[];
}

function normalizeRef(v: string | undefined): string {
  return (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function tokens(v: string | undefined): Set<string> {
  return new Set(
    (v ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((tok) => tok.length > 1),
  );
}
/** Jaccard token similarity in [0,1]. Text ratio, deterministic — NOT money. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function referenceMatch(a: string | undefined, b: string | undefined): 'exact' | 'partial' | 'none' {
  const na = normalizeRef(a);
  const nb = normalizeRef(b);
  if (na === '' || nb === '') return 'none';
  if (na === nb) return 'exact';
  if (na.includes(nb) || nb.includes(na)) return 'partial';
  return 'none';
}

/**
 * Score a single statement line against a single ledger entry under a ruleset. Deterministic + explainable. The
 * `exact` band is reserved for a zero amount-variance AND an exact reference match; anything else is capped below.
 */
export function scoreCandidate(
  statement: MatchableLine,
  ledger: MatchableLine,
  ruleset: Ruleset,
): CandidateScore {
  assertMinorUnits(statement.amountMinor, 'statement amount');
  assertMinorUnits(ledger.amountMinor, 'ledger amount');
  const variance = amountVarianceMinor(statement.amountMinor, ledger.amountMinor);
  const dateVar = dateVarianceDays(statement.date, ledger.date);
  const refMatch = referenceMatch(statement.reference, ledger.reference);
  const descScore = jaccard(tokens(statement.description), tokens(ledger.description));
  const directionCompatible = ruleset.requireOppositeDirection
    ? statement.direction !== ledger.direction
    : statement.direction === ledger.direction;

  const reasons: string[] = [];
  const ruleCodes: string[] = [];
  let score = 0;

  for (const rule of ruleset.rules) {
    if (!isRuleKind(rule.kind)) throw new MatchingError('INVALID_RULE', `unknown rule kind "${rule.kind}"`);
    if (rule.kind === 'composite') continue; // composite is the sum itself
    ruleCodes.push(rule.code);
    const w = Number.isInteger(rule.weight) && rule.weight >= 0 ? rule.weight : 0;
    switch (rule.kind) {
      case 'exact_amount':
        if (variance === 0) {
          score += w;
          reasons.push('amount_exact');
        } else if (variance <= ruleset.amountToleranceMinor) {
          score += Math.round(w / 2);
          reasons.push('amount_within_tolerance');
        } else {
          reasons.push('amount_mismatch');
        }
        break;
      case 'exact_reference':
        if (refMatch === 'exact') {
          score += w;
          reasons.push('reference_exact');
        } else if (refMatch === 'partial') {
          score += Math.round(w / 2);
          reasons.push('reference_partial');
        } else {
          reasons.push('reference_none');
        }
        break;
      case 'date_window':
        if (dateVar === 0) {
          score += w;
          reasons.push('date_same');
        } else if (ruleset.dateWindowDays > 0 && dateVar <= ruleset.dateWindowDays) {
          score += Math.round((w * (ruleset.dateWindowDays - dateVar)) / ruleset.dateWindowDays);
          reasons.push('date_within_window');
        } else {
          reasons.push('date_out_of_window');
        }
        break;
      case 'similarity':
        score += Math.round(w * descScore);
        if (descScore > 0) reasons.push('description_similar');
        break;
    }
  }

  if (!directionCompatible) {
    reasons.push('direction_mismatch');
    score = Math.round(score / 2);
  }
  score = Math.max(0, Math.min(100, score));

  const band = confidenceOf(score, variance, refMatch, directionCompatible);
  return {
    statementLineId: statement.id,
    ledgerEntryId: ledger.id,
    score,
    confidenceBand: band,
    colourStatus: COLOUR_STATUS[band],
    amountVarianceMinor: variance,
    dateVarianceDays: dateVar,
    referenceMatch: refMatch,
    descriptionScore: descScore,
    directionCompatible,
    reasonCodes: reasons,
    ruleCodes,
  };
}

/**
 * Map a score to a confidence band. `exact` is a QUALITATIVE determination — a zero amount variance AND an exact
 * reference match AND a compatible direction definitively identify the transaction, regardless of soft signals like
 * description similarity (so a real exact match is not demoted just because a narrative differs). A high FUZZY score
 * alone (without the exact amount + reference) never certifies an exact match.
 */
export function confidenceOf(
  score: number,
  amountVariance: number,
  refMatch: 'exact' | 'partial' | 'none',
  directionCompatible: boolean,
): ConfidenceBand {
  if (amountVariance === 0 && refMatch === 'exact' && directionCompatible) return 'exact';
  if (score >= 80) return 'strong';
  if (score >= 50) return 'partial';
  if (score >= 25) return 'review';
  return 'unmatched';
}

/** Classify a match's cardinality from the number of statement vs ledger members. */
export function classifyMatchType(statementCount: number, ledgerCount: number): MatchType {
  if (statementCount < 1 || ledgerCount < 1)
    throw new MatchingError('EMPTY_MATCH', 'a match needs >=1 line each side');
  if (statementCount === 1 && ledgerCount === 1) return 'one_to_one';
  if (statementCount === 1 && ledgerCount > 1) return 'one_to_many';
  if (statementCount > 1 && ledgerCount === 1) return 'many_to_one';
  return 'many_to_many';
}

/** Sum of minor-unit amounts (integer). Used to certify a split/grouped match balances exactly. */
export function sumMinor(amounts: readonly number[]): number {
  return amounts.reduce((acc, a) => acc + assertMinorUnits(a, 'amount'), 0);
}

/** A split/grouped match balances when the two sides' minor-unit sums are equal (exact; no float). */
export function balances(statementAmounts: readonly number[], ledgerAmounts: readonly number[]): boolean {
  return sumMinor(statementAmounts) === sumMinor(ledgerAmounts);
}

/**
 * Pick the best candidate for a statement line from many ledger entries: highest score, ties broken by lowest
 * amount variance then lowest date variance then lowest ledger id (fully deterministic).
 */
export function bestCandidate(
  statement: MatchableLine,
  ledgers: readonly MatchableLine[],
  ruleset: Ruleset,
): CandidateScore | null {
  let best: CandidateScore | null = null;
  for (const ledger of ledgers) {
    const c = scoreCandidate(statement, ledger, ruleset);
    if (
      best === null ||
      c.score > best.score ||
      (c.score === best.score && c.amountVarianceMinor < best.amountVarianceMinor) ||
      (c.score === best.score &&
        c.amountVarianceMinor === best.amountVarianceMinor &&
        c.dateVarianceDays < best.dateVarianceDays) ||
      (c.score === best.score &&
        c.amountVarianceMinor === best.amountVarianceMinor &&
        c.dateVarianceDays === best.dateVarianceDays &&
        c.ledgerEntryId < best.ledgerEntryId)
    ) {
      best = c;
    }
  }
  return best;
}
