import { defineSuite } from '@finapp/test-runner';
import {
  M27_LIMITS,
  FinanceAiError,
  FINANCE_CLASSIFICATIONS,
  isFinanceClassification,
  SUBJECT_TYPES,
  isSubjectType,
  ANALYSIS_KINDS,
  isAnalysisKind,
  SUGGESTION_TYPES,
  isSuggestionType,
  EXCEPTION_CATEGORIES,
  isExceptionCategory,
  FEATURE_TYPES,
  isFeatureType,
  EVIDENCE_SOURCES,
  isEvidenceSource,
  ANALYSIS_STATUSES,
  checkAnalysisTransition,
  isAnalysisTerminal,
  SUGGESTION_STATUSES,
  checkSuggestionTransition,
  isSuggestionTerminal,
  SPEC_STATUSES,
  isSpecFrozen,
  REVIEW_DECISIONS,
  isReviewDecision,
  decisionToState,
  REASON_CODES,
  ALL_REASON_CODES,
  isConfidenceBps,
  isMinorUnits,
  evaluateReviewGate,
  clampPage,
  ALL_M27_PERMISSIONS,
  M27_PERMISSIONS,
  M27_PRIVILEGED_PERMISSIONS,
  ALL_M27_AUDIT_CODES,
  AI_FINANCE_AUDIT_PREFIX,
} from '../src/index.ts';

export default defineSuite('m27-finance-ai', (t) => {
  // --- classification -------------------------------------------------------------------------
  t.equal(FINANCE_CLASSIFICATIONS.length, 4, 'four data classifications');
  t.ok(
    isFinanceClassification('restricted') && !isFinanceClassification('cosmic'),
    'classification recognized',
  );

  // --- subject types (opaque m15/m20 recon refs) ----------------------------------------------
  t.equal(SUBJECT_TYPES.length, 2, 'two subject types (bank_recon, gl_recon)');
  t.ok(
    isSubjectType('bank_recon') && isSubjectType('gl_recon') && !isSubjectType('payroll'),
    'subject type recognized',
  );

  // --- analysis kinds (controlled; no executable finance action) ------------------------------
  t.equal(ANALYSIS_KINDS.length, 6, 'six analysis kinds');
  t.ok(
    isAnalysisKind('match_suggestion') &&
      isAnalysisKind('anomaly_detection') &&
      isAnalysisKind('journal_recommendation'),
    'analysis kinds recognized',
  );
  t.ok(
    !isAnalysisKind('post_journal') && !isAnalysisKind('approve') && !isAnalysisKind('reconcile'),
    'no analysis kind is a controlled finance action',
  );

  // --- suggestion types (explainable match categories; advisory) ------------------------------
  t.equal(SUGGESTION_TYPES.length, 12, 'twelve explainable suggestion categories');
  t.ok(
    isSuggestionType('exact_reference_match') &&
      isSuggestionType('split_match') &&
      isSuggestionType('anomaly_flag'),
    'suggestion types recognized',
  );
  t.ok(
    !isSuggestionType('post') && !isSuggestionType('approve_match'),
    'no suggestion type is a controlled finance action',
  );

  // --- exception categories + features + evidence ---------------------------------------------
  t.equal(EXCEPTION_CATEGORIES.length, 7, 'seven exception categories');
  t.ok(
    isExceptionCategory('timing_difference') && !isExceptionCategory('fraud'),
    'exception category recognized',
  );
  t.equal(FEATURE_TYPES.length, 6, 'six feature types');
  t.ok(
    isFeatureType('reference') && isFeatureType('amount') && !isFeatureType('vibe'),
    'feature type recognized',
  );
  t.equal(EVIDENCE_SOURCES.length, 5, 'five evidence sources');
  t.ok(isEvidenceSource('bank_line') && isEvidenceSource('gl_line'), 'evidence sources recognized');

  // --- analysis lifecycle (a HUMAN reviewer decides) ------------------------------------------
  t.equal(ANALYSIS_STATUSES.length, 6, 'six analysis statuses');
  t.ok(checkAnalysisTransition('requested', 'review_pending').ok, 'requested -> review_pending');
  t.ok(checkAnalysisTransition('review_pending', 'accepted').ok, 'a human accepts a review_pending analysis');
  t.ok(
    !checkAnalysisTransition('requested', 'accepted').ok,
    'an analysis can NEVER be accepted without human review',
  );
  t.ok(!checkAnalysisTransition('accepted', 'rejected').ok, 'accepted is terminal');
  t.ok(isAnalysisTerminal('accepted') && isAnalysisTerminal('failed'), 'accepted/failed are terminal');

  // --- suggestion lifecycle (advisory only; no auto-match/post) --------------------------------
  t.equal(SUGGESTION_STATUSES.length, 4, 'four suggestion statuses');
  t.ok(
    checkSuggestionTransition('suggested', 'accepted').ok,
    'a human accepts a suggestion (chooses to act)',
  );
  t.ok(!checkSuggestionTransition('accepted', 'rejected').ok, 'accepted is terminal');
  t.ok(
    isSuggestionTerminal('accepted') && isSuggestionTerminal('dismissed'),
    'accepted/dismissed are terminal',
  );

  // --- spec status ----------------------------------------------------------------------------
  t.equal(SPEC_STATUSES.length, 4, 'four spec statuses');
  t.ok(isSpecFrozen('active') && !isSpecFrozen('draft'), 'a published config is frozen');

  // --- decisions ------------------------------------------------------------------------------
  t.equal(REVIEW_DECISIONS.length, 3, 'three human decisions');
  t.ok(isReviewDecision('accept') && !isReviewDecision('post'), 'decision recognized');
  t.equal(decisionToState('accept'), 'accepted', 'accept -> accepted');

  // --- reason codes ---------------------------------------------------------------------------
  t.equal(REASON_CODES.noAutopost, 'no_autopost', 'no-autopost reason code');
  t.equal(REASON_CODES.notExplainable, 'not_explainable', 'explainability reason code');
  t.ok(
    ALL_REASON_CODES.includes('autonomous_action_forbidden') && ALL_REASON_CODES.includes('human_accepted'),
    'governance reason codes present',
  );
  t.ok(new Set(ALL_REASON_CODES).size === ALL_REASON_CODES.length, 'no reason code declared twice');

  // --- confidence integer bps + money bigint minor units (no float) ---------------------------
  t.ok(isConfidenceBps(0) && isConfidenceBps(10000), 'confidence bounds 0..10000');
  t.ok(
    !isConfidenceBps(10001) && !isConfidenceBps(-1) && !isConfidenceBps(3.3),
    'out-of-range / fractional confidence rejected',
  );
  t.equal(M27_LIMITS.maxConfidenceBps, 10000, 'max confidence is 10000 bps');
  t.ok(
    isMinorUnits(0) && isMinorUnits(250000) && isMinorUnits(-500),
    'integer minor units (incl. negative adjustments) accepted',
  );
  t.ok(
    !isMinorUnits(12.5) && !isMinorUnits(Number.NaN),
    'a fractional/NaN amount is rejected (no float money)',
  );

  // --- the HUMAN-review + explainability gate (no autonomous action; no unexplained match) -----
  t.ok(
    evaluateReviewGate({
      reviewerId: 'user-1',
      decision: 'accept',
      explainabilityRequired: false,
      featureCount: 0,
    }).allowed,
    'a human may accept when explainability is not required',
  );
  const noReviewer = evaluateReviewGate({
    reviewerId: null,
    decision: 'accept',
    explainabilityRequired: false,
    featureCount: 0,
  });
  t.ok(
    !noReviewer.allowed && noReviewer.reasonCode === REASON_CODES.autonomousActionForbidden,
    'without a human, a decision is forbidden (no auto-post)',
  );
  t.ok(
    !evaluateReviewGate({
      reviewerId: '  ',
      decision: 'accept',
      explainabilityRequired: false,
      featureCount: 0,
    }).allowed,
    'a blank reviewer is not a human (fail closed)',
  );
  const unexplained = evaluateReviewGate({
    reviewerId: 'user-1',
    decision: 'accept',
    explainabilityRequired: true,
    featureCount: 0,
  });
  t.ok(
    !unexplained.allowed && unexplained.reasonCode === REASON_CODES.notExplainable,
    'an unexplained match (0 features) cannot be accepted',
  );
  t.ok(
    evaluateReviewGate({
      reviewerId: 'user-1',
      decision: 'reject',
      explainabilityRequired: true,
      featureCount: 0,
    }).allowed,
    'reject/dismiss never need features',
  );
  const badDecision = evaluateReviewGate({
    reviewerId: 'user-1',
    decision: 'post',
    explainabilityRequired: false,
    featureCount: 0,
  });
  t.ok(
    !badDecision.allowed && badDecision.reasonCode === REASON_CODES.suggestionOnly,
    'an unknown decision (e.g. "post") is refused (suggestion only)',
  );

  // --- bounded pagination ---------------------------------------------------------------------
  t.deepEqual(clampPage(undefined, undefined), { limit: 50, offset: 0 }, 'defaults');
  t.deepEqual(clampPage(9999, -3), { limit: 200, offset: 0 }, 'clamped');

  // --- permissions (SHARED ai.* namespace; new finance codes) ---------------------------------
  t.equal(ALL_M27_PERMISSIONS.length, 5, 'm27 declares 5 ai.* permissions');
  t.ok(
    ALL_M27_PERMISSIONS.every((p) => p.startsWith('ai.finance.') && p.split('.').length === 3),
    'every permission is a 3-segment ai.finance.<action> code',
  );
  t.ok(new Set(ALL_M27_PERMISSIONS).size === ALL_M27_PERMISSIONS.length, 'no permission declared twice');
  t.equal(M27_PRIVILEGED_PERMISSIONS.length, 3, 'three privileged permissions');
  t.ok(
    M27_PRIVILEGED_PERMISSIONS.includes(M27_PERMISSIONS.financeReview) &&
      M27_PRIVILEGED_PERMISSIONS.includes(M27_PERMISSIONS.financeConfigure),
    'the human review + config are privileged',
  );

  // --- audit codes (SHARED AI_ prefix; AI_FINANCE_* codes) ------------------------------------
  t.equal(ALL_M27_AUDIT_CODES.length, 13, 'm27 declares 13 AI_FINANCE_ audit codes');
  t.ok(
    ALL_M27_AUDIT_CODES.every((c) => c.startsWith(AI_FINANCE_AUDIT_PREFIX) && c.split('_').length >= 3),
    'every audit code is AI_FINANCE_ SCREAMING_SNAKE with >= 3 segments',
  );
  t.ok(new Set(ALL_M27_AUDIT_CODES).size === ALL_M27_AUDIT_CODES.length, 'no audit code declared twice');

  // --- error type -----------------------------------------------------------------------------
  t.ok(new FinanceAiError('X', 'y') instanceof Error, 'FinanceAiError is an Error');
});
