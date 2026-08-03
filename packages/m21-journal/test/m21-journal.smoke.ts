import { defineSuite } from '@finapp/test-runner';
import {
  SOURCE_TYPES,
  isSourceType,
  JOURNAL_TYPE_KINDS,
  isJournalTypeKind,
  DIRECTIONS,
  isDirection,
  LINE_STATUSES,
  isLineStatus,
  PERIOD_STATUSES,
  isPeriodStatus,
  CONFIDENCE_BANDS,
  isConfidenceBand,
  NOTE_TYPES,
  isNoteType,
  REASON_SEVERITIES,
  REASON_CATEGORIES,
  REASON_CODES,
  ALL_REASON_CODES,
  DRAFT_STATUSES,
  checkDraftTransition,
  isDraftEditable,
  isDraftTerminal,
  RECOMMENDATION_STATUSES,
  checkRecommendationTransition,
  SPEC_STATUSES,
  checkSpecTransition,
  isSpecFrozen,
  POSTING_REQUEST_STATUSES,
  checkPostingRequestTransition,
  POSTING_RESULT_STATUSES,
  checkPostingResultTransition,
  computeBalance,
  validateDraft,
  sumMinor,
  assertMinorUnits,
  JournalEngineError,
  ALL_M21_PERMISSIONS,
  M21_PRIVILEGED_PERMISSIONS,
  ALL_M21_AUDIT_CODES,
  JOURNAL_AUDIT_PREFIX,
} from '../src/index.ts';

const line = (
  o: Partial<{
    id: string;
    accountRef: string | null;
    direction: string;
    amountMinor: number;
    currencyRef: string | null;
    status: string;
  }>,
) => ({
  id: 'l1',
  accountRef: 'acct-1',
  direction: 'debit',
  amountMinor: 10000,
  currencyRef: 'KES',
  status: 'active',
  ...o,
});

export default defineSuite('m21-journal', (t) => {
  // --- vocabulary -------------------------------------------------------------------------------
  t.equal(SOURCE_TYPES.length, 4, 'four recommendation/draft source types');
  t.ok(isSourceType('gl_reconciliation') && !isSourceType('telepathy'), 'source type recognized');
  t.equal(JOURNAL_TYPE_KINDS.length, 5, 'five journal type kinds');
  t.ok(isJournalTypeKind('accrual') && !isJournalTypeKind('vibes'), 'journal type kind recognized');
  t.equal(DIRECTIONS.length, 2, 'two directions (double-entry)');
  t.ok(isDirection('debit') && isDirection('credit') && !isDirection('sideways'), 'direction recognized');
  t.equal(LINE_STATUSES.length, 2, 'two line statuses (active/removed; no DELETE)');
  t.ok(isLineStatus('removed') && !isLineStatus('deleted'), 'line status recognized');
  t.equal(PERIOD_STATUSES.length, 3, 'three period states (open/closed/locked)');
  t.ok(isPeriodStatus('closed') && !isPeriodStatus('ajar'), 'period status recognized');
  t.equal(CONFIDENCE_BANDS.length, 5, 'five confidence bands (matches m20 handoff)');
  t.ok(isConfidenceBand('exact') && !isConfidenceBand('perfect'), 'confidence band recognized');
  t.equal(NOTE_TYPES.length, 5, 'five note types');
  t.ok(isNoteType('validation') && !isNoteType('gossip'), 'note type recognized');
  t.equal(REASON_SEVERITIES.length, 3, 'three reason severities');
  t.equal(REASON_CATEGORIES.length, 6, 'six reason categories');

  // --- reason codes (deterministic, explainable) ------------------------------------------------
  t.equal(REASON_CODES.balanced.code, 'balanced', 'the success reason code is balanced');
  t.equal(REASON_CODES.unbalanced.code, 'unbalanced', 'unbalanced reason code');
  t.equal(REASON_CODES.closedPeriod.code, 'closed_period', 'closed_period reason code');
  t.equal(REASON_CODES.duplicatePosting.code, 'duplicate_posting', 'duplicate_posting reason code');
  const reasonCodeList: readonly string[] = ALL_REASON_CODES;
  t.ok(
    reasonCodeList.includes('single_sided') && reasonCodeList.includes('float_amount'),
    'reason code vocabulary is complete',
  );
  t.ok(!reasonCodeList.includes('posted'), 'there is no "posted" success — m21 never posts in validation');

  // --- draft lifecycle --------------------------------------------------------------------------
  t.equal(DRAFT_STATUSES.length, 5, 'five draft statuses');
  t.ok(checkDraftTransition('draft', 'validated').ok, 'draft -> validated');
  t.ok(checkDraftTransition('validated', 'submitted').ok, 'validated -> submitted');
  t.ok(checkDraftTransition('validated', 'draft').ok, 'validated -> draft (editing invalidates)');
  t.ok(
    !checkDraftTransition('draft', 'submitted').ok,
    'a draft cannot jump straight to submitted (validate first)',
  );
  t.ok(!checkDraftTransition('draft', 'posted').ok, 'a draft can never jump to posted');
  t.ok(
    checkDraftTransition('submitted', 'posted').ok,
    'submitted -> posted (post-MVP, after approval + posting)',
  );
  t.ok(!checkDraftTransition('withdrawn', 'draft').ok, 'a withdrawn draft is terminal');
  t.ok(isDraftEditable('draft') && !isDraftEditable('submitted'), 'only a draft is editable');
  t.ok(
    isDraftTerminal('posted') && isDraftTerminal('withdrawn') && !isDraftTerminal('draft'),
    'posted/withdrawn are terminal',
  );

  // --- recommendation lifecycle -----------------------------------------------------------------
  t.equal(RECOMMENDATION_STATUSES.length, 4, 'four recommendation statuses');
  t.ok(checkRecommendationTransition('proposed', 'accepted').ok, 'proposed -> accepted');
  t.ok(checkRecommendationTransition('accepted', 'converted').ok, 'accepted -> converted');
  t.ok(
    !checkRecommendationTransition('proposed', 'converted').ok,
    'a proposed recommendation must be accepted before conversion',
  );
  t.ok(!checkRecommendationTransition('dismissed', 'accepted').ok, 'a dismissed recommendation is terminal');

  // --- spec (type/config) + posting lifecycles --------------------------------------------------
  t.equal(SPEC_STATUSES.length, 4, 'four spec statuses (type/config)');
  t.ok(checkSpecTransition('draft', 'active').ok, 'spec draft -> active');
  t.ok(isSpecFrozen('active') && !isSpecFrozen('draft'), 'a published spec is frozen');
  t.equal(POSTING_REQUEST_STATUSES.length, 6, 'six posting-request statuses');
  t.ok(checkPostingRequestTransition('prepared', 'ready').ok, 'posting request prepared -> ready');
  t.ok(checkPostingRequestTransition('ready', 'submitted').ok, 'posting request ready -> submitted');
  t.ok(
    !checkPostingRequestTransition('prepared', 'submitted').ok,
    'a prepared request cannot skip authorization',
  );
  t.ok(checkPostingRequestTransition('failed', 'ready').ok, 'a failed request can retry');
  t.ok(
    !checkPostingRequestTransition('succeeded', 'ready').ok,
    'a succeeded request is terminal (no re-post)',
  );
  t.equal(POSTING_RESULT_STATUSES.length, 3, 'three posting-result statuses');
  t.ok(checkPostingResultTransition('pending', 'succeeded').ok, 'posting result pending -> succeeded');
  t.ok(!checkPostingResultTransition('succeeded', 'failed').ok, 'a succeeded result is terminal');

  // --- exact-money balance engine ---------------------------------------------------------------
  t.throws(() => {
    assertMinorUnits(100.5, 'x');
  }, 'a float amount is rejected (no float money)');
  t.ok(new JournalEngineError('X', 'y') instanceof Error, 'JournalEngineError is an Error');
  t.equal(sumMinor([3000, 3000, 4000]), 10000, 'minor-unit sum is exact integer');
  t.throws(() => sumMinor([10.5]), 'a float in a sum fails closed');
  const bal = computeBalance([
    line({ direction: 'debit', amountMinor: 10000 }),
    line({ id: 'l2', direction: 'credit', amountMinor: 10000 }),
  ]);
  t.ok(bal.balanced && bal.varianceMinor === 0, 'equal debits and credits balance exactly');
  t.equal(bal.debitsMinor, 10000, 'debits aggregate in exact minor units');
  const off = computeBalance([
    line({ direction: 'debit', amountMinor: 10000 }),
    line({ id: 'l2', direction: 'credit', amountMinor: 9000 }),
  ]);
  t.ok(
    !off.balanced && off.varianceMinor === 1000,
    'an out-of-balance journal has an exact integer variance',
  );
  const removed = computeBalance([
    line({ direction: 'debit', amountMinor: 10000 }),
    line({ id: 'l2', direction: 'credit', amountMinor: 10000, status: 'removed' }),
  ]);
  t.equal(removed.creditsMinor, 0, 'a removed line drops out of the balance');

  // --- deterministic, explainable validation ----------------------------------------------------
  const balanced = validateDraft({
    entityRef: 'e1',
    currencyRef: 'KES',
    periodStatus: 'open',
    lines: [
      line({ id: 'l1', direction: 'debit', amountMinor: 10000 }),
      line({ id: 'l2', direction: 'credit', amountMinor: 10000 }),
    ],
  });
  t.ok(balanced.isValid && balanced.balanced, 'a balanced, open-period journal validates');
  t.ok(
    balanced.findings.some((f) => f.reasonCode === 'balanced'),
    'a valid journal reports the balanced reason code',
  );
  const unbalanced = validateDraft({
    entityRef: 'e1',
    currencyRef: 'KES',
    periodStatus: 'open',
    lines: [
      line({ id: 'l1', direction: 'debit', amountMinor: 10000 }),
      line({ id: 'l2', direction: 'credit', amountMinor: 9000 }),
    ],
  });
  t.ok(
    !unbalanced.isValid && unbalanced.findings.some((f) => f.reasonCode === 'unbalanced'),
    'an unbalanced journal is rejected with a reason code',
  );
  const noLines = validateDraft({ entityRef: 'e1', currencyRef: 'KES', periodStatus: 'open', lines: [] });
  t.ok(
    !noLines.isValid && noLines.findings.some((f) => f.reasonCode === 'no_lines'),
    'a journal with no lines is rejected',
  );
  const singleSided = validateDraft({
    entityRef: 'e1',
    currencyRef: 'KES',
    periodStatus: 'open',
    lines: [line({ id: 'l1', direction: 'debit', amountMinor: 10000 })],
  });
  t.ok(
    !singleSided.isValid && singleSided.findings.some((f) => f.reasonCode === 'single_sided'),
    'a single-sided journal is rejected',
  );
  const closed = validateDraft({
    entityRef: 'e1',
    currencyRef: 'KES',
    periodStatus: 'closed',
    lines: [
      line({ id: 'l1', direction: 'debit', amountMinor: 10000 }),
      line({ id: 'l2', direction: 'credit', amountMinor: 10000 }),
    ],
  });
  t.ok(
    !closed.isValid && closed.findings.some((f) => f.reasonCode === 'closed_period'),
    'a journal in a closed period is rejected (no posting into a closed period)',
  );
  const locked = validateDraft({
    entityRef: 'e1',
    currencyRef: 'KES',
    periodStatus: 'locked',
    lines: [
      line({ id: 'l1', direction: 'debit', amountMinor: 10000 }),
      line({ id: 'l2', direction: 'credit', amountMinor: 10000 }),
    ],
  });
  t.ok(
    locked.findings.some((f) => f.reasonCode === 'locked_period'),
    'a journal in a locked period is rejected',
  );
  const noAccount = validateDraft({
    entityRef: 'e1',
    currencyRef: 'KES',
    periodStatus: 'open',
    lines: [
      line({ id: 'l1', accountRef: null, direction: 'debit', amountMinor: 10000 }),
      line({ id: 'l2', direction: 'credit', amountMinor: 10000 }),
    ],
  });
  t.ok(
    noAccount.findings.some((f) => f.reasonCode === 'unknown_account'),
    'a line with no account is rejected',
  );
  const noEntity = validateDraft({
    entityRef: null,
    currencyRef: 'KES',
    periodStatus: 'open',
    lines: [
      line({ id: 'l1', direction: 'debit', amountMinor: 10000 }),
      line({ id: 'l2', direction: 'credit', amountMinor: 10000 }),
    ],
  });
  t.ok(
    noEntity.findings.some((f) => f.reasonCode === 'missing_entity'),
    'a journal with no entity is rejected',
  );
  const mismatch = validateDraft({
    entityRef: 'e1',
    currencyRef: 'KES',
    periodStatus: 'open',
    lines: [
      line({ id: 'l1', direction: 'debit', amountMinor: 10000, currencyRef: 'USD' }),
      line({ id: 'l2', direction: 'credit', amountMinor: 10000, currencyRef: 'KES' }),
    ],
  });
  t.ok(
    mismatch.findings.some((f) => f.reasonCode === 'currency_mismatch'),
    'a line currency mismatch is rejected',
  );
  const dup = validateDraft({
    entityRef: 'e1',
    currencyRef: 'KES',
    periodStatus: 'open',
    alreadyPosted: true,
    lines: [
      line({ id: 'l1', direction: 'debit', amountMinor: 10000 }),
      line({ id: 'l2', direction: 'credit', amountMinor: 10000 }),
    ],
  });
  t.ok(
    !dup.isValid && dup.findings.some((f) => f.reasonCode === 'duplicate_posting'),
    'an already-posted draft is rejected (no duplicate posting)',
  );
  const nonPos = validateDraft({
    entityRef: 'e1',
    currencyRef: 'KES',
    periodStatus: 'open',
    lines: [
      line({ id: 'l1', direction: 'debit', amountMinor: 0 }),
      line({ id: 'l2', direction: 'credit', amountMinor: 10000 }),
    ],
  });
  t.ok(
    nonPos.findings.some((f) => f.reasonCode === 'non_positive_amount'),
    'a non-positive line amount is rejected',
  );
  const floaty = validateDraft({
    entityRef: 'e1',
    currencyRef: 'KES',
    periodStatus: 'open',
    lines: [
      line({ id: 'l1', direction: 'debit', amountMinor: 100.5 }),
      line({ id: 'l2', direction: 'credit', amountMinor: 10000 }),
    ],
  });
  t.ok(
    floaty.findings.some((f) => f.reasonCode === 'float_amount'),
    'a float line amount is rejected (no float money)',
  );

  // reproducible: same input => identical validation output
  const a = validateDraft({
    entityRef: 'e1',
    currencyRef: 'KES',
    periodStatus: 'open',
    lines: [
      line({ id: 'l1', direction: 'debit', amountMinor: 10000 }),
      line({ id: 'l2', direction: 'credit', amountMinor: 9000 }),
    ],
  });
  const b = validateDraft({
    entityRef: 'e1',
    currencyRef: 'KES',
    periodStatus: 'open',
    lines: [
      line({ id: 'l1', direction: 'debit', amountMinor: 10000 }),
      line({ id: 'l2', direction: 'credit', amountMinor: 9000 }),
    ],
  });
  t.deepEqual(a, b, 'validation is reproducible (same input => identical output)');

  // --- permissions + audit codes ----------------------------------------------------------------
  t.equal(ALL_M21_PERMISSIONS.length, 27, 'm21 declares 27 permissions');
  t.equal(M21_PRIVILEGED_PERMISSIONS.length, 9, 'm21 has 9 privileged permissions');
  t.ok(
    ALL_M21_PERMISSIONS.every((p) => p.startsWith('journals.') && p.split('.').length === 3),
    'every permission is a 3-segment journals.* code',
  );
  const privList: readonly string[] = M21_PRIVILEGED_PERMISSIONS;
  const permList: readonly string[] = ALL_M21_PERMISSIONS;
  t.ok(privList.includes('journals.posting_request.create'), 'posting_request.create is privileged');
  t.ok(
    !permList.includes('journals.draft.approve'),
    'there is no journals.draft.approve — m21 never approves',
  );
  t.ok(!permList.includes('journals.draft.post'), 'there is no journals.draft.post — m21 never posts');
  t.equal(ALL_M21_AUDIT_CODES.length, 23, 'm21 declares 23 audit codes');
  t.ok(
    ALL_M21_AUDIT_CODES.every((c) => c.startsWith(JOURNAL_AUDIT_PREFIX) && c.split('_').length >= 3),
    'every audit code is JOURNAL_ SCREAMING_SNAKE with >= 3 segments',
  );
  t.ok(new Set(ALL_M21_AUDIT_CODES).size === ALL_M21_AUDIT_CODES.length, 'no audit code is declared twice');
});
