import { defineSuite } from '@finapp/test-runner';
import {
  M29_LIMITS,
  AiGovernanceError,
  DATA_CLASSIFICATIONS,
  isDataClassification,
  isSensitiveClassification,
  RISK_TIERS,
  isRiskTier,
  SUBJECT_KINDS,
  isSubjectKind,
  isWaiver,
  DEPLOYMENT_STATUSES,
  isDeploymentStatus,
  isDlpResult,
  isSafetyResult,
  isCitationResult,
  DECISION_KINDS,
  isDecisionKind,
  RELEASE_STATUSES,
  checkReleaseTransition,
  isReleaseTerminal,
  WAIVER_STATUSES,
  checkWaiverTransition,
  ABSOLUTE_CONTROLS,
  isAbsoluteControl,
  SPEC_STATUSES,
  isSpecFrozen,
  REASON_CODES,
  ALL_REASON_CODES,
  isConfidenceBps,
  isHumanActor,
  evaluateSodGate,
  evaluateReleaseGate,
  evaluateWaiverGate,
  evaluatePasses,
  clampPage,
  ALL_M29_PERMISSIONS,
  M29_PERMISSIONS,
  M29_NEW_PERMISSIONS,
  M29_PRIVILEGED_PERMISSIONS,
  ALL_M29_AUDIT_CODES,
  AI_GOVERNANCE_AUDIT_PREFIX,
} from '../src/index.ts';

export default defineSuite('m29-ai-governance', (t) => {
  // --- classification + sensitivity -----------------------------------------------------------
  t.equal(DATA_CLASSIFICATIONS.length, 4, 'four data classifications');
  t.ok(isDataClassification('restricted') && !isDataClassification('cosmic'), 'classification recognized');
  t.ok(
    isSensitiveClassification('confidential') && isSensitiveClassification('restricted'),
    'confidential/restricted are sensitive',
  );
  t.ok(!isSensitiveClassification('internal'), 'internal is not sensitive');

  // --- risk tiers + subject kinds -------------------------------------------------------------
  t.equal(RISK_TIERS.length, 4, 'four risk tiers');
  t.ok(isRiskTier('critical') && !isRiskTier('nuclear'), 'risk tier recognized');
  t.equal(SUBJECT_KINDS.length, 6, 'six release subject kinds');
  t.ok(
    isSubjectKind('model_version') && isSubjectKind('waiver_exception') && !isSubjectKind('deploy'),
    'subject kind recognized',
  );
  t.ok(isWaiver('waiver_exception') && !isWaiver('model_version'), 'waiver kind recognized');
  t.ok(!isSubjectKind('post') && !isSubjectKind('execute'), 'no subject kind is a controlled action');

  // --- deployment + evaluation vocab ----------------------------------------------------------
  t.equal(DEPLOYMENT_STATUSES.length, 5, 'five deployment statuses');
  t.ok(isDeploymentStatus('deployed') && !isDeploymentStatus('live'), 'deployment status recognized');
  t.ok(
    isDlpResult('block') && isSafetyResult('fail') && isCitationResult('pass'),
    'evaluation result vocab recognized',
  );
  t.ok(!isDlpResult('maybe'), 'unknown dlp result rejected');

  // --- decision kinds --------------------------------------------------------------------------
  t.equal(DECISION_KINDS.length, 5, 'five human decision kinds');
  t.ok(
    isDecisionKind('approve') && isDecisionKind('withdraw') && !isDecisionKind('post'),
    'decision kind recognized',
  );

  // --- release lifecycle (a HUMAN approves; never the model) ----------------------------------
  t.equal(RELEASE_STATUSES.length, 10, 'ten release statuses');
  t.ok(checkReleaseTransition('review_pending', 'approved').ok, 'review_pending -> approved (human)');
  t.ok(checkReleaseTransition('approved', 'released').ok, 'approved -> released');
  t.ok(!checkReleaseTransition('draft', 'approved').ok, 'a release can NEVER jump straight to approved');
  t.ok(!checkReleaseTransition('draft', 'released').ok, 'a release can NEVER jump straight to released');
  t.ok(!checkReleaseTransition('rejected', 'approved').ok, 'rejected is terminal');
  t.ok(
    isReleaseTerminal('rejected') && isReleaseTerminal('withdrawn') && isReleaseTerminal('superseded'),
    'terminal release states',
  );

  // --- waiver lifecycle ------------------------------------------------------------------------
  t.equal(WAIVER_STATUSES.length, 6, 'six waiver statuses');
  t.ok(checkWaiverTransition('review_pending', 'approved').ok, 'a waiver is approved from review_pending');
  t.ok(checkWaiverTransition('approved', 'expired').ok, 'an approved waiver can expire');
  t.ok(!checkWaiverTransition('draft', 'approved').ok, 'a waiver cannot jump to approved');

  // --- absolute controls -----------------------------------------------------------------------
  t.equal(ABSOLUTE_CONTROLS.length, 6, 'six absolute controls declared');
  t.ok(
    isAbsoluteControl('no_ai_self_approval') && isAbsoluteControl('no_production_provider'),
    'absolute controls recognized',
  );
  t.ok(!isAbsoluteControl('extend_deadline'), 'a normal control is not absolute');

  // --- spec status -----------------------------------------------------------------------------
  t.equal(SPEC_STATUSES.length, 4, 'four spec statuses');
  t.ok(isSpecFrozen('active') && !isSpecFrozen('draft'), 'a published policy is frozen');

  // --- human actor (AI/system is never a human) ------------------------------------------------
  t.ok(isHumanActor('user-1'), 'a real user is a human');
  t.ok(
    !isHumanActor(null) &&
      !isHumanActor('  ') &&
      !isHumanActor('system') &&
      !isHumanActor('ai') &&
      !isHumanActor('automation'),
    'null/blank/system/ai/automation are NOT human',
  );

  // --- THE NO-AI-SELF-APPROVAL / SoD GATE ------------------------------------------------------
  t.ok(
    evaluateSodGate({ proposedBy: 'maker', approverId: 'checker' }).allowed,
    'an independent human checker may approve',
  );
  const aiApprove = evaluateSodGate({ proposedBy: 'maker', approverId: null });
  t.ok(
    !aiApprove.allowed && aiApprove.reasonCode === REASON_CODES.aiSelfApprovalForbidden,
    'a null/AI approver is forbidden (no AI self-approval)',
  );
  t.ok(
    !evaluateSodGate({ proposedBy: 'maker', approverId: 'system' }).allowed,
    'a system approver is forbidden',
  );
  const selfApprove = evaluateSodGate({ proposedBy: 'maker', approverId: 'maker' });
  t.ok(
    !selfApprove.allowed && selfApprove.reasonCode === REASON_CODES.selfApprovalForbidden,
    'the proposer cannot self-approve (maker != checker)',
  );

  // --- THE RELEASE GATE (SoD + evidence + provider policy) -------------------------------------
  t.ok(
    evaluateReleaseGate({
      subjectKind: 'model_version',
      proposedBy: 'maker',
      approverId: 'checker',
      evaluationPassed: true,
      providerRestricted: false,
      policyAllowsRestrictedProvider: false,
    }).allowed,
    'a human-checked, evaluated release may be approved',
  );
  const noEval = evaluateReleaseGate({
    subjectKind: 'model_version',
    proposedBy: 'maker',
    approverId: 'checker',
    evaluationPassed: false,
    providerRestricted: false,
    policyAllowsRestrictedProvider: false,
  });
  t.ok(
    !noEval.allowed && noEval.reasonCode === REASON_CODES.evaluationNotPassed,
    'a non-waiver release with no passing evaluation is blocked',
  );
  const restricted = evaluateReleaseGate({
    subjectKind: 'model_version',
    proposedBy: 'maker',
    approverId: 'checker',
    evaluationPassed: true,
    providerRestricted: true,
    policyAllowsRestrictedProvider: false,
  });
  t.ok(
    !restricted.allowed && restricted.reasonCode === REASON_CODES.restrictedProviderBlocked,
    'a restricted provider is blocked unless policy allows (it never does)',
  );
  t.ok(
    evaluateReleaseGate({
      subjectKind: 'waiver_exception',
      proposedBy: 'maker',
      approverId: 'checker',
      evaluationPassed: false,
      providerRestricted: false,
      policyAllowsRestrictedProvider: false,
    }).allowed,
    'a waiver is exempt from the evaluation gate (judged on its compensating control)',
  );
  t.ok(
    !evaluateReleaseGate({
      subjectKind: 'model_version',
      proposedBy: 'maker',
      approverId: 'maker',
      evaluationPassed: true,
      providerRestricted: false,
      policyAllowsRestrictedProvider: false,
    }).allowed,
    'the proposer cannot approve their own release',
  );

  // --- THE WAIVER / OVERRIDE GATE --------------------------------------------------------------
  t.ok(
    evaluateWaiverGate({ requestedBy: 'req', approverId: 'appr', targetsAbsoluteControl: false }).allowed,
    'an independent human may approve a non-absolute waiver',
  );
  const absolute = evaluateWaiverGate({
    requestedBy: 'req',
    approverId: 'appr',
    targetsAbsoluteControl: true,
  });
  t.ok(
    !absolute.allowed && absolute.reasonCode === REASON_CODES.absoluteControlNotWaivable,
    'an absolute control can NEVER be waived',
  );
  t.ok(
    !evaluateWaiverGate({ requestedBy: 'req', approverId: 'req', targetsAbsoluteControl: false }).allowed,
    'the requester cannot self-approve a waiver',
  );
  t.ok(
    !evaluateWaiverGate({ requestedBy: 'req', approverId: null, targetsAbsoluteControl: false }).allowed,
    'AI cannot approve a waiver',
  );

  // --- evaluation pass logic (no "passed" without evidence) ------------------------------------
  t.ok(
    evaluatePasses({
      dlpResult: 'pass',
      safetyResult: 'pass',
      citationResult: 'pass',
      accuracyBps: 9000,
      minConfidenceBps: 6000,
    }),
    'a clean, accurate evaluation passes',
  );
  t.ok(
    !evaluatePasses({
      dlpResult: 'block',
      safetyResult: 'pass',
      citationResult: 'pass',
      accuracyBps: 9000,
      minConfidenceBps: 0,
    }),
    'a DLP block fails the evaluation',
  );
  t.ok(
    !evaluatePasses({
      dlpResult: 'pass',
      safetyResult: 'fail',
      citationResult: 'pass',
      accuracyBps: 9000,
      minConfidenceBps: 0,
    }),
    'a safety failure fails the evaluation',
  );
  t.ok(
    !evaluatePasses({
      dlpResult: 'pass',
      safetyResult: 'pass',
      citationResult: 'pass',
      accuracyBps: 3000,
      minConfidenceBps: 6000,
    }),
    'below the confidence floor fails the evaluation',
  );

  // --- confidence + pagination -----------------------------------------------------------------
  t.ok(
    isConfidenceBps(0) && isConfidenceBps(10000) && !isConfidenceBps(10001) && !isConfidenceBps(3.3),
    'confidence bounds 0..10000',
  );
  t.equal(M29_LIMITS.maxConfidenceBps, 10000, 'max confidence 10000 bps');
  t.deepEqual(clampPage(undefined, undefined), { limit: 50, offset: 0 }, 'page defaults');
  t.deepEqual(clampPage(9999, -3), { limit: 200, offset: 0 }, 'page clamped');

  // --- reason codes ----------------------------------------------------------------------------
  t.equal(
    REASON_CODES.aiSelfApprovalForbidden,
    'ai_self_approval_forbidden',
    'no-AI-self-approval reason code',
  );
  t.equal(
    REASON_CODES.absoluteControlNotWaivable,
    'absolute_control_not_waivable',
    'absolute-control reason code',
  );
  t.ok(
    ALL_REASON_CODES.includes('self_approval_forbidden') &&
      ALL_REASON_CODES.includes('evaluation_not_passed'),
    'governance reason codes present',
  );
  t.ok(new Set(ALL_REASON_CODES).size === ALL_REASON_CODES.length, 'no reason code declared twice');

  // --- permissions (SHARED ai.* namespace) -----------------------------------------------------
  t.equal(ALL_M29_PERMISSIONS.length, 5, 'm29 authorizes 5 ai.governance.* permissions');
  t.ok(
    ALL_M29_PERMISSIONS.every((p) => p.startsWith('ai.governance.') && p.split('.').length === 3),
    'every permission is a 3-segment ai.governance.<action> code',
  );
  t.equal(M29_NEW_PERMISSIONS.length, 3, 'm29 registers 3 NEW codes (approve/override/export)');
  t.ok(
    M29_NEW_PERMISSIONS.includes(M29_PERMISSIONS.governanceApprove) &&
      M29_NEW_PERMISSIONS.includes(M29_PERMISSIONS.governanceOverride) &&
      M29_NEW_PERMISSIONS.includes(M29_PERMISSIONS.governanceExport),
    'the new codes are approve/override/export',
  );
  t.equal(M29_PRIVILEGED_PERMISSIONS.length, 4, 'four privileged permissions');
  t.ok(!M29_PRIVILEGED_PERMISSIONS.includes(M29_PERMISSIONS.governanceRead), 'read is not privileged');

  // --- audit codes (SHARED AI_ prefix; AI_GOVERNANCE_* codes) ----------------------------------
  t.equal(ALL_M29_AUDIT_CODES.length, 16, 'm29 declares 16 AI_GOVERNANCE_ audit codes');
  t.ok(
    ALL_M29_AUDIT_CODES.every((c) => c.startsWith(AI_GOVERNANCE_AUDIT_PREFIX) && c.split('_').length >= 3),
    'every audit code is AI_GOVERNANCE_ SCREAMING_SNAKE with >= 3 segments',
  );
  t.ok(new Set(ALL_M29_AUDIT_CODES).size === ALL_M29_AUDIT_CODES.length, 'no audit code declared twice');

  // --- error type ------------------------------------------------------------------------------
  t.ok(new AiGovernanceError('X', 'y') instanceof Error, 'AiGovernanceError is an Error');
});
