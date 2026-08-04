import { defineSuite } from '@finapp/test-runner';
import {
  SUBJECT_TYPES,
  isSubjectType,
  SOD_MODES,
  isSodMode,
  SOD_RULES,
  DECISION_KINDS,
  isDecisionKind,
  APPROVING_DECISIONS,
  OVERRIDE_TYPES,
  ESCALATION_MODES,
  isEscalationMode,
  PARTICIPANT_ROLES,
  NOTE_TYPES,
  REASON_CATEGORIES,
  REASON_SEVERITIES,
  REASON_CODES,
  ALL_REASON_CODES,
  REQUEST_STATUSES,
  checkRequestTransition,
  isRequestActionable,
  isRequestTerminal,
  STEP_STATUSES,
  checkStepTransition,
  isStepTerminal,
  SPEC_STATUSES,
  checkSpecTransition,
  isSpecFrozen,
  DELEGATION_STATUSES,
  checkDelegationTransition,
  evaluateSod,
  sodPermits,
  checkQuorum,
  canEscalate,
  ApprovalEngineError,
  ALL_M22_PERMISSIONS,
  M22_PRIVILEGED_PERMISSIONS,
  ALL_M22_AUDIT_CODES,
  APPROVAL_AUDIT_PREFIX,
} from '../src/index.ts';

export default defineSuite('m22-approval', (t) => {
  // --- vocabulary -------------------------------------------------------------------------------
  t.equal(SUBJECT_TYPES.length, 6, 'six subject types');
  t.ok(isSubjectType('journal_posting') && !isSubjectType('telepathy'), 'subject type recognized');
  t.equal(SOD_MODES.length, 2, 'two SoD modes');
  t.ok(isSodMode('strict') && !isSodMode('loose'), 'SoD mode recognized');
  t.equal(SOD_RULES.length, 4, 'four SoD rules (maker/preparer/delegate/single)');
  t.equal(DECISION_KINDS.length, 9, 'nine decision kinds');
  t.ok(isDecisionKind('approve') && !isDecisionKind('vibes'), 'decision kind recognized');
  t.deepEqual(
    [...APPROVING_DECISIONS],
    ['approve', 'override_approve'],
    'only approve/override_approve are approving acts',
  );
  t.equal(OVERRIDE_TYPES.length, 3, 'three override types');
  t.equal(ESCALATION_MODES.length, 2, 'two escalation modes (notify-only / reassign)');
  t.ok(isEscalationMode('reassign') && !isEscalationMode('shout'), 'escalation mode recognized');
  t.equal(PARTICIPANT_ROLES.length, 6, 'six participant roles');
  t.equal(NOTE_TYPES.length, 5, 'five note types');
  t.equal(REASON_CATEGORIES.length, 6, 'six reason categories');
  t.equal(REASON_SEVERITIES.length, 3, 'three reason severities');

  // --- reason codes (deterministic, explainable) ------------------------------------------------
  t.equal(REASON_CODES.makerIsChecker.code, 'maker_is_checker', 'maker_is_checker reason code');
  t.equal(REASON_CODES.preparerIsChecker.code, 'preparer_is_checker', 'preparer_is_checker reason code');
  t.equal(REASON_CODES.delegateIsMaker.code, 'delegate_is_maker', 'delegate_is_maker reason code');
  t.equal(
    REASON_CODES.insufficientApprovals.code,
    'insufficient_approvals',
    'insufficient_approvals reason code',
  );
  const reasonList: readonly string[] = ALL_REASON_CODES;
  t.ok(
    reasonList.includes('single_approver') && reasonList.includes('escalation_depth_exceeded'),
    'reason vocabulary complete',
  );
  t.ok(!reasonList.includes('posted'), 'there is no "posted" reason — m22 never posts');

  // --- request lifecycle (the choke point) ------------------------------------------------------
  t.equal(REQUEST_STATUSES.length, 7, 'seven request statuses');
  t.ok(checkRequestTransition('draft', 'pending').ok, 'draft -> pending (submit)');
  t.ok(checkRequestTransition('pending', 'approved').ok, 'pending -> approved');
  t.ok(checkRequestTransition('pending', 'rejected').ok, 'pending -> rejected');
  t.ok(checkRequestTransition('pending', 'returned').ok, 'pending -> returned');
  t.ok(checkRequestTransition('returned', 'pending').ok, 'returned -> pending (controlled resubmission)');
  t.ok(checkRequestTransition('escalated', 'approved').ok, 'an escalated request can still be decided');
  t.ok(!checkRequestTransition('draft', 'approved').ok, 'a draft cannot jump straight to approved');
  t.ok(
    !checkRequestTransition('approved', 'pending').ok,
    'an approved request is terminal (terminal-state protection)',
  );
  t.ok(!checkRequestTransition('rejected', 'pending').ok, 'a rejected request is terminal');
  t.ok(!checkRequestTransition('cancelled', 'pending').ok, 'a cancelled request is terminal');
  t.ok(
    isRequestActionable('pending') && isRequestActionable('escalated') && !isRequestActionable('draft'),
    'only pending/escalated are actionable',
  );
  t.ok(
    isRequestTerminal('approved') && isRequestTerminal('rejected') && isRequestTerminal('cancelled'),
    'approved/rejected/cancelled are terminal',
  );
  t.ok(!isRequestTerminal('returned'), 'returned is not terminal (resubmission allowed)');

  // --- step + spec + delegation lifecycles ------------------------------------------------------
  t.equal(STEP_STATUSES.length, 5, 'five step statuses');
  t.ok(checkStepTransition('pending', 'approved').ok, 'step pending -> approved');
  t.ok(!checkStepTransition('approved', 'pending').ok, 'a decided step is terminal');
  t.ok(isStepTerminal('skipped') && !isStepTerminal('pending'), 'skipped is terminal');
  t.equal(SPEC_STATUSES.length, 4, 'four spec statuses (policy/config)');
  t.ok(checkSpecTransition('draft', 'active').ok, 'spec draft -> active');
  t.ok(isSpecFrozen('active') && !isSpecFrozen('draft'), 'a published policy/config is frozen');
  t.equal(DELEGATION_STATUSES.length, 3, 'three delegation statuses');
  t.ok(checkDelegationTransition('active', 'revoked').ok, 'delegation active -> revoked');
  t.ok(!checkDelegationTransition('revoked', 'active').ok, 'a revoked delegation is terminal');

  // --- the maker-checker + SoD engine (the heart) -----------------------------------------------
  const maker = 'user-maker';
  const checker = 'user-checker';
  const preparer = 'user-preparer';

  const clean = evaluateSod({ actor: checker, maker, preparer });
  t.ok(clean.allowed && clean.findings.length === 0, 'a distinct checker is allowed');

  const makerChecks = evaluateSod({ actor: maker, maker, preparer });
  t.ok(
    !makerChecks.allowed && makerChecks.findings.some((f) => f.reasonCode === 'maker_is_checker'),
    'the maker cannot check their own request (maker != checker)',
  );

  const preparerChecks = evaluateSod({ actor: preparer, maker, preparer });
  t.ok(
    !preparerChecks.allowed && preparerChecks.findings.some((f) => f.reasonCode === 'preparer_is_checker'),
    'the preparer cannot be the required checker (preparer != checker)',
  );

  const delegateOfMaker = evaluateSod({ actor: checker, maker, delegatorOf: maker });
  t.ok(
    !delegateOfMaker.allowed && delegateOfMaker.findings.some((f) => f.reasonCode === 'delegate_is_maker'),
    'a delegate acting for the maker cannot bypass SoD (delegated approver cannot launder maker-checker)',
  );

  const secondApprover = evaluateSod({
    actor: checker,
    maker,
    priorApprovers: [checker],
    requireDistinctSecondApprover: true,
  });
  t.ok(
    !secondApprover.allowed && secondApprover.findings.some((f) => f.reasonCode === 'single_approver'),
    'the same actor cannot supply a required second approval (single-approver block)',
  );

  const emptyActor = evaluateSod({ actor: '   ', maker });
  t.ok(!emptyActor.allowed, 'an empty actor fails closed');

  // sodPermits only gates approving decisions
  t.ok(sodPermits('return', { actor: maker, maker }).allowed, 'a non-approving decision is not SoD-gated');
  t.ok(
    !sodPermits('approve', { actor: maker, maker }).allowed,
    'an approving decision by the maker is blocked',
  );
  t.ok(
    !sodPermits('override_approve', { actor: maker, maker }).allowed,
    'an override-approve by the maker is blocked',
  );

  // reproducible
  const a = evaluateSod({ actor: maker, maker, preparer });
  const b = evaluateSod({ actor: maker, maker, preparer });
  t.deepEqual(a, b, 'SoD evaluation is reproducible (same input => identical output)');

  // --- quorum -----------------------------------------------------------------------------------
  t.ok(checkQuorum({ approvalsCount: 2, requiredApprovals: 2 }).met, 'a met quorum reports met');
  const short = checkQuorum({ approvalsCount: 1, requiredApprovals: 2 });
  t.ok(
    !short.met && short.remaining === 1 && short.reasonCode === 'insufficient_approvals',
    'an unmet quorum reports the remaining count',
  );
  t.throws(
    () => checkQuorum({ approvalsCount: 0, requiredApprovals: 0 }),
    'requiredApprovals must be positive',
  );
  t.ok(new ApprovalEngineError('X', 'y') instanceof Error, 'ApprovalEngineError is an Error');

  // --- bounded escalation -----------------------------------------------------------------------
  const esc = canEscalate({ currentDepth: 2, maxDepth: 10 });
  t.ok(esc.ok && esc.nextDepth === 3, 'escalation within bounds advances depth');
  const capped = canEscalate({ currentDepth: 10, maxDepth: 10 });
  t.ok(
    !capped.ok && capped.reasonCode === 'escalation_depth_exceeded',
    'escalation past the max depth is blocked (bounded escalation)',
  );

  // --- permissions + audit codes ----------------------------------------------------------------
  t.equal(ALL_M22_PERMISSIONS.length, 25, 'm22 declares 25 permissions');
  t.equal(M22_PRIVILEGED_PERMISSIONS.length, 12, 'm22 has 12 privileged permissions');
  t.ok(
    ALL_M22_PERMISSIONS.every((p) => p.startsWith('approvals.') && p.split('.').length === 3),
    'every permission is a 3-segment approvals.* code',
  );
  const privList: readonly string[] = M22_PRIVILEGED_PERMISSIONS;
  const permList: readonly string[] = ALL_M22_PERMISSIONS;
  t.ok(privList.includes('approvals.decision.approve'), 'decision.approve is privileged');
  t.ok(privList.includes('approvals.decision.override'), 'decision.override is privileged');
  t.ok(
    !permList.includes('approvals.decision.post'),
    'there is no approvals.decision.post — m22 never posts',
  );
  t.ok(!permList.includes('approvals.admin'), 'there is no vague approvals.admin');
  t.equal(ALL_M22_AUDIT_CODES.length, 23, 'm22 declares 23 audit codes');
  t.ok(
    ALL_M22_AUDIT_CODES.every((c) => c.startsWith(APPROVAL_AUDIT_PREFIX) && c.split('_').length >= 3),
    'every audit code is APPROVAL_ SCREAMING_SNAKE with >= 3 segments',
  );
  t.ok(new Set(ALL_M22_AUDIT_CODES).size === ALL_M22_AUDIT_CODES.length, 'no audit code is declared twice');
  t.ok(
    (ALL_M22_AUDIT_CODES as readonly string[]).includes('APPROVAL_SOD_BLOCKED'),
    'a blocked SoD attempt is auditable (fail closed — no silent refusal)',
  );
});
