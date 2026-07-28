import { defineSuite } from '@finapp/test-runner';
import {
  RECOVERY_LIMITS,
  RecoveryError,
  RECOVERY_SOURCES,
  isRecoverySource,
  INSTRUMENT_TYPES,
  isInstrumentType,
  isRecoveryStrategy,
  CONFIDENTIALITY_LEVELS,
  isConfidentiality,
  confidentialityRank,
  RECOVERY_RISKS,
  isRecoveryRisk,
  isPriority,
  PARTY_ROLES,
  isPartyRole,
  DEMAND_TYPES,
  isDemandType,
  ARRANGEMENT_TYPES,
  isArrangementType,
  ENFORCEMENT_ACTION_TYPES,
  isEnforcementActionType,
  SECURITY_TYPES,
  isSecurityType,
  RECEIPT_TYPES,
  isReceiptType,
  DEADLINE_TYPES,
  isDeadlineType,
  COST_TYPES,
  isCostType,
  WRITEOFF_REASONS,
  isWriteOffReason,
  OUTCOME_TYPES,
  isOutcomeType,
  NOTE_TYPES,
  isNoteType,
  isRestrictedNote,
  RECOVERY_STATUSES,
  checkRecoveryTransition,
  isRecoveryTerminal,
  isRecoveryOpen,
  SPEC_STATUSES,
  checkSpecTransition,
  isSpecFrozen,
  RECOVERY_TYPE_SCHEMA_VERSION,
  validateRecoveryTypeSpec,
  type RecoveryTypeSpec,
  SLA_POLICY_SCHEMA_VERSION,
  validateRecoverySlaPolicySpec,
  computeDueDates,
  slaStageState,
  type RecoverySlaPolicySpec,
  computeDeadlineDueMs,
  deadlineState,
  isLimitationSafe,
  isLimitation,
  evaluateClosure,
  RELATIONSHIP_KINDS,
  isRelationshipKind,
  isSelfRelation,
  type ClosureState,
  formatRecoveryNumber,
  isValidRecoveryNumber,
  contentHashOf,
  canonicalJson,
  SystemClock,
  FixedClock,
} from '../src/index.ts';

function goodType(): RecoveryTypeSpec {
  return {
    schemaVersion: 1,
    code: 'judgment_recovery',
    name: 'Judgment Recovery',
    category: 'litigation',
    eligibleInstruments: ['judgment'],
    eligibleStrategies: ['demand', 'enforcement'],
    defaultConfidentiality: 'privileged',
    defaultRisk: 'high',
    defaultPriority: 'high',
    demandSupport: true,
    enforcementSupport: true,
    writeOffSupport: true,
  };
}
function goodSla(): RecoverySlaPolicySpec {
  return {
    schemaVersion: 1,
    code: 'standard',
    name: 'Standard',
    ackMinutes: 60,
    strategyMinutes: 480,
    demandMinutes: 960,
    responseMinutes: 2880,
    arrangementReviewMinutes: 4320,
    enforcementFilingMinutes: 5760,
    agentReportMinutes: 10080,
    reviewMinutes: 20160,
    closureMinutes: 43200,
    warnThresholdPct: 80,
  };
}
function closable(): ClosureState {
  return {
    outcomeRecorded: true,
    openDeadlines: 0,
    openEnforcementActions: 0,
    activeArrangement: false,
    writeOffDispositioned: true,
    imminentLimitation: false,
    agentFinalReport: true,
    openCriticalEscalations: 0,
    sourceUpdateEmitted: true,
    closureApproved: true,
  };
}

export default defineSuite('m17-recovery', (t) => {
  // --- vocabulary -------------------------------------------------------------------------------
  t.ok(
    isRecoverySource('enforcement_referral') && !isRecoverySource('telepathy'),
    'recovery source recognized',
  );
  t.equal(RECOVERY_SOURCES.length, 16, 'sixteen recovery sources');
  t.ok(
    isInstrumentType('judgment') && isInstrumentType('debenture') && !isInstrumentType('vibes'),
    'instrument type recognized',
  );
  t.equal(INSTRUMENT_TYPES.length, 18, 'eighteen instrument types');
  t.ok(
    isRecoveryStrategy('enforcement') && isRecoveryStrategy('negotiation') && !isRecoveryStrategy('hope'),
    'strategy recognized',
  );
  t.equal(CONFIDENTIALITY_LEVELS.length, 4, 'four confidentiality levels');
  t.ok(isConfidentiality('privileged') && !isConfidentiality('secret'), 'confidentiality recognized');
  t.ok(confidentialityRank('privileged') > confidentialityRank('standard'), 'confidentiality ranks order');
  t.ok(isRecoveryRisk('critical') && !isRecoveryRisk('meh'), 'recovery risk recognized');
  t.ok(isPriority('urgent') && !isPriority('whenever'), 'priority recognized');
  t.ok(
    isPartyRole('guarantor') && isPartyRole('judgment_debtor') && !isPartyRole('alien'),
    'party role recognized',
  );
  t.ok(isDemandType('statutory_demand') && !isDemandType('gentle_ask'), 'demand type recognized');
  t.ok(
    isArrangementType('installment') && isArrangementType('moratorium') && !isArrangementType('handshake'),
    'arrangement type recognized',
  );
  t.ok(
    isEnforcementActionType('garnishee') &&
      isEnforcementActionType('auction') &&
      !isEnforcementActionType('nagging'),
    'enforcement action recognized',
  );
  t.ok(
    isSecurityType('real_property') && isSecurityType('debenture') && !isSecurityType('promise'),
    'security type recognized',
  );
  t.ok(
    isReceiptType('bank_transfer') && isReceiptType('auction_proceeds') && !isReceiptType('iou'),
    'receipt type recognized',
  );
  t.ok(
    isDeadlineType('limitation') && isDeadlineType('demand_response') && !isDeadlineType('someday'),
    'deadline type recognized',
  );
  t.ok(
    isCostType('auctioneer_fee') && isCostType('agent_fee') && !isCostType('bribe'),
    'cost type recognized',
  );
  t.ok(
    isWriteOffReason('insolvent_debtor') && isWriteOffReason('statute_barred') && !isWriteOffReason('lazy'),
    'write-off reason recognized',
  );
  t.ok(
    isOutcomeType('fully_recovered') && isOutcomeType('written_off') && !isOutcomeType('shrug'),
    'outcome type recognized',
  );
  t.ok(
    isNoteType('privileged') &&
      isRestrictedNote('strategy') &&
      isRestrictedNote('agent') &&
      !isRestrictedNote('general'),
    'restricted note recognized',
  );
  t.ok(new RecoveryError('X', 'y') instanceof Error, 'RecoveryError is an Error');
  t.equal(RECOVERY_LIMITS.maxSearchLimit, 200, 'search bounded');
  t.ok(
    PARTY_ROLES.length === 14 &&
      DEMAND_TYPES.length === 7 &&
      ARRANGEMENT_TYPES.length === 6 &&
      ENFORCEMENT_ACTION_TYPES.length === 16 &&
      SECURITY_TYPES.length === 11 &&
      RECEIPT_TYPES.length === 10 &&
      DEADLINE_TYPES.length === 12 &&
      COST_TYPES.length === 9 &&
      WRITEOFF_REASONS.length === 10 &&
      OUTCOME_TYPES.length === 8 &&
      NOTE_TYPES.length === 6 &&
      RECOVERY_RISKS.length === 4,
    'vocab sizes',
  );

  // --- recovery lifecycle -----------------------------------------------------------------------
  t.equal(RECOVERY_STATUSES.length, 29, 'twenty-nine recovery states');
  t.ok(checkRecoveryTransition('draft', 'referred').ok, 'draft -> referred ok');
  t.ok(checkRecoveryTransition('strategy_selection', 'demand_issued').ok, 'strategy -> demand ok');
  t.ok(checkRecoveryTransition('negotiation', 'arrangement_pending').ok, 'negotiation -> arrangement ok');
  t.ok(checkRecoveryTransition('enforcement_active', 'auction').ok, 'enforcement -> auction ok');
  t.ok(checkRecoveryTransition('recovered', 'resolved').ok, 'recovered -> resolved ok');
  t.ok(
    checkRecoveryTransition('write_off_recommended', 'written_off').ok,
    'write-off recommended -> written_off ok',
  );
  t.ok(checkRecoveryTransition('resolved', 'closed').ok, 'resolved -> closed ok');
  t.ok(checkRecoveryTransition('closed', 'reopened').ok, 'closed -> reopened ok');
  t.ok(checkRecoveryTransition('closed', 'archived').ok, 'closed -> archived ok');
  t.ok(!checkRecoveryTransition('draft', 'closed').ok, 'draft -> closed rejected');
  t.ok(!checkRecoveryTransition('archived', 'reopened').ok, 'archived is terminal');
  t.ok(!checkRecoveryTransition('nowhere', 'closed').ok, 'unknown state rejected');
  t.ok(
    isRecoveryTerminal('archived') && !isRecoveryTerminal('closed') && !isRecoveryTerminal('written_off'),
    'only archived is terminal',
  );
  t.ok(
    isRecoveryOpen('enforcement_active') && !isRecoveryOpen('closed') && !isRecoveryOpen('archived'),
    'open check',
  );

  // --- spec lifecycle ---------------------------------------------------------------------------
  t.equal(SPEC_STATUSES.length, 6, 'six spec states');
  t.ok(checkSpecTransition('DRAFT', 'validate').ok, 'DRAFT -> validate ok');
  t.ok(!checkSpecTransition('DRAFT', 'publish').ok, 'DRAFT -> publish rejected');
  t.ok(!isSpecFrozen('DRAFT') && isSpecFrozen('PUBLISHED') && isSpecFrozen('ACTIVE'), 'frozen at publish');

  // --- recovery-type + sla spec validation ------------------------------------------------------
  t.equal(RECOVERY_TYPE_SCHEMA_VERSION, 1, 'recovery-type schema v1');
  t.ok(validateRecoveryTypeSpec(goodType()).ok, 'good recovery type validates');
  t.ok(!validateRecoveryTypeSpec({ ...goodType(), code: '9bad' }).ok, 'bad code rejected');
  t.ok(!validateRecoveryTypeSpec({ ...goodType(), defaultRisk: 'nope' }).ok, 'invalid default risk rejected');
  t.ok(
    !validateRecoveryTypeSpec({ ...goodType(), eligibleInstruments: [1] as unknown as string[] }).ok,
    'non-string instrument list rejected',
  );
  t.equal(SLA_POLICY_SCHEMA_VERSION, 1, 'sla schema v1');
  t.ok(validateRecoverySlaPolicySpec(goodSla()).ok, 'good sla policy validates');
  t.ok(!validateRecoverySlaPolicySpec({ ...goodSla(), demandMinutes: -1 }).ok, 'negative minutes rejected');
  t.ok(!validateRecoverySlaPolicySpec({ ...goodSla(), warnThresholdPct: 150 }).ok, 'warn pct > 100 rejected');

  // --- SLA + deadlines --------------------------------------------------------------------------
  const start = 1_700_000_000_000;
  const due = computeDueDates(goodSla(), start);
  t.equal(due.closureAtMs, start + 43200 * 60_000, 'closure due computed deterministically');
  t.ok(
    slaStageState({
      startMs: start,
      dueMs: due.demandAtMs,
      nowMs: due.demandAtMs + 1,
      pausedMs: 0,
      warnThresholdPct: 80,
    }).breached,
    'past due breaches',
  );
  t.equal(
    computeDeadlineDueMs({
      type: 'demand_response',
      startMs: start,
      rule: { kind: 'offset_days', days: 21 },
    }),
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
  t.ok(isLimitation('limitation') && !isLimitation('demand_response'), 'limitation flagged');
  t.ok(
    isLimitationSafe('limitation', start + 1000, start) && !isLimitationSafe('limitation', start - 1, start),
    'limitation safety check',
  );

  // --- closure eligibility ----------------------------------------------------------------------
  const crit = {
    requireOutcomeRecorded: true,
    requireDeadlinesDispositioned: true,
    requireNoOpenEnforcementAction: true,
    requireNoActiveArrangement: true,
    requireWriteOffDispositioned: true,
    requireNoImminentLimitation: true,
  };
  t.ok(evaluateClosure(crit, closable()).eligible, 'a fully-worked recovery is closable');
  const blocked = evaluateClosure(crit, {
    ...closable(),
    outcomeRecorded: false,
    openEnforcementActions: 1,
    activeArrangement: true,
    imminentLimitation: true,
  });
  t.ok(!blocked.eligible, 'unmet criteria block closure');
  t.ok(
    blocked.reasonCodes.includes('OUTCOME_MISSING') &&
      blocked.reasonCodes.includes('OPEN_ENFORCEMENT_ACTION') &&
      blocked.reasonCodes.includes('ACTIVE_ARRANGEMENT') &&
      blocked.reasonCodes.includes('IMMINENT_LIMITATION'),
    'reason codes explainable',
  );

  // --- relationships ----------------------------------------------------------------------------
  t.equal(RELATIONSHIP_KINDS.length, 11, 'eleven relationship kinds');
  t.ok(
    isRelationshipKind('guarantor_of') &&
      isRelationshipKind('referred_from_proceeding') &&
      !isRelationshipKind('vibes_with'),
    'relationship kind recognized',
  );
  t.ok(isSelfRelation('a', 'a') && !isSelfRelation('a', 'b'), 'self-relation check');

  // --- recovery number --------------------------------------------------------------------------
  t.ok(
    isValidRecoveryNumber(formatRecoveryNumber('0123456789abcdef-0000')),
    'formatted recovery number is valid',
  );
  t.equal(
    formatRecoveryNumber('0123456789ab'),
    'REC-0123456789ab',
    'recovery number format is deterministic',
  );
  t.ok(
    !isValidRecoveryNumber('REC-XYZ') && !isValidRecoveryNumber('nope'),
    'malformed recovery number rejected',
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
