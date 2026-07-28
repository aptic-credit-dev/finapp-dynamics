import { defineSuite } from '@finapp/test-runner';
import {
  LITIGATION_LIMITS,
  LitigationError,
  PROCEEDING_SOURCES,
  isProceedingSource,
  FORUM_TYPES,
  isForumType,
  isOrganizationRole,
  CONFIDENTIALITY_LEVELS,
  isConfidentiality,
  confidentialityRank,
  LITIGATION_RISKS,
  isLitigationRisk,
  PRIORITIES,
  isPriority,
  PARTY_ROLES,
  isPartyRole,
  CLAIM_TYPES,
  isClaimType,
  FILING_ROLES,
  isFilingRole,
  SERVICE_METHODS,
  isServiceMethod,
  APPEARANCE_TYPES,
  isAppearanceType,
  WITNESS_TYPES,
  isWitnessType,
  ORDER_TYPES,
  isOrderType,
  OUTCOME_TYPES,
  isOutcomeType,
  DEADLINE_TYPES,
  isDeadlineType,
  COST_TYPES,
  isCostType,
  NOTE_TYPES,
  isNoteType,
  isRestrictedNote,
  PROCEEDING_STATUSES,
  checkProceedingTransition,
  isProceedingTerminal,
  isProceedingOpen,
  SPEC_STATUSES,
  checkSpecTransition,
  isSpecFrozen,
  PROCEEDING_TYPE_SCHEMA_VERSION,
  validateProceedingTypeSpec,
  type ProceedingTypeSpec,
  SLA_POLICY_SCHEMA_VERSION,
  validateLitigationSlaPolicySpec,
  computeDueDates,
  slaStageState,
  type LitigationSlaPolicySpec,
  computeDeadlineDueMs,
  deadlineState,
  isLimitationSafe,
  isLimitation,
  evaluateClosure,
  RELATIONSHIP_KINDS,
  isRelationshipKind,
  isSelfRelation,
  type ClosureState,
  formatProceedingNumber,
  isValidProceedingNumber,
  contentHashOf,
  canonicalJson,
  SystemClock,
  FixedClock,
} from '../src/index.ts';

function goodType(): ProceedingTypeSpec {
  return {
    schemaVersion: 1,
    code: 'civil_suit',
    name: 'Civil Suit',
    category: 'civil',
    eligibleForumTypes: ['court'],
    defaultConfidentiality: 'privileged',
    defaultRisk: 'high',
    defaultPriority: 'high',
    filingRequired: true,
    serviceRequired: true,
    hearingSupport: true,
    appealSupport: true,
  };
}
function goodSla(): LitigationSlaPolicySpec {
  return {
    schemaVersion: 1,
    code: 'standard',
    name: 'Standard',
    ackMinutes: 60,
    filingPrepMinutes: 480,
    filingMinutes: 960,
    serviceMinutes: 2880,
    bundlePrepMinutes: 4320,
    hearingPrepMinutes: 5760,
    counselUpdateMinutes: 10080,
    outcomeMinutes: 43200,
    closureMinutes: 86400,
    warnThresholdPct: 80,
  };
}
function closable(): ClosureState {
  return {
    openFilings: 0,
    serviceCompleted: true,
    openAppearances: 0,
    openHearings: 0,
    outcomeRecorded: true,
    appealDispositioned: true,
    openComplianceObligations: 0,
    counselFinalReport: true,
    requiredDocumentsPresent: true,
    openDeadlines: 0,
    imminentLimitation: false,
    activeStay: false,
    openCriticalEscalations: 0,
    matterUpdateEmitted: true,
    closureApproved: true,
  };
}

export default defineSuite('m16-litigation', (t) => {
  // --- vocabulary -------------------------------------------------------------------------------
  t.ok(
    isProceedingSource('matter_referral') && !isProceedingSource('telepathy'),
    'proceeding source recognized',
  );
  t.equal(PROCEEDING_SOURCES.length, 11, 'eleven proceeding sources');
  t.ok(isForumType('tribunal') && isForumType('arbitration') && !isForumType('pub'), 'forum type recognized');
  t.equal(FORUM_TYPES.length, 8, 'eight forum types');
  t.ok(
    isOrganizationRole('defendant') && isOrganizationRole('claimant') && !isOrganizationRole('bystander'),
    'organization role recognized',
  );
  t.equal(CONFIDENTIALITY_LEVELS.length, 4, 'four confidentiality levels');
  t.ok(isConfidentiality('privileged') && !isConfidentiality('secret'), 'confidentiality recognized');
  t.ok(confidentialityRank('privileged') > confidentialityRank('standard'), 'confidentiality ranks order');
  t.ok(isLitigationRisk('critical') && !isLitigationRisk('meh'), 'litigation risk recognized');
  t.ok(isPriority('urgent') && !isPriority('whenever'), 'priority recognized');
  t.ok(
    isPartyRole('appellant') && isPartyRole('expert_witness') && !isPartyRole('alien'),
    'party role recognized',
  );
  t.ok(
    isClaimType('injunctive') && isClaimType('counterclaim') && !isClaimType('nonsense'),
    'claim type recognized',
  );
  t.ok(
    isFilingRole('affidavit') && isFilingRole('notice') && !isFilingRole('vibes'),
    'filing role recognized',
  );
  t.ok(
    isServiceMethod('substituted') && isServiceMethod('electronic') && !isServiceMethod('carrier_pigeon'),
    'service method recognized',
  );
  t.ok(
    isAppearanceType('mention') && isAppearanceType('appeal_hearing') && !isAppearanceType('party'),
    'appearance type recognized',
  );
  t.ok(
    isWitnessType('expert') && isWitnessType('hostile') && !isWitnessType('friendly'),
    'witness type recognized',
  );
  t.ok(
    isOrderType('injunction') && isOrderType('decree') && !isOrderType('suggestion'),
    'order type recognized',
  );
  t.ok(
    isOutcomeType('final_judgment') && isOutcomeType('struck_out') && !isOutcomeType('shrug'),
    'outcome type recognized',
  );
  t.ok(
    isDeadlineType('limitation') && isDeadlineType('disclosure') && !isDeadlineType('someday'),
    'deadline type recognized',
  );
  t.ok(
    isCostType('counsel_fee') && isCostType('taxed_costs') && !isCostType('bribe'),
    'cost type recognized',
  );
  t.ok(
    isNoteType('privileged') &&
      isRestrictedNote('strategy') &&
      isRestrictedNote('counsel') &&
      !isRestrictedNote('general'),
    'restricted note recognized',
  );
  t.ok(new LitigationError('X', 'y') instanceof Error, 'LitigationError is an Error');
  t.equal(LITIGATION_LIMITS.maxSearchLimit, 200, 'search bounded');
  t.ok(
    PARTY_ROLES.length === 19 &&
      CLAIM_TYPES.length === 12 &&
      FILING_ROLES.length === 17 &&
      SERVICE_METHODS.length === 8 &&
      APPEARANCE_TYPES.length === 12 &&
      WITNESS_TYPES.length === 6 &&
      ORDER_TYPES.length === 12 &&
      OUTCOME_TYPES.length === 10 &&
      DEADLINE_TYPES.length === 16 &&
      COST_TYPES.length === 10 &&
      NOTE_TYPES.length === 6 &&
      LITIGATION_RISKS.length === 4 &&
      PRIORITIES.length === 4,
    'vocab sizes',
  );

  // --- proceeding lifecycle ---------------------------------------------------------------------
  t.equal(PROCEEDING_STATUSES.length, 30, 'thirty proceeding states');
  t.ok(checkProceedingTransition('draft', 'referred').ok, 'draft -> referred ok');
  t.ok(
    checkProceedingTransition('under_review', 'approved_to_file').ok,
    'under_review -> approved_to_file ok',
  );
  t.ok(checkProceedingTransition('filed', 'served').ok, 'filed -> served ok');
  t.ok(checkProceedingTransition('hearing', 'decision_pending').ok, 'hearing -> decision_pending ok');
  t.ok(checkProceedingTransition('judgment_delivered', 'appeal_pending').ok, 'judgment -> appeal ok');
  t.ok(checkProceedingTransition('concluded', 'closed').ok, 'concluded -> closed ok');
  t.ok(checkProceedingTransition('closed', 'reopened').ok, 'closed -> reopened ok');
  t.ok(checkProceedingTransition('closed', 'archived').ok, 'closed -> archived ok');
  t.ok(!checkProceedingTransition('draft', 'closed').ok, 'draft -> closed rejected');
  t.ok(!checkProceedingTransition('archived', 'reopened').ok, 'archived is terminal');
  t.ok(!checkProceedingTransition('nowhere', 'closed').ok, 'unknown state rejected');
  t.ok(
    isProceedingTerminal('archived') && !isProceedingTerminal('closed') && !isProceedingTerminal('dismissed'),
    'only archived is terminal',
  );
  t.ok(
    isProceedingOpen('hearing') &&
      !isProceedingOpen('closed') &&
      !isProceedingOpen('dismissed') &&
      !isProceedingOpen('archived'),
    'open check',
  );

  // --- spec lifecycle ---------------------------------------------------------------------------
  t.equal(SPEC_STATUSES.length, 6, 'six spec states');
  t.ok(checkSpecTransition('DRAFT', 'validate').ok, 'DRAFT -> validate ok');
  t.ok(!checkSpecTransition('DRAFT', 'publish').ok, 'DRAFT -> publish rejected');
  t.ok(!isSpecFrozen('DRAFT') && isSpecFrozen('PUBLISHED') && isSpecFrozen('ACTIVE'), 'frozen at publish');

  // --- proceeding-type + sla spec validation ----------------------------------------------------
  t.equal(PROCEEDING_TYPE_SCHEMA_VERSION, 1, 'proceeding-type schema v1');
  t.ok(validateProceedingTypeSpec(goodType()).ok, 'good proceeding type validates');
  t.ok(!validateProceedingTypeSpec({ ...goodType(), code: '9bad' }).ok, 'bad code rejected');
  t.ok(
    !validateProceedingTypeSpec({ ...goodType(), defaultRisk: 'nope' }).ok,
    'invalid default risk rejected',
  );
  t.ok(
    !validateProceedingTypeSpec({ ...goodType(), eligibleForumTypes: [1] as unknown as string[] }).ok,
    'non-string forum list rejected',
  );
  t.equal(SLA_POLICY_SCHEMA_VERSION, 1, 'sla schema v1');
  t.ok(validateLitigationSlaPolicySpec(goodSla()).ok, 'good sla policy validates');
  t.ok(!validateLitigationSlaPolicySpec({ ...goodSla(), filingMinutes: -1 }).ok, 'negative minutes rejected');
  t.ok(
    !validateLitigationSlaPolicySpec({ ...goodSla(), warnThresholdPct: 150 }).ok,
    'warn pct > 100 rejected',
  );

  // --- SLA + deadlines --------------------------------------------------------------------------
  const start = 1_700_000_000_000;
  const due = computeDueDates(goodSla(), start);
  t.equal(due.outcomeAtMs, start + 43200 * 60_000, 'outcome due computed deterministically');
  t.ok(
    slaStageState({
      startMs: start,
      dueMs: due.filingAtMs,
      nowMs: due.filingAtMs + 1,
      pausedMs: 0,
      warnThresholdPct: 80,
    }).breached,
    'past due breaches',
  );
  t.equal(
    computeDeadlineDueMs({ type: 'filing', startMs: start, rule: { kind: 'offset_days', days: 14 } }),
    start + 14 * 86_400_000,
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
  const crit = {
    requireOutcomeRecorded: true,
    requireDeadlinesDispositioned: true,
    requireComplianceDispositioned: true,
    requireNoActiveStay: true,
    requireNoImminentLimitation: true,
  };
  t.ok(evaluateClosure(crit, closable()).eligible, 'a fully-worked proceeding is closable');
  const blocked = evaluateClosure(crit, {
    ...closable(),
    outcomeRecorded: false,
    activeStay: true,
    imminentLimitation: true,
    openComplianceObligations: 2,
  });
  t.ok(!blocked.eligible, 'unmet criteria block closure');
  t.ok(
    blocked.reasonCodes.includes('OUTCOME_MISSING') &&
      blocked.reasonCodes.includes('ACTIVE_STAY') &&
      blocked.reasonCodes.includes('IMMINENT_LIMITATION') &&
      blocked.reasonCodes.includes('OPEN_COMPLIANCE_OBLIGATION'),
    'reason codes explainable',
  );

  // --- relationships ----------------------------------------------------------------------------
  t.equal(RELATIONSHIP_KINDS.length, 11, 'eleven relationship kinds');
  t.ok(
    isRelationshipKind('appeal_of') &&
      isRelationshipKind('referred_from_matter') &&
      !isRelationshipKind('vibes_with'),
    'relationship kind recognized',
  );
  t.ok(isSelfRelation('a', 'a') && !isSelfRelation('a', 'b'), 'self-relation check');

  // --- proceeding number ------------------------------------------------------------------------
  t.ok(
    isValidProceedingNumber(formatProceedingNumber('0123456789abcdef-0000')),
    'formatted proceeding number is valid',
  );
  t.equal(
    formatProceedingNumber('0123456789ab'),
    'PROC-0123456789ab',
    'proceeding number format is deterministic',
  );
  t.ok(
    !isValidProceedingNumber('PROC-XYZ') && !isValidProceedingNumber('nope'),
    'malformed proceeding number rejected',
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
