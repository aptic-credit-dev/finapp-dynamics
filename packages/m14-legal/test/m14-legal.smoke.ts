import { defineSuite } from '@finapp/test-runner';
import {
  LEGAL_LIMITS,
  LegalError,
  MATTER_SOURCES,
  isMatterSource,
  CONFIDENTIALITY_LEVELS,
  isConfidentiality,
  confidentialityRank,
  LEGAL_RISKS,
  isLegalRisk,
  PRIORITIES,
  isPriority,
  isPartyRole,
  DEADLINE_TYPES,
  isDeadlineType,
  COURT_EVENT_TYPES,
  isCourtEventType,
  isPleadingRole,
  OUTCOME_TYPES,
  isOutcomeType,
  ENFORCEMENT_STAGES,
  isEnforcementStage,
  NOTE_TYPES,
  isNoteType,
  isRestrictedNote,
} from '../src/domain/limits.ts';
import {
  MATTER_STATUSES,
  checkMatterTransition,
  isMatterTerminal,
  isMatterOpen,
  SPEC_STATUSES,
  checkSpecTransition,
  isSpecFrozen,
} from '../src/domain/lifecycles.ts';
import { validateMatterTypeSpec, type MatterTypeSpec } from '../src/domain/mattertype.ts';
import {
  validateLegalSlaPolicySpec,
  computeDueDates,
  slaStageState,
  type LegalSlaPolicySpec,
} from '../src/domain/sla.ts';
import {
  computeDeadlineDueMs,
  deadlineState,
  isLimitationSafe,
  isLimitation,
} from '../src/domain/deadlines.ts';
import {
  evaluateClosure,
  RELATIONSHIP_KINDS,
  isRelationshipKind,
  isSelfRelation,
  type ClosureState,
} from '../src/domain/closure.ts';
import { formatMatterNumber, isValidMatterNumber } from '../src/matter-number.ts';
import { contentHashOf, canonicalJson } from '../src/hash.ts';
import { SystemClock, FixedClock } from '../src/ports.ts';

function goodType(): MatterTypeSpec {
  return {
    schemaVersion: 1,
    code: 'litigation',
    name: 'Litigation',
    category: 'litigation',
    defaultConfidentiality: 'privileged',
    defaultRisk: 'high',
    defaultPriority: 'high',
    requiredRoles: ['legal_officer'],
    courtEventSupport: true,
    appealSupport: true,
  };
}
function goodSla(): LegalSlaPolicySpec {
  return {
    schemaVersion: 1,
    code: 'standard',
    name: 'Standard',
    ackMinutes: 60,
    reviewMinutes: 480,
    opinionMinutes: 2880,
    pleadingMinutes: 4320,
    counselUpdateMinutes: 10080,
    resolutionMinutes: 43200,
    closureMinutes: 86400,
    warnThresholdPct: 80,
  };
}
function closable(): ClosureState {
  return {
    instructionsComplete: true,
    workflowComplete: true,
    openMandatoryTasks: 0,
    openDeadlines: 0,
    imminentLimitation: false,
    requiredPleadingsFiled: true,
    outcomeRecorded: true,
    appealDispositioned: true,
    enforcementDispositioned: true,
    counselFinalReport: true,
    costsRecorded: true,
    exposureReviewed: true,
    activeLegalHold: false,
    openCriticalEscalations: 0,
    businessOwnerInformed: true,
    closureApproved: true,
  };
}

export default defineSuite('m14-legal', (t) => {
  // --- vocabulary -------------------------------------------------------------------------------
  t.ok(isMatterSource('case_conversion') && !isMatterSource('telepathy'), 'matter source recognized');
  t.equal(MATTER_SOURCES.length, 15, 'fifteen matter sources');
  t.equal(CONFIDENTIALITY_LEVELS.length, 4, 'four confidentiality levels');
  t.ok(isConfidentiality('privileged') && !isConfidentiality('secret'), 'confidentiality recognized');
  t.ok(confidentialityRank('privileged') > confidentialityRank('standard'), 'confidentiality ranks order');
  t.ok(isLegalRisk('critical') && !isLegalRisk('meh'), 'legal risk recognized');
  t.ok(isPriority('urgent') && !isPriority('whenever'), 'priority recognized');
  t.ok(isPartyRole('advocate') && isPartyRole('plaintiff') && !isPartyRole('alien'), 'party role recognized');
  t.ok(isDeadlineType('limitation') && !isDeadlineType('someday'), 'deadline type recognized');
  t.ok(
    isCourtEventType('mention') && isCourtEventType('judgment') && !isCourtEventType('party'),
    'court event type recognized',
  );
  t.ok(
    isPleadingRole('affidavit') && isPleadingRole('notice_of_appeal') && !isPleadingRole('vibes'),
    'pleading role recognized',
  );
  t.ok(isOutcomeType('final_judgment') && !isOutcomeType('shrug'), 'outcome type recognized');
  t.ok(isEnforcementStage('execution') && !isEnforcementStage('magic'), 'enforcement stage recognized');
  t.ok(
    isNoteType('privileged') &&
      isRestrictedNote('strategy') &&
      isRestrictedNote('counsel') &&
      !isRestrictedNote('general'),
    'restricted note recognized',
  );
  t.ok(new LegalError('X', 'y') instanceof Error, 'LegalError is an Error');
  t.equal(LEGAL_LIMITS.maxSearchLimit, 200, 'search bounded');
  t.ok(
    LEGAL_RISKS.length === 4 &&
      PRIORITIES.length === 4 &&
      DEADLINE_TYPES.length === 15 &&
      COURT_EVENT_TYPES.length === 13 &&
      OUTCOME_TYPES.length === 9 &&
      ENFORCEMENT_STAGES.length === 11 &&
      NOTE_TYPES.length === 6,
    'vocab sizes',
  );

  // --- matter lifecycle -------------------------------------------------------------------------
  t.equal(MATTER_STATUSES.length, 25, 'twenty-five matter states');
  t.ok(checkMatterTransition('draft', 'instructed').ok, 'draft -> instructed ok');
  t.ok(checkMatterTransition('filed', 'active_litigation').ok, 'filed -> active_litigation ok');
  t.ok(!checkMatterTransition('draft', 'closed').ok, 'draft -> closed rejected');
  t.ok(checkMatterTransition('judgment_entered', 'appeal_pending').ok, 'judgment -> appeal ok');
  t.ok(checkMatterTransition('resolved', 'closed').ok, 'resolved -> closed ok');
  t.ok(checkMatterTransition('closed', 'reopened').ok, 'closed -> reopened ok');
  t.ok(checkMatterTransition('closed', 'archived').ok, 'closed -> archived ok');
  t.ok(!checkMatterTransition('archived', 'reopened').ok, 'archived is terminal');
  t.ok(!checkMatterTransition('nowhere', 'closed').ok, 'unknown state rejected');
  t.ok(
    isMatterTerminal('archived') && !isMatterTerminal('closed') && !isMatterTerminal('withdrawn'),
    'terminals (only archived)',
  );
  t.ok(
    isMatterOpen('active_litigation') && !isMatterOpen('closed') && !isMatterOpen('archived'),
    'open check',
  );

  // --- spec lifecycle ---------------------------------------------------------------------------
  t.equal(SPEC_STATUSES.length, 6, 'six spec states');
  t.ok(checkSpecTransition('DRAFT', 'validate').ok, 'DRAFT -> validate ok');
  t.ok(!checkSpecTransition('DRAFT', 'publish').ok, 'DRAFT -> publish rejected');
  t.ok(!isSpecFrozen('DRAFT') && isSpecFrozen('PUBLISHED') && isSpecFrozen('ACTIVE'), 'frozen at publish');

  // --- matter type + sla spec validation --------------------------------------------------------
  t.ok(validateMatterTypeSpec(goodType()).ok, 'good matter type validates');
  t.ok(!validateMatterTypeSpec({ ...goodType(), code: '9bad' }).ok, 'bad code rejected');
  t.ok(!validateMatterTypeSpec({ ...goodType(), defaultRisk: 'nope' }).ok, 'invalid default risk rejected');
  t.ok(
    !validateMatterTypeSpec({ ...goodType(), requiredRoles: [1] as unknown as string[] }).ok,
    'non-string required roles rejected',
  );
  t.ok(validateLegalSlaPolicySpec(goodSla()).ok, 'good sla policy validates');
  t.ok(!validateLegalSlaPolicySpec({ ...goodSla(), resolutionMinutes: -1 }).ok, 'negative minutes rejected');
  t.ok(!validateLegalSlaPolicySpec({ ...goodSla(), warnThresholdPct: 150 }).ok, 'warn pct > 100 rejected');

  // --- SLA + deadlines --------------------------------------------------------------------------
  const start = 1_700_000_000_000;
  const due = computeDueDates(goodSla(), start);
  t.equal(due.resolutionAtMs, start + 43200 * 60_000, 'resolution due computed deterministically');
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
  t.equal(
    computeDeadlineDueMs({ type: 'filing', startMs: start, rule: { kind: 'offset_days', days: 21 } }),
    start + 21 * 86_400_000,
    'offset_days deadline deterministic',
  );
  t.throws(
    () =>
      computeDeadlineDueMs({ type: 'not_a_type', startMs: start, rule: { kind: 'offset_days', days: 1 } }),
    'invalid deadline type rejected',
  );
  t.ok(
    deadlineState({ dueMs: start + 1000, nowMs: start + 2000, warnWindowMs: 500 }).breached,
    'past-due deadline is breached',
  );
  t.ok(isLimitation('limitation') && !isLimitation('filing'), 'limitation flagged');
  t.ok(
    isLimitationSafe('limitation', start + 1000, start) && !isLimitationSafe('limitation', start - 1, start),
    'limitation safety check',
  );

  // --- closure eligibility ----------------------------------------------------------------------
  t.ok(
    evaluateClosure(
      { requireOutcomeRecorded: true, requireNoActiveLegalHold: true, requireNoImminentLimitation: true },
      closable(),
    ).eligible,
    'a fully-worked matter is closable',
  );
  const blocked = evaluateClosure(
    { requireOutcomeRecorded: true, requireNoActiveLegalHold: true, requireNoImminentLimitation: true },
    { ...closable(), outcomeRecorded: false, activeLegalHold: true, imminentLimitation: true },
  );
  t.ok(!blocked.eligible, 'unmet criteria block closure');
  t.ok(
    blocked.reasonCodes.includes('OUTCOME_MISSING') &&
      blocked.reasonCodes.includes('ACTIVE_LEGAL_HOLD') &&
      blocked.reasonCodes.includes('IMMINENT_LIMITATION'),
    'reason codes explainable',
  );

  // --- relationships ----------------------------------------------------------------------------
  t.equal(RELATIONSHIP_KINDS.length, 11, 'eleven relationship kinds');
  t.ok(
    isRelationshipKind('appeal_of') &&
      isRelationshipKind('converted_from_case') &&
      !isRelationshipKind('vibes_with'),
    'relationship kind recognized',
  );
  t.ok(isSelfRelation('a', 'a') && !isSelfRelation('a', 'b'), 'self-relation check');

  // --- matter number ----------------------------------------------------------------------------
  t.ok(isValidMatterNumber(formatMatterNumber('0123456789abcdef-0000')), 'formatted matter number is valid');
  t.equal(formatMatterNumber('0123456789ab'), 'MATTER-0123456789ab', 'matter number format is deterministic');
  t.ok(
    !isValidMatterNumber('MATTER-XYZ') && !isValidMatterNumber('nope'),
    'malformed matter number rejected',
  );

  // --- hash + clock -----------------------------------------------------------------------------
  t.equal(
    contentHashOf({ a: 1, b: 2 }),
    contentHashOf({ b: 2, a: 1 }),
    'content hash is key-order independent',
  );
  t.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}', 'canonical json sorts keys');
  t.ok(new SystemClock().now() > 0, 'system clock returns epoch ms');
  const fixed = new FixedClock(start);
  fixed.advance(1000);
  t.equal(fixed.now(), start + 1000, 'fixed clock advances deterministically');
});
