import { defineSuite } from '@finapp/test-runner';
import {
  RULE_KINDS,
  isRuleKind,
  CONFIDENCE_BANDS,
  isConfidenceBand,
  COLOUR_STATUS,
  MATCH_TYPES,
  isMatchType,
  DIRECTIONS,
  isDirection,
  EXCEPTION_TYPES,
  isExceptionType,
  MatchingError,
  assertMinorUnits,
  amountVarianceMinor,
  dateVarianceDays,
  scoreCandidate,
  confidenceOf,
  classifyMatchType,
  sumMinor,
  balances,
  bestCandidate,
  type Ruleset,
  type MatchableLine,
} from '../src/index.ts';

const RULESET: Ruleset = {
  version: 1,
  dateWindowDays: 5,
  amountToleranceMinor: 0,
  requireOppositeDirection: true,
  rules: [
    { code: 'AMT', kind: 'exact_amount', weight: 50 },
    { code: 'REF', kind: 'exact_reference', weight: 30 },
    { code: 'DATE', kind: 'date_window', weight: 10 },
    { code: 'DESC', kind: 'similarity', weight: 10 },
  ],
};
const stmt = (o: Partial<MatchableLine>): MatchableLine => ({
  id: 's1',
  amountMinor: 10000,
  direction: 'credit',
  date: '2026-01-10',
  reference: 'INV-001',
  description: 'acme payment invoice',
  ...o,
});
const ledg = (o: Partial<MatchableLine>): MatchableLine => ({
  id: 'l1',
  amountMinor: 10000,
  direction: 'debit',
  date: '2026-01-10',
  reference: 'INV-001',
  description: 'acme invoice payment',
  ...o,
});

export default defineSuite('m15a-matching', (t) => {
  // --- vocabulary -------------------------------------------------------------------------------
  t.equal(RULE_KINDS.length, 5, 'five rule kinds');
  t.ok(
    isRuleKind('exact_amount') && isRuleKind('date_window') && !isRuleKind('vibes'),
    'rule kind recognized',
  );
  t.equal(CONFIDENCE_BANDS.length, 5, 'five confidence bands');
  t.ok(
    isConfidenceBand('exact') && isConfidenceBand('unmatched') && !isConfidenceBand('perfect'),
    'band recognized',
  );
  t.equal(COLOUR_STATUS.exact, 'dark_green', 'exact is dark green');
  t.equal(COLOUR_STATUS.unmatched, 'red', 'unmatched is red');
  t.equal(MATCH_TYPES.length, 6, 'six match types');
  t.ok(isMatchType('split') && isMatchType('grouped') && !isMatchType('magic'), 'match type recognized');
  t.equal(DIRECTIONS.length, 2, 'two directions');
  t.ok(isDirection('debit') && !isDirection('sideways'), 'direction recognized');
  t.equal(EXCEPTION_TYPES.length, 6, 'six exception types');
  t.ok(isExceptionType('amount_mismatch') && !isExceptionType('gremlin'), 'exception type recognized');

  // --- integer-minor-unit money (NO float) ------------------------------------------------------
  t.equal(assertMinorUnits(10000, 'x'), 10000, 'integer minor units accepted');
  t.throws(() => assertMinorUnits(100.5, 'x'), 'a float amount is rejected (no float money)');
  t.throws(() => assertMinorUnits('100', 'x'), 'a string amount is rejected');
  t.equal(amountVarianceMinor(10000, 9950), 50, 'amount variance is exact integer');
  t.equal(dateVarianceDays('2026-01-10', '2026-01-13'), 3, 'date variance in whole days');

  // --- deterministic scoring --------------------------------------------------------------------
  const exact = scoreCandidate(stmt({}), ledg({}), RULESET);
  t.equal(exact.score, 100, 'a perfect candidate scores 100');
  t.equal(exact.confidenceBand, 'exact', 'perfect amount + reference + opposite direction => exact band');
  t.equal(exact.colourStatus, 'dark_green', 'exact is dark green');
  t.equal(exact.amountVarianceMinor, 0, 'zero amount variance');
  t.ok(
    exact.reasonCodes.includes('amount_exact') && exact.reasonCodes.includes('reference_exact'),
    'reason codes explain the match',
  );
  // reproducible: same inputs => identical score
  t.equal(scoreCandidate(stmt({}), ledg({}), RULESET).score, exact.score, 'scoring is reproducible');

  const fuzzy = scoreCandidate(
    stmt({ reference: 'INV-999', amountMinor: 10000 }),
    ledg({ reference: 'XYZ', date: '2026-01-12' }),
    RULESET,
  );
  t.ok(fuzzy.score < 100 && fuzzy.confidenceBand !== 'exact', 'a mismatched reference is never exact');
  t.equal(fuzzy.referenceMatch, 'none', 'reference mismatch detected');

  const wrongDir = scoreCandidate(stmt({}), ledg({ direction: 'credit' }), RULESET);
  t.ok(
    !wrongDir.directionCompatible && wrongDir.reasonCodes.includes('direction_mismatch'),
    'incompatible direction penalised + explained',
  );
  t.ok(wrongDir.score < exact.score, 'direction mismatch lowers the score');

  const amtOff = scoreCandidate(stmt({}), ledg({ amountMinor: 9000 }), RULESET);
  t.ok(
    amtOff.amountVarianceMinor === 1000 && amtOff.confidenceBand !== 'exact',
    'amount variance blocks exact',
  );

  // --- confidence bands -------------------------------------------------------------------------
  t.equal(confidenceOf(100, 0, 'exact', true), 'exact', 'gated exact');
  t.equal(
    confidenceOf(100, 0, 'partial', true),
    'strong',
    'high score without exact ref is strong, not exact',
  );
  t.equal(confidenceOf(60, 50, 'partial', true), 'partial', 'mid score is partial');
  t.equal(confidenceOf(30, 50, 'none', true), 'review', 'low score is review');
  t.equal(confidenceOf(10, 999, 'none', false), 'unmatched', 'very low is unmatched');

  // --- match types + split/grouped balancing ----------------------------------------------------
  t.equal(classifyMatchType(1, 1), 'one_to_one', '1:1');
  t.equal(classifyMatchType(1, 3), 'one_to_many', '1:many');
  t.equal(classifyMatchType(3, 1), 'many_to_one', 'many:1');
  t.equal(classifyMatchType(2, 2), 'many_to_many', 'many:many');
  t.throws(() => classifyMatchType(0, 1), 'a match needs a member each side');
  t.equal(sumMinor([3000, 3000, 4000]), 10000, 'minor-unit sum is exact integer');
  t.ok(balances([10000], [3000, 3000, 4000]), 'a split matches when minor-unit sums are equal');
  t.ok(!balances([10000], [3000, 3000, 3000]), 'an unbalanced split is rejected');

  // --- best candidate is deterministic ----------------------------------------------------------
  const best = bestCandidate(
    stmt({}),
    [ledg({ id: 'l2', reference: 'X' }), ledg({ id: 'l1' }), ledg({ id: 'l3', amountMinor: 9990 })],
    RULESET,
  );
  t.equal(best?.ledgerEntryId, 'l1', 'the exact ledger entry is chosen as best');
  t.ok(new MatchingError('X', 'y') instanceof Error, 'MatchingError is an Error');
});
