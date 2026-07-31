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
  ITEM_TYPES,
  isItemType,
  RECOMMENDATION_STATUSES,
  isRecommendationStatus,
  checkRunTransition,
  checkExceptionTransition,
  checkCertificationTransition,
  checkItemTransition,
  isExceptionOpen,
  // balance engine (m20's own) + reused m15a line engine
  calculatedClosingMinor,
  aggregateByDirection,
  reconcileBalance,
  assertMinorUnits,
  balances,
  sumMinor,
  scoreCandidate,
  bestCandidate,
  classifyMatchType,
  GlBalanceError,
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
const gl = (o: Partial<MatchableLine>): MatchableLine => ({
  id: 'g1',
  amountMinor: 10000,
  direction: 'debit',
  date: '2026-01-10',
  reference: 'JE-001',
  description: 'accrual reversal',
  ...o,
});
const src = (o: Partial<MatchableLine>): MatchableLine => ({
  id: 's1',
  amountMinor: 10000,
  direction: 'credit',
  date: '2026-01-10',
  reference: 'JE-001',
  description: 'accrual reversal',
  ...o,
});

export default defineSuite('m20-glrecon', (t) => {
  // --- vocabulary -------------------------------------------------------------------------------
  t.equal(RULE_KINDS.length, 5, 'five rule kinds (reused from m15a)');
  t.ok(isRuleKind('exact_amount') && !isRuleKind('vibes'), 'rule kind recognized');
  t.equal(CONFIDENCE_BANDS.length, 5, 'five confidence bands');
  t.ok(isConfidenceBand('exact') && !isConfidenceBand('perfect'), 'band recognized');
  t.equal(COLOUR_STATUS.exact, 'dark_green', 'exact is dark green');
  t.equal(MATCH_TYPES.length, 6, 'six match types');
  t.ok(isMatchType('grouped') && !isMatchType('magic'), 'match type recognized');
  t.equal(DIRECTIONS.length, 2, 'two directions');
  t.ok(isDirection('debit') && !isDirection('sideways'), 'direction recognized');
  t.equal(EXCEPTION_TYPES.length, 11, 'eleven GL exception types');
  t.ok(
    isExceptionType('closing_balance_mismatch') && !isExceptionType('gremlin'),
    'exception type recognized',
  );
  t.equal(ITEM_TYPES.length, 6, 'six reconciling-item types');
  t.ok(isItemType('timing_difference') && !isItemType('nonsense'), 'item type recognized');
  t.equal(RECOMMENDATION_STATUSES.length, 3, 'three recommendation statuses (draft-only handoff)');
  t.ok(
    isRecommendationStatus('handed_off') && !isRecommendationStatus('posted'),
    'a recommendation can never be "posted" — m20 never posts',
  );

  // --- lifecycles -------------------------------------------------------------------------------
  t.ok(checkRunTransition('draft', 'running').ok, 'run draft -> running');
  t.ok(checkRunTransition('running', 'review_required').ok, 'run running -> review_required');
  t.ok(checkRunTransition('review_required', 'completed').ok, 'run review_required -> completed');
  t.ok(!checkRunTransition('draft', 'completed').ok, 'run cannot jump draft -> completed');
  t.ok(checkRunTransition('completed', 'reopened').ok, 'a completed run can reopen');
  t.ok(checkExceptionTransition('open', 'under_review').ok, 'exception open -> under_review');
  t.ok(checkExceptionTransition('under_review', 'resolved').ok, 'exception under_review -> resolved');
  t.ok(!checkExceptionTransition('resolved', 'open').ok, 'a resolved exception cannot reopen');
  t.ok(
    isExceptionOpen('open') && isExceptionOpen('under_review'),
    'open + under_review both block completion',
  );
  t.ok(checkCertificationTransition('draft', 'certified').ok, 'certification draft -> certified');
  t.ok(!checkCertificationTransition('certified', 'rejected').ok, 'a certified balance is terminal');
  t.ok(checkItemTransition('open', 'cleared').ok, 'reconciling item open -> cleared');

  // --- the GL balance invariant (deterministic, exact minor units) ------------------------------
  t.equal(calculatedClosingMinor(1000, 500, 200), 1300, 'closing = opening + debits - credits (exact)');
  t.equal(calculatedClosingMinor(-500, 0, 300), -800, 'the invariant holds for negative balances');
  const aggregated = aggregateByDirection([
    { amountMinor: 500, direction: 'debit' },
    { amountMinor: 300, direction: 'debit' },
    { amountMinor: 200, direction: 'credit' },
  ]);
  t.equal(aggregated.debitsMinor, 800, 'debits aggregate in exact minor units');
  t.equal(aggregated.creditsMinor, 200, 'credits aggregate in exact minor units');
  t.throws(() => assertMinorUnits(100.5, 'x'), 'a float amount is rejected (no float money)');
  t.throws(
    () => aggregateByDirection([{ amountMinor: 10.5, direction: 'debit' }]),
    'a float line amount fails the aggregation closed',
  );

  const balanced = reconcileBalance({
    openingMinor: 1000,
    debitsMinor: 500,
    creditsMinor: 200,
    sourceClosingMinor: 1300,
  });
  t.ok(balanced.balanced && balanced.varianceMinor === 0, 'a matching source closing balances exactly');
  t.equal(balanced.reasonCode, 'balance_exact', 'balanced -> reason balance_exact');
  const off = reconcileBalance({
    openingMinor: 1000,
    debitsMinor: 500,
    creditsMinor: 200,
    sourceClosingMinor: 1350,
  });
  t.ok(!off.balanced && off.varianceMinor === 50, 'an out-of-balance source has an exact integer variance');
  t.equal(off.reasonCode, 'source_exceeds_gl', 'a higher source closing -> source_exceeds_gl');
  const within = reconcileBalance({
    openingMinor: 1000,
    debitsMinor: 500,
    creditsMinor: 200,
    sourceClosingMinor: 1305,
    toleranceMinor: 10,
  });
  t.equal(within.reasonCode, 'balance_within_tolerance', 'a variance inside tolerance is explained');
  t.throws(
    () =>
      reconcileBalance({ openingMinor: 1000, debitsMinor: 500, creditsMinor: 200, sourceClosingMinor: 1.5 }),
    'a float source closing is rejected',
  );
  t.ok(new GlBalanceError('X', 'y') instanceof Error, 'GlBalanceError is an Error');

  // reproducible: same inputs => identical balance reconciliation
  const a = reconcileBalance({
    openingMinor: 1000,
    debitsMinor: 500,
    creditsMinor: 200,
    sourceClosingMinor: 1350,
  });
  const b = reconcileBalance({
    openingMinor: 1000,
    debitsMinor: 500,
    creditsMinor: 200,
    sourceClosingMinor: 1350,
  });
  t.deepEqual(a, b, 'balance reconciliation is reproducible (same inputs => identical output)');

  // --- minor-unit balancing for grouped/split matches -------------------------------------------
  t.equal(sumMinor([3000, 3000, 4000]), 10000, 'minor-unit sum is exact integer');
  t.ok(balances([10000], [6000, 4000]), 'a split balances when minor-unit sums are equal');
  t.ok(!balances([10000], [6000, 3000]), 'an unbalanced split is rejected');

  // --- deterministic line matching (reuses the m15a engine) -------------------------------------
  const exact = scoreCandidate(gl({}), src({}), RULESET);
  t.equal(exact.score, 100, 'a perfect GL/source candidate scores 100');
  t.equal(exact.confidenceBand, 'exact', 'perfect amount + reference + opposite direction => exact band');
  t.equal(exact.amountVarianceMinor, 0, 'zero amount variance');
  t.ok(
    exact.reasonCodes.includes('amount_exact') && exact.reasonCodes.includes('reference_exact'),
    'reason codes explain the match',
  );
  t.equal(scoreCandidate(gl({}), src({}), RULESET).score, exact.score, 'scoring is reproducible');
  const fuzzy = scoreCandidate(gl({ reference: 'X' }), src({ reference: 'Y', amountMinor: 9000 }), RULESET);
  t.ok(fuzzy.score < 100 && fuzzy.confidenceBand !== 'exact', 'a mismatched candidate is never exact');
  t.equal(classifyMatchType(1, 1), 'one_to_one', '1:1');
  t.equal(classifyMatchType(1, 3), 'one_to_many', '1:many');
  t.equal(classifyMatchType(3, 1), 'many_to_one', 'many:1');
  const best = bestCandidate(
    gl({}),
    [src({ id: 's2', reference: 'Z' }), src({ id: 's1' }), src({ id: 's3', amountMinor: 9990 })],
    RULESET,
  );
  t.equal(best?.ledgerEntryId, 's1', 'the exact source line is chosen as best (deterministic)');
});
