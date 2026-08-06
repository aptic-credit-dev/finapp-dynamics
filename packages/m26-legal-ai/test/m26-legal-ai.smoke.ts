import { defineSuite } from '@finapp/test-runner';
import {
  M26_LIMITS,
  LegalAiError,
  LEGAL_CLASSIFICATIONS,
  isLegalClassification,
  PRIVILEGE_CLASSIFICATIONS,
  isPrivilegeClassification,
  isBehindEthicalWall,
  SUBJECT_TYPES,
  isSubjectType,
  ANALYSIS_KINDS,
  isAnalysisKind,
  FINDING_TYPES,
  isFindingType,
  FACT_STATUSES,
  isFactStatus,
  SUGGESTION_TYPES,
  isSuggestionType,
  CITATION_SOURCE_TYPES,
  isCitationSourceType,
  EVIDENCE_CLASSIFICATIONS,
  isEvidenceClassification,
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
  evaluateEthicalWall,
  evaluateReviewGate,
  clampPage,
  ALL_M26_PERMISSIONS,
  M26_PERMISSIONS,
  M26_PRIVILEGED_PERMISSIONS,
  ALL_M26_AUDIT_CODES,
  AI_LEGAL_AUDIT_PREFIX,
} from '../src/index.ts';

export default defineSuite('m26-legal-ai', (t) => {
  // --- classification + privilege / ethical wall ----------------------------------------------
  t.equal(LEGAL_CLASSIFICATIONS.length, 4, 'four data classifications');
  t.ok(isLegalClassification('restricted') && !isLegalClassification('cosmic'), 'classification recognized');
  t.equal(PRIVILEGE_CLASSIFICATIONS.length, 4, 'four privilege classifications');
  t.ok(
    isPrivilegeClassification('work_product') && !isPrivilegeClassification('open'),
    'privilege recognized',
  );
  t.ok(
    isBehindEthicalWall('privileged') && isBehindEthicalWall('work_product'),
    'privileged/work_product are behind the ethical wall',
  );
  t.ok(
    !isBehindEthicalWall('none') && !isBehindEthicalWall('confidential'),
    'none/confidential are not behind the wall',
  );

  // --- subject types (opaque m14 matter refs) -------------------------------------------------
  t.equal(SUBJECT_TYPES.length, 2, 'two subject types (matter, case)');
  t.ok(isSubjectType('matter') && isSubjectType('case') && !isSubjectType('loan'), 'subject type recognized');

  // --- analysis kinds (controlled vocabulary; no executable legal operation) -------------------
  t.equal(ANALYSIS_KINDS.length, 13, 'thirteen analysis kinds');
  t.ok(
    isAnalysisKind('matter_summary') &&
      isAnalysisKind('deadline_extraction') &&
      isAnalysisKind('clause_analysis'),
    'analysis kinds recognized',
  );
  t.ok(
    !isAnalysisKind('file_lawsuit') && !isAnalysisKind('settle') && !isAnalysisKind('enforce'),
    'no analysis kind is a controlled legal action',
  );

  // --- findings: fact vs inference (never a verified legal fact) -------------------------------
  t.equal(FINDING_TYPES.length, 7, 'seven finding types');
  t.ok(
    isFindingType('extracted_fact') && isFindingType('inferred_issue') && isFindingType('risk_flag'),
    'finding types recognized',
  );
  t.equal(FACT_STATUSES.length, 2, 'two fact statuses (extracted, inferred) — never verified');
  t.ok(isFactStatus('extracted') && isFactStatus('inferred'), 'extracted/inferred recognized');
  t.ok(
    !isFactStatus('verified') && !isFactStatus('confirmed'),
    'an AI finding is NEVER a verified legal fact',
  );

  // --- suggestion types (advisory only — never filing/settlement/enforcement) ------------------
  t.equal(SUGGESTION_TYPES.length, 6, 'six suggestion types');
  t.ok(
    isSuggestionType('procedural') && isSuggestionType('drafting') && isSuggestionType('next_action'),
    'suggestion types recognized',
  );
  t.ok(
    !isSuggestionType('file') && !isSuggestionType('settle') && !isSuggestionType('enforce'),
    'no suggestion type is a controlled legal action',
  );

  // --- citations + evidence classification ----------------------------------------------------
  t.equal(CITATION_SOURCE_TYPES.length, 3, 'three citation source types');
  t.ok(isCitationSourceType('document') && isCitationSourceType('precedent'), 'citation sources recognized');
  t.equal(EVIDENCE_CLASSIFICATIONS.length, 3, 'three evidence classifications');
  t.ok(
    isEvidenceClassification('primary') && !isEvidenceClassification('hearsay'),
    'evidence classification recognized',
  );

  // --- analysis lifecycle (a HUMAN legal reviewer decides) ------------------------------------
  t.equal(ANALYSIS_STATUSES.length, 6, 'six analysis statuses');
  t.ok(checkAnalysisTransition('requested', 'review_pending').ok, 'requested -> review_pending');
  t.ok(checkAnalysisTransition('requested', 'failed').ok, 'requested -> failed (m24 governance refusal)');
  t.ok(checkAnalysisTransition('review_pending', 'accepted').ok, 'a human accepts a review_pending analysis');
  t.ok(
    !checkAnalysisTransition('requested', 'accepted').ok,
    'an analysis can NEVER be accepted without human review',
  );
  t.ok(!checkAnalysisTransition('accepted', 'rejected').ok, 'accepted is terminal');
  t.ok(isAnalysisTerminal('accepted') && isAnalysisTerminal('failed'), 'accepted/failed are terminal');
  t.ok(!isAnalysisTerminal('review_pending'), 'review_pending is not terminal');

  // --- suggestion lifecycle (advisory only) ---------------------------------------------------
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
  t.equal(REVIEW_DECISIONS.length, 3, 'three human decisions (accept/reject/dismiss)');
  t.ok(isReviewDecision('accept') && !isReviewDecision('file'), 'decision recognized');
  t.equal(decisionToState('accept'), 'accepted', 'accept -> accepted');
  t.equal(decisionToState('dismiss'), 'dismissed', 'dismiss -> dismissed');

  // --- reason codes ---------------------------------------------------------------------------
  t.equal(REASON_CODES.autonomousActionForbidden, 'autonomous_action_forbidden', 'autonomy is forbidden');
  t.equal(REASON_CODES.ethicalWallDenied, 'ethical_wall_denied', 'ethical-wall reason code');
  t.ok(
    ALL_REASON_CODES.includes('human_accepted') && ALL_REASON_CODES.includes('missing_required_citations'),
    'governance reason codes present',
  );
  t.ok(new Set(ALL_REASON_CODES).size === ALL_REASON_CODES.length, 'no reason code declared twice');

  // --- confidence is INTEGER basis points, never a float --------------------------------------
  t.ok(isConfidenceBps(0) && isConfidenceBps(10000), 'confidence bounds 0..10000');
  t.ok(
    !isConfidenceBps(10001) && !isConfidenceBps(-1) && !isConfidenceBps(1.5),
    'out-of-range / fractional confidence rejected',
  );
  t.equal(M26_LIMITS.maxConfidenceBps, 10000, 'max confidence is 10000 bps');

  // --- the ETHICAL-WALL gate (fail closed) ----------------------------------------------------
  t.ok(
    evaluateEthicalWall({ privilege: 'confidential', hasPrivilegedRead: false }).allowed,
    'non-privileged material needs no privileged read',
  );
  t.ok(
    evaluateEthicalWall({ privilege: 'privileged', hasPrivilegedRead: true }).allowed,
    'a privileged reader may access privileged material',
  );
  const wallBlocked = evaluateEthicalWall({ privilege: 'privileged', hasPrivilegedRead: false });
  t.ok(
    !wallBlocked.allowed && wallBlocked.reasonCode === REASON_CODES.ethicalWallDenied,
    'privileged material is blocked without the entitlement (ethical wall, fail closed)',
  );
  t.ok(
    !evaluateEthicalWall({ privilege: 'work_product', hasPrivilegedRead: false }).allowed,
    'work-product is behind the wall too',
  );

  // --- the HUMAN-review gate (no autonomous action + citations where required) -----------------
  t.ok(
    evaluateReviewGate({
      reviewerId: 'user-1',
      decision: 'accept',
      citationsRequired: false,
      citationCount: 0,
    }).allowed,
    'a human may accept when citations are not required',
  );
  const noReviewer = evaluateReviewGate({
    reviewerId: null,
    decision: 'accept',
    citationsRequired: false,
    citationCount: 0,
  });
  t.ok(
    !noReviewer.allowed && noReviewer.reasonCode === REASON_CODES.autonomousActionForbidden,
    'without a human, a decision is forbidden',
  );
  t.ok(
    !evaluateReviewGate({ reviewerId: '  ', decision: 'accept', citationsRequired: false, citationCount: 0 })
      .allowed,
    'a blank reviewer is not a human (fail closed)',
  );
  const noCites = evaluateReviewGate({
    reviewerId: 'user-1',
    decision: 'accept',
    citationsRequired: true,
    citationCount: 0,
  });
  t.ok(
    !noCites.allowed && noCites.reasonCode === REASON_CODES.missingCitations,
    'a citations-required analysis cannot be accepted with zero citations',
  );
  t.ok(
    evaluateReviewGate({
      reviewerId: 'user-1',
      decision: 'reject',
      citationsRequired: true,
      citationCount: 0,
    }).allowed,
    'reject/dismiss never need citations',
  );
  const badDecision = evaluateReviewGate({
    reviewerId: 'user-1',
    decision: 'file',
    citationsRequired: false,
    citationCount: 0,
  });
  t.ok(
    !badDecision.allowed && badDecision.reasonCode === REASON_CODES.legalAdvisoryOnly,
    'an unknown decision is refused (advisory only)',
  );

  // --- bounded pagination ---------------------------------------------------------------------
  t.deepEqual(clampPage(undefined, undefined), { limit: 50, offset: 0 }, 'defaults');
  t.deepEqual(clampPage(9999, -3), { limit: 200, offset: 0 }, 'clamped');

  // --- permissions (SHARED ai.* namespace; new legal codes) -----------------------------------
  t.equal(ALL_M26_PERMISSIONS.length, 6, 'm26 declares 6 ai.* permissions');
  t.ok(
    ALL_M26_PERMISSIONS.every((p) => p.startsWith('ai.') && p.split('.').length === 3),
    'every permission is a 3-segment ai.<entity>.<action> code',
  );
  t.ok(new Set(ALL_M26_PERMISSIONS).size === ALL_M26_PERMISSIONS.length, 'no permission declared twice');
  t.ok(
    ALL_M26_PERMISSIONS.includes('ai.legal.analyze') && ALL_M26_PERMISSIONS.includes('ai.privileged.read'),
    'legal + privileged-read codes present',
  );
  t.equal(M26_PRIVILEGED_PERMISSIONS.length, 4, 'four privileged permissions');
  t.ok(
    M26_PRIVILEGED_PERMISSIONS.includes(M26_PERMISSIONS.legalReview) &&
      M26_PRIVILEGED_PERMISSIONS.includes(M26_PERMISSIONS.privilegedRead),
    'the human legal review + the ethical-wall privileged read are privileged',
  );

  // --- audit codes (SHARED AI_ prefix; AI_LEGAL_* codes) --------------------------------------
  t.equal(ALL_M26_AUDIT_CODES.length, 14, 'm26 declares 14 AI_LEGAL_ audit codes');
  t.ok(
    ALL_M26_AUDIT_CODES.every((c) => c.startsWith(AI_LEGAL_AUDIT_PREFIX) && c.split('_').length >= 3),
    'every audit code is AI_LEGAL_ SCREAMING_SNAKE with >= 3 segments',
  );
  t.ok(new Set(ALL_M26_AUDIT_CODES).size === ALL_M26_AUDIT_CODES.length, 'no audit code declared twice');
  t.ok(ALL_M26_AUDIT_CODES.includes('AI_LEGAL_PRIVILEGED_READ'), 'a privileged-material read is audited');

  // --- error type -----------------------------------------------------------------------------
  t.ok(new LegalAiError('X', 'y') instanceof Error, 'LegalAiError is an Error');
});
