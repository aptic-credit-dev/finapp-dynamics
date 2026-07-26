import { defineSuite } from '@finapp/test-runner';
import {
  CASE_LIMITS,
  CaseError,
  CASE_SOURCES,
  isCaseSource,
  CONFIDENTIALITY_LEVELS,
  isConfidentiality,
  confidentialityRank,
  SEVERITIES,
  isSeverity,
  PRIORITIES,
  isPriority,
  isPartyType,
  FINDING_TYPES,
  isFindingType,
  isDecisionType,
  DEADLINE_TYPES,
  isDeadlineType,
  HEARING_TYPES,
  isHearingType,
  EVIDENCE_TYPES,
  isEvidenceType,
  RECOVERY_STAGES,
  isRecoveryStage,
  NOTE_TYPES,
  isNoteType,
  isRestrictedNote,
} from '../src/domain/limits.ts';
import {
  CASE_STATUSES,
  checkCaseTransition,
  isCaseTerminal,
  isCaseOpen,
  SPEC_STATUSES,
  checkSpecTransition,
  isSpecFrozen,
} from '../src/domain/lifecycles.ts';
import { validateCaseTypeSpec, type CaseTypeSpec } from '../src/domain/casetype.ts';
import {
  validateCaseSlaPolicySpec,
  computeDueDates,
  slaStageState,
  type CaseSlaPolicySpec,
} from '../src/domain/sla.ts';
import { computeDeadlineDueMs, deadlineState, isLimitationSafe } from '../src/domain/deadlines.ts';
import {
  evaluateClosure,
  RELATIONSHIP_KINDS,
  isRelationshipKind,
  isSelfRelation,
  type ClosureState,
} from '../src/domain/closure.ts';
import { formatCaseNumber, isValidCaseNumber } from '../src/case-number.ts';
import { contentHashOf, canonicalJson } from '../src/hash.ts';
import { SystemClock, FixedClock, InMemoryHandoffSource } from '../src/ports.ts';

function goodType(): CaseTypeSpec {
  return {
    schemaVersion: 1,
    code: 'complaint',
    name: 'Customer complaint',
    category: 'complaint',
    defaultConfidentiality: 'confidential',
    defaultPriority: 'high',
    defaultSeverity: 'medium',
    requiredRoles: ['owner'],
    investigationSupport: true,
  };
}
function goodSla(): CaseSlaPolicySpec {
  return {
    schemaVersion: 1,
    code: 'standard',
    name: 'Standard',
    ackMinutes: 60,
    triageMinutes: 240,
    assignMinutes: 480,
    investigationMinutes: 2880,
    responseMinutes: 1440,
    resolutionMinutes: 5760,
    closureMinutes: 7200,
    warnThresholdPct: 80,
  };
}
function closable(): ClosureState {
  return {
    workflowComplete: true,
    openMandatoryTasks: 0,
    findingsRecorded: true,
    decisionApproved: true,
    requiredDocumentsPresent: true,
    openDeadlines: 0,
    subjectInformed: true,
    remedyRecorded: true,
    settlementResolved: true,
    activeLegalHold: false,
    openCriticalEscalations: 0,
    unresolvedMandatoryIssues: 0,
    regulatoryActionComplete: true,
  };
}

export default defineSuite('m13-case', (t) => {
  // --- vocabulary -------------------------------------------------------------------------------
  t.ok(isCaseSource('feedback_handoff') && !isCaseSource('telepathy'), 'case source recognized');
  t.equal(CASE_SOURCES.length, 9, 'nine case sources');
  t.equal(CONFIDENTIALITY_LEVELS.length, 4, 'four confidentiality levels');
  t.ok(isConfidentiality('privileged') && !isConfidentiality('secret'), 'confidentiality recognized');
  t.ok(confidentialityRank('privileged') > confidentialityRank('standard'), 'confidentiality ranks order');
  t.ok(isSeverity('critical') && !isSeverity('meh'), 'severity recognized');
  t.ok(isPriority('urgent') && !isPriority('whenever'), 'priority recognized');
  t.ok(isPartyType('advocate') && isPartyType('regulator') && !isPartyType('alien'), 'party type recognized');
  t.equal(FINDING_TYPES.length, 6, 'six finding types');
  t.ok(isFindingType('substantiated') && !isFindingType('maybe'), 'finding type recognized');
  t.ok(isDecisionType('uphold_complaint') && !isDecisionType('shrug'), 'decision type recognized');
  t.ok(isDeadlineType('limitation') && !isDeadlineType('someday'), 'deadline type recognized');
  t.ok(
    isHearingType('mention') && isHearingType('judgment') && !isHearingType('party'),
    'hearing type recognized',
  );
  t.ok(isEvidenceType('testimony') && !isEvidenceType('vibes'), 'evidence type recognized');
  t.ok(isRecoveryStage('enforcement') && !isRecoveryStage('magic'), 'recovery stage recognized');
  t.ok(
    isNoteType('privileged') && isRestrictedNote('privileged') && !isRestrictedNote('general'),
    'restricted note recognized',
  );
  t.ok(new CaseError('X', 'y') instanceof Error, 'CaseError is an Error');
  t.equal(CASE_LIMITS.maxSearchLimit, 200, 'search bounded');
  t.ok(
    SEVERITIES.length === 4 &&
      PRIORITIES.length === 4 &&
      DEADLINE_TYPES.length === 11 &&
      HEARING_TYPES.length === 12 &&
      EVIDENCE_TYPES.length === 8 &&
      RECOVERY_STAGES.length === 11 &&
      NOTE_TYPES.length === 5,
    'vocab sizes',
  );

  // --- case lifecycle ---------------------------------------------------------------------------
  t.equal(CASE_STATUSES.length, 18, 'eighteen case states');
  t.ok(checkCaseTransition('draft', 'opened').ok, 'draft -> opened ok');
  t.ok(checkCaseTransition('assigned', 'investigation').ok, 'assigned -> investigation ok');
  t.ok(!checkCaseTransition('draft', 'closed').ok, 'draft -> closed rejected');
  t.ok(checkCaseTransition('resolved', 'closed').ok, 'resolved -> closed ok');
  t.ok(checkCaseTransition('closed', 'reopened').ok, 'closed -> reopened ok');
  t.ok(checkCaseTransition('closed', 'archived').ok, 'closed -> archived ok');
  t.ok(!checkCaseTransition('archived', 'reopened').ok, 'archived is terminal');
  t.ok(!checkCaseTransition('cancelled', 'opened').ok, 'cancelled is terminal');
  t.ok(!checkCaseTransition('nowhere', 'closed').ok, 'unknown state rejected');
  t.ok(
    isCaseTerminal('archived') && isCaseTerminal('cancelled') && !isCaseTerminal('closed'),
    'terminals (closed is reopenable)',
  );
  t.ok(isCaseOpen('assigned') && !isCaseOpen('closed') && !isCaseOpen('archived'), 'open check');

  // --- spec lifecycle ---------------------------------------------------------------------------
  t.equal(SPEC_STATUSES.length, 6, 'six spec states');
  t.ok(checkSpecTransition('DRAFT', 'validate').ok, 'DRAFT -> validate ok');
  t.ok(!checkSpecTransition('DRAFT', 'publish').ok, 'DRAFT -> publish rejected');
  t.ok(!isSpecFrozen('DRAFT') && isSpecFrozen('PUBLISHED') && isSpecFrozen('ACTIVE'), 'frozen at publish');

  // --- case type + sla spec validation ----------------------------------------------------------
  t.ok(validateCaseTypeSpec(goodType()).ok, 'good case type validates');
  t.ok(!validateCaseTypeSpec({ ...goodType(), code: '9bad' }).ok, 'bad code rejected');
  t.ok(
    !validateCaseTypeSpec({ ...goodType(), defaultPriority: 'nope' }).ok,
    'invalid default priority rejected',
  );
  t.ok(
    !validateCaseTypeSpec({ ...goodType(), requiredRoles: [1, 2] as unknown as string[] }).ok,
    'non-string required roles rejected',
  );
  t.ok(validateCaseSlaPolicySpec(goodSla()).ok, 'good sla policy validates');
  t.ok(!validateCaseSlaPolicySpec({ ...goodSla(), resolutionMinutes: -1 }).ok, 'negative minutes rejected');
  t.ok(!validateCaseSlaPolicySpec({ ...goodSla(), warnThresholdPct: 150 }).ok, 'warn pct > 100 rejected');

  // --- SLA due dates + stage state (deterministic) ----------------------------------------------
  const start = 1_700_000_000_000;
  const due = computeDueDates(goodSla(), start);
  t.equal(due.resolutionAtMs, start + 5760 * 60_000, 'resolution due computed deterministically');
  t.ok(
    !slaStageState({
      startMs: start,
      dueMs: due.resolutionAtMs,
      nowMs: start + 1000,
      pausedMs: 0,
      warnThresholdPct: 80,
    }).breached,
    'fresh SLA not breached',
  );
  t.ok(
    slaStageState({
      startMs: start,
      dueMs: due.resolutionAtMs,
      nowMs: due.resolutionAtMs + 1,
      pausedMs: 0,
      warnThresholdPct: 80,
    }).breached,
    'past due breaches',
  );
  t.ok(
    slaStageState({
      startMs: start,
      dueMs: due.resolutionAtMs,
      nowMs: start + 5760 * 60_000 * 0.9,
      pausedMs: 0,
      warnThresholdPct: 80,
    }).warn,
    'warn fires past threshold',
  );

  // --- deadline calculation ---------------------------------------------------------------------
  t.equal(
    computeDeadlineDueMs({ type: 'response', startMs: start, rule: { kind: 'offset_days', days: 14 } }),
    start + 14 * 86_400_000,
    'offset_days deadline deterministic',
  );
  t.equal(
    computeDeadlineDueMs({ type: 'hearing', startMs: start, rule: { kind: 'explicit', dueMs: start + 999 } }),
    start + 999,
    'explicit deadline honored',
  );
  t.throws(
    () =>
      computeDeadlineDueMs({ type: 'not_a_type', startMs: start, rule: { kind: 'offset_days', days: 1 } }),
    'invalid deadline type rejected',
  );
  t.throws(
    () => computeDeadlineDueMs({ type: 'response', startMs: start, rule: { kind: 'offset_days', days: -1 } }),
    'negative offset rejected',
  );
  const ds = deadlineState({ dueMs: start + 1000, nowMs: start + 2000, warnWindowMs: 500 });
  t.ok(ds.breached && ds.remainingMs < 0, 'past-due deadline is breached');
  t.ok(
    deadlineState({ dueMs: start + 1000, nowMs: start + 800, warnWindowMs: 500 }).warn,
    'deadline warns inside window',
  );
  t.ok(
    isLimitationSafe('limitation', start + 1000, start) && !isLimitationSafe('limitation', start - 1, start),
    'limitation safety check',
  );

  // --- closure eligibility ----------------------------------------------------------------------
  t.ok(
    evaluateClosure(
      { requireDecisionApproved: true, requireMandatoryTasksComplete: true, requireNoActiveLegalHold: true },
      closable(),
    ).eligible,
    'a fully-worked case is closable',
  );
  const blocked = evaluateClosure(
    { requireDecisionApproved: true, requireNoActiveLegalHold: true, requireNoOpenCriticalEscalation: true },
    { ...closable(), decisionApproved: false, activeLegalHold: true, openCriticalEscalations: 2 },
  );
  t.ok(!blocked.eligible, 'unmet criteria block closure');
  t.ok(
    blocked.reasonCodes.includes('DECISION_NOT_APPROVED') &&
      blocked.reasonCodes.includes('ACTIVE_LEGAL_HOLD') &&
      blocked.reasonCodes.includes('OPEN_CRITICAL_ESCALATION'),
    'reason codes explainable',
  );

  // --- relationships ----------------------------------------------------------------------------
  t.equal(RELATIONSHIP_KINDS.length, 9, 'nine relationship kinds');
  t.ok(isRelationshipKind('appeal_of') && !isRelationshipKind('vibes_with'), 'relationship kind recognized');
  t.ok(isSelfRelation('a', 'a') && !isSelfRelation('a', 'b'), 'self-relation check');

  // --- case number ------------------------------------------------------------------------------
  t.ok(isValidCaseNumber(formatCaseNumber('0123456789abcdef-0000')), 'formatted case number is valid');
  t.equal(formatCaseNumber('0123456789ab'), 'CASE-0123456789ab', 'case number format is deterministic');
  t.ok(!isValidCaseNumber('CASE-XYZ') && !isValidCaseNumber('nope'), 'malformed case number rejected');

  // --- hash --------------------------------------------------------------------------------------
  t.equal(
    contentHashOf({ a: 1, b: 2 }),
    contentHashOf({ b: 2, a: 1 }),
    'content hash is key-order independent',
  );
  t.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}', 'canonical json sorts keys');

  // --- clock + handoff ports --------------------------------------------------------------------
  t.ok(new SystemClock().now() > 0, 'system clock returns epoch ms');
  const fixed = new FixedClock(start);
  fixed.advance(1000);
  t.equal(fixed.now(), start + 1000, 'fixed clock advances deterministically');
  const src = new InMemoryHandoffSource();
  src.seed({
    handoffId: 'h1',
    feedbackId: 'f1',
    status: 'pending',
    recommendedCaseType: 'complaint',
    severity: 'high',
    category: null,
    product: null,
    customerRef: null,
    sourceTransactionId: null,
  });
  t.ok(
    src.getHandoff({ tenantId: 't', correlationId: 'c', permissions: [] }, 'h1') instanceof Promise,
    'in-memory handoff source resolves',
  );
});
