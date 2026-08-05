import { defineSuite } from '@finapp/test-runner';
import {
  M25_LIMITS,
  OperationalAiError,
  SUBJECT_TYPES,
  isSubjectType,
  ANALYSIS_KINDS,
  isAnalysisKind,
  SENTIMENT_LABELS,
  isSentimentLabel,
  ANALYSIS_STATUSES,
  checkAnalysisTransition,
  isAnalysisTerminal,
  SUGGESTION_TYPES,
  isSuggestionType,
  SUGGESTION_STATUSES,
  checkSuggestionTransition,
  isSuggestionTerminal,
  SPEC_STATUSES,
  isSpecFrozen,
  DECISIONS,
  isDecision,
  decisionToState,
  EVIDENCE_SOURCES,
  isEvidenceSource,
  REASON_CODES,
  ALL_REASON_CODES,
  isConfidenceBps,
  evaluateDecisionGate,
  clampPage,
  ALL_M25_PERMISSIONS,
  M25_PERMISSIONS,
  M25_PRIVILEGED_PERMISSIONS,
  ALL_M25_AUDIT_CODES,
  AI_OPS_AUDIT_PREFIX,
} from '../src/index.ts';

export default defineSuite('m25-operational-ai', (t) => {
  // --- subject types (opaque m12/m13 refs) ----------------------------------------------------
  t.equal(SUBJECT_TYPES.length, 2, 'two subject types (feedback, case)');
  t.ok(
    isSubjectType('feedback') && isSubjectType('case') && !isSubjectType('loan'),
    'subject type recognized',
  );

  // --- analysis kinds (assistive only) --------------------------------------------------------
  t.equal(ANALYSIS_KINDS.length, 5, 'five analysis kinds');
  t.ok(
    isAnalysisKind('summary') && isAnalysisKind('sentiment') && isAnalysisKind('classification'),
    'analysis kinds recognized',
  );
  t.ok(
    !isAnalysisKind('close') && !isAnalysisKind('escalate') && !isAnalysisKind('reassign'),
    'no analysis kind is a controlled action',
  );

  // --- sentiment labels -----------------------------------------------------------------------
  t.equal(SENTIMENT_LABELS.length, 4, 'four sentiment labels');
  t.ok(isSentimentLabel('negative') && !isSentimentLabel('angry'), 'sentiment label recognized');

  // --- analysis lifecycle (a HUMAN decides; the model never does) -----------------------------
  t.equal(ANALYSIS_STATUSES.length, 6, 'six analysis statuses');
  t.ok(checkAnalysisTransition('requested', 'review_pending').ok, 'requested -> review_pending');
  t.ok(checkAnalysisTransition('requested', 'failed').ok, 'requested -> failed (m24 governance refusal)');
  t.ok(checkAnalysisTransition('review_pending', 'accepted').ok, 'a human accepts a review_pending analysis');
  t.ok(checkAnalysisTransition('review_pending', 'rejected').ok, 'a human rejects a review_pending analysis');
  t.ok(
    checkAnalysisTransition('review_pending', 'dismissed').ok,
    'a human dismisses a review_pending analysis',
  );
  t.ok(
    !checkAnalysisTransition('requested', 'accepted').ok,
    'an analysis can NEVER be accepted without human review',
  );
  t.ok(!checkAnalysisTransition('accepted', 'rejected').ok, 'accepted is terminal');
  t.ok(
    isAnalysisTerminal('accepted') &&
      isAnalysisTerminal('rejected') &&
      isAnalysisTerminal('dismissed') &&
      isAnalysisTerminal('failed'),
    'accepted/rejected/dismissed/failed are terminal',
  );
  t.ok(!isAnalysisTerminal('review_pending'), 'review_pending is not terminal');

  // --- suggestion lifecycle (recommends only) -------------------------------------------------
  t.equal(SUGGESTION_TYPES.length, 4, 'four suggestion types');
  t.ok(
    isSuggestionType('escalation') && isSuggestionType('reassignment') && !isSuggestionType('delete'),
    'suggestion type recognized',
  );
  t.equal(SUGGESTION_STATUSES.length, 4, 'four suggestion statuses');
  t.ok(
    checkSuggestionTransition('suggested', 'accepted').ok,
    'a human accepts a suggestion (chooses to act)',
  );
  t.ok(!checkSuggestionTransition('suggested', 'suggested').ok, 'a suggestion cannot loop');
  t.ok(!checkSuggestionTransition('accepted', 'rejected').ok, 'accepted is terminal');
  t.ok(
    isSuggestionTerminal('accepted') && isSuggestionTerminal('dismissed'),
    'accepted/dismissed are terminal',
  );

  // --- spec status ----------------------------------------------------------------------------
  t.equal(SPEC_STATUSES.length, 4, 'four spec statuses');
  t.ok(isSpecFrozen('active') && !isSpecFrozen('draft'), 'a published config is frozen');

  // --- decisions ------------------------------------------------------------------------------
  t.equal(DECISIONS.length, 3, 'three human decisions (accept/reject/dismiss)');
  t.ok(isDecision('accept') && !isDecision('approve'), 'decision recognized');
  t.equal(decisionToState('accept'), 'accepted', 'accept -> accepted');
  t.equal(decisionToState('reject'), 'rejected', 'reject -> rejected');
  t.equal(decisionToState('dismiss'), 'dismissed', 'dismiss -> dismissed');

  // --- evidence sources -----------------------------------------------------------------------
  t.equal(EVIDENCE_SOURCES.length, 3, 'three evidence sources');
  t.ok(
    isEvidenceSource('feedback_answer') && isEvidenceSource('case_activity') && isEvidenceSource('document'),
    'evidence sources recognized',
  );

  // --- reason codes ---------------------------------------------------------------------------
  t.equal(REASON_CODES.autonomousActionForbidden, 'autonomous_action_forbidden', 'autonomy is forbidden');
  t.equal(REASON_CODES.recommendsOnly, 'recommends_only', 'recommends-only reason code');
  t.ok(
    ALL_REASON_CODES.includes('human_accepted') && ALL_REASON_CODES.includes('ai_output_not_approved'),
    'governance reason codes present',
  );
  t.ok(new Set(ALL_REASON_CODES).size === ALL_REASON_CODES.length, 'no reason code declared twice');

  // --- confidence is INTEGER basis points, never a float --------------------------------------
  t.ok(isConfidenceBps(0) && isConfidenceBps(10000), 'confidence bounds 0..10000');
  t.ok(
    !isConfidenceBps(10001) && !isConfidenceBps(-1) && !isConfidenceBps(42.5),
    'out-of-range / fractional confidence rejected',
  );
  t.equal(M25_LIMITS.maxConfidenceBps, 10000, 'max confidence is 10000 bps');

  // --- the HUMAN-decision gate (NO autonomous action) -----------------------------------------
  const accepted = evaluateDecisionGate({ reviewerId: 'user-1', decision: 'accept' });
  t.ok(accepted.allowed && accepted.reasonCode === REASON_CODES.humanAccepted, 'a human may accept');
  const rejected = evaluateDecisionGate({ reviewerId: 'user-1', decision: 'reject' });
  t.ok(rejected.allowed && rejected.reasonCode === REASON_CODES.humanRejected, 'a human may reject');
  const noReviewer = evaluateDecisionGate({ reviewerId: null, decision: 'accept' });
  t.ok(
    !noReviewer.allowed && noReviewer.reasonCode === REASON_CODES.autonomousActionForbidden,
    'without a human, a decision is forbidden (recommends only)',
  );
  t.ok(
    !evaluateDecisionGate({ reviewerId: '  ', decision: 'accept' }).allowed,
    'a blank reviewer is not a human (fail closed)',
  );
  const badDecision = evaluateDecisionGate({ reviewerId: 'user-1', decision: 'auto_close' });
  t.ok(
    !badDecision.allowed && badDecision.reasonCode === REASON_CODES.recommendsOnly,
    'an unknown decision is refused (recommends only)',
  );

  // --- bounded pagination ---------------------------------------------------------------------
  t.deepEqual(clampPage(undefined, undefined), { limit: 50, offset: 0 }, 'defaults');
  t.deepEqual(clampPage(9999, -3), { limit: 200, offset: 0 }, 'clamped to max limit / non-negative offset');

  // --- permissions (SHARED ai.* namespace; new operational codes) -----------------------------
  t.equal(ALL_M25_PERMISSIONS.length, 7, 'm25 declares 7 ai.* permissions');
  t.ok(
    ALL_M25_PERMISSIONS.every((p) => p.startsWith('ai.') && p.split('.').length === 3),
    'every permission is a 3-segment ai.<entity>.<action> code',
  );
  t.ok(new Set(ALL_M25_PERMISSIONS).size === ALL_M25_PERMISSIONS.length, 'no permission declared twice');
  t.ok(
    ALL_M25_PERMISSIONS.includes('ai.operational.analyze') &&
      ALL_M25_PERMISSIONS.includes('ai.suggestion.decide'),
    'operational + suggestion codes present',
  );
  t.equal(M25_PRIVILEGED_PERMISSIONS.length, 3, 'three privileged permissions');
  t.ok(
    M25_PRIVILEGED_PERMISSIONS.includes(M25_PERMISSIONS.operationalReview) &&
      M25_PRIVILEGED_PERMISSIONS.includes(M25_PERMISSIONS.suggestionDecide) &&
      M25_PRIVILEGED_PERMISSIONS.includes(M25_PERMISSIONS.operationalConfigure),
    'the human review, the suggestion decision and config are privileged',
  );

  // --- audit codes (SHARED AI_ prefix; AI_OPS_* codes) ----------------------------------------
  t.equal(ALL_M25_AUDIT_CODES.length, 11, 'm25 declares 11 AI_OPS_ audit codes');
  t.ok(
    ALL_M25_AUDIT_CODES.every((c) => c.startsWith(AI_OPS_AUDIT_PREFIX) && c.split('_').length >= 3),
    'every audit code is AI_OPS_ SCREAMING_SNAKE with >= 3 segments',
  );
  t.ok(new Set(ALL_M25_AUDIT_CODES).size === ALL_M25_AUDIT_CODES.length, 'no audit code declared twice');

  // --- error type -----------------------------------------------------------------------------
  t.ok(new OperationalAiError('X', 'y') instanceof Error, 'OperationalAiError is an Error');
});
