import { defineSuite } from '@finapp/test-runner';
import {
  FEEDBACK_LIMITS,
  FeedbackError,
  FEEDBACK_CHANNELS,
  isChannel,
  SENTIMENTS,
  isSentiment,
  SEVERITIES,
  isSeverity,
  severityRank,
  FEEDBACK_TYPES,
  isFeedbackType,
  isPositiveType,
  ROOT_CAUSE_CATEGORIES,
  isRootCauseCategory,
} from '../src/domain/limits.ts';
import {
  FEEDBACK_STATUSES,
  checkFeedbackTransition,
  isFeedbackTerminal,
  isFeedbackOpen,
  SPEC_STATUSES,
  checkSpecTransition,
  isSpecFrozen,
} from '../src/domain/lifecycles.ts';
import {
  validateQuestionnaireSpec,
  validateAnswers,
  computeScores,
  type QuestionnaireSpec,
} from '../src/domain/questionnaire.ts';
import {
  validateSlaPolicySpec,
  computeDueDates,
  slaStageState,
  type SlaPolicySpec,
} from '../src/domain/sla.ts';
import {
  evaluateClosure,
  RELATIONSHIP_KINDS,
  isRelationshipKind,
  duplicateKey,
  relatedKey,
  type ClosureState,
} from '../src/domain/closure.ts';
import { contentHashOf, canonicalJson } from '../src/hash.ts';
import { SystemClock, FixedClock } from '../src/ports.ts';

function goodQuestionnaire(): QuestionnaireSpec {
  return {
    schemaVersion: 1,
    code: 'loan_csat',
    name: 'Loan CSAT',
    questions: [
      {
        key: 'satisfaction',
        prompt: 'How satisfied?',
        type: 'rating',
        scale: 5,
        metric: 'csat',
        required: true,
      },
      { key: 'recommend', prompt: 'Recommend us?', type: 'rating', scale: 10, metric: 'nps' },
      { key: 'comment', prompt: 'Anything else?', type: 'long_text' },
    ],
  };
}
function goodSla(): SlaPolicySpec {
  return {
    schemaVersion: 1,
    code: 'standard',
    name: 'Standard',
    ackMinutes: 60,
    assignMinutes: 240,
    responseMinutes: 480,
    resolutionMinutes: 2880,
    closureMinutes: 4320,
    warnThresholdPct: 80,
  };
}
function fullyClosable(): ClosureState {
  return {
    captured: true,
    assigned: true,
    responseComplete: true,
    resolutionRecorded: true,
    customerInformed: true,
    customerConfirmed: true,
    customerConfirmationWaived: false,
    slaDispositionRecorded: true,
    rootCauseRecorded: true,
    openMandatoryActivities: 0,
    unresolvedCriticalEscalations: 0,
  };
}

export default defineSuite('m12-feedback', (t) => {
  // --- vocabulary -------------------------------------------------------------------------------
  t.equal(FEEDBACK_CHANNELS.length, 8, 'eight channels');
  t.ok(isChannel('phone') && !isChannel('telegram'), 'channel recognized');
  t.equal(SENTIMENTS.length, 4, 'four sentiments');
  t.ok(isSentiment('critical') && !isSentiment('meh'), 'sentiment recognized');
  t.equal(SEVERITIES.length, 4, 'four severities');
  t.ok(isSeverity('high') && !isSeverity('extreme'), 'severity recognized');
  t.ok(severityRank('critical') > severityRank('low'), 'severity ranks order');
  t.equal(FEEDBACK_TYPES.length, 8, 'eight feedback types');
  t.ok(isFeedbackType('complaint') && !isFeedbackType('rant'), 'feedback type recognized');
  t.ok(isPositiveType('compliment') && !isPositiveType('complaint'), 'only compliment is positive');
  t.ok(isRootCauseCategory('process') && !isRootCauseCategory('gremlins'), 'root cause recognized');
  t.equal(ROOT_CAUSE_CATEGORIES.length, 12, 'a rich root-cause taxonomy');
  t.ok(new FeedbackError('X', 'y') instanceof Error, 'FeedbackError is an Error');
  t.equal(FEEDBACK_LIMITS.maxSearchLimit, 200, 'search bounded');

  // --- feedback lifecycle -----------------------------------------------------------------------
  t.equal(FEEDBACK_STATUSES.length, 15, 'fifteen feedback states');
  t.ok(checkFeedbackTransition('pending_contact', 'feedback_captured').ok, 'pending -> captured ok');
  t.ok(!checkFeedbackTransition('closed', 'assigned').ok, 'cannot assign a closed feedback');
  t.ok(checkFeedbackTransition('closed', 'reopened').ok, 'closed -> reopened ok');
  t.ok(!checkFeedbackTransition('converted_to_case', 'reopened').ok, 'converted_to_case is terminal');
  t.ok(!checkFeedbackTransition('nowhere', 'closed').ok, 'unknown state rejected');
  t.ok(
    isFeedbackTerminal('closed') &&
      isFeedbackTerminal('cancelled') &&
      isFeedbackTerminal('converted_to_case'),
    'terminals',
  );
  t.ok(isFeedbackOpen('assigned') && !isFeedbackOpen('expired'), 'open check');

  // --- spec lifecycle ---------------------------------------------------------------------------
  t.equal(SPEC_STATUSES.length, 6, 'six spec states');
  t.ok(checkSpecTransition('DRAFT', 'validate').ok, 'DRAFT -> validate ok');
  t.ok(!checkSpecTransition('DRAFT', 'publish').ok, 'DRAFT -> publish rejected');
  t.ok(checkSpecTransition('PUBLISHED', 'activate').ok, 'PUBLISHED -> activate ok');
  t.ok(!isSpecFrozen('DRAFT') && isSpecFrozen('PUBLISHED') && isSpecFrozen('ACTIVE'), 'frozen at publish');

  // --- questionnaire spec + answers + scores ----------------------------------------------------
  t.ok(validateQuestionnaireSpec(goodQuestionnaire()).ok, 'good questionnaire validates');
  t.ok(!validateQuestionnaireSpec({ ...goodQuestionnaire(), questions: [] }).ok, 'no questions rejected');
  t.ok(!validateQuestionnaireSpec({ ...goodQuestionnaire(), code: '9bad' }).ok, 'bad code rejected');
  t.ok(
    !validateQuestionnaireSpec({
      ...goodQuestionnaire(),
      questions: [{ key: 'x', prompt: 'p', type: 'rating' }],
    }).ok,
    'rating without a scale rejected',
  );
  const spec = goodQuestionnaire();
  const av = validateAnswers(spec, { satisfaction: 4, recommend: 9, comment: 'great service' });
  t.ok(av.ok, 'valid answers accepted');
  t.ok(!validateAnswers(spec, { satisfaction: 4, unknown: 'x' }).ok, 'unknown question rejected');
  t.ok(!validateAnswers(spec, { recommend: 9 }).ok, 'missing required answer rejected');
  t.ok(!validateAnswers(spec, { satisfaction: 99, recommend: 9 }).ok, 'out-of-scale rating rejected');
  const scores = computeScores(spec, av.values);
  t.equal(scores.csat, 80, 'CSAT normalized to 0-100 (4/5 = 80)');
  t.equal(scores.nps, 9, 'NPS kept on 0-10');
  t.equal(scores.npsCategory, 'promoter', 'NPS 9 is a promoter');

  // --- SLA spec + due dates + stage state (deterministic) ---------------------------------------
  t.ok(validateSlaPolicySpec(goodSla()).ok, 'good sla policy validates');
  t.ok(!validateSlaPolicySpec({ ...goodSla(), resolutionMinutes: -1 }).ok, 'negative minutes rejected');
  t.ok(!validateSlaPolicySpec({ ...goodSla(), warnThresholdPct: 150 }).ok, 'warn pct > 100 rejected');
  const start = 1_700_000_000_000;
  const due = computeDueDates(goodSla(), start);
  t.equal(due.resolutionAtMs, start + 2880 * 60_000, 'resolution due computed deterministically');
  const before = slaStageState({
    startMs: start,
    dueMs: due.resolutionAtMs,
    nowMs: start + 1000,
    pausedMs: 0,
    warnThresholdPct: 80,
  });
  t.ok(!before.breached && !before.warn, 'fresh SLA is neither warned nor breached');
  const warned = slaStageState({
    startMs: start,
    dueMs: due.resolutionAtMs,
    nowMs: start + 2880 * 60_000 * 0.9,
    pausedMs: 0,
    warnThresholdPct: 80,
  });
  t.ok(warned.warn && !warned.breached, 'past the warn threshold warns');
  const breached = slaStageState({
    startMs: start,
    dueMs: due.resolutionAtMs,
    nowMs: due.resolutionAtMs + 1,
    pausedMs: 0,
    warnThresholdPct: 80,
  });
  t.ok(breached.breached, 'past due breaches');
  const paused = slaStageState({
    startMs: start,
    dueMs: due.resolutionAtMs,
    nowMs: due.resolutionAtMs + 1,
    pausedMs: 60_000,
    warnThresholdPct: 80,
  });
  t.ok(!paused.breached, 'pause credit pulls it back under the line');

  // --- closure eligibility ----------------------------------------------------------------------
  const allCriteria = {
    requireCaptured: true,
    requireAssigned: true,
    requireResolution: true,
    requireCustomerInformed: true,
    requireSlaDisposition: true,
    requireNoOpenMandatoryActivity: true,
  } as const;
  t.ok(evaluateClosure(allCriteria, fullyClosable()).eligible, 'a fully-satisfied record is closable');
  const missing = evaluateClosure(allCriteria, {
    ...fullyClosable(),
    assigned: false,
    openMandatoryActivities: 2,
  });
  t.ok(!missing.eligible, 'unmet criteria block closure');
  t.ok(
    missing.reasonCodes.includes('NO_OWNER_ASSIGNED') &&
      missing.reasonCodes.includes('OPEN_MANDATORY_ACTIVITY'),
    'reason codes are explainable',
  );
  t.ok(
    evaluateClosure({ requireCaptured: true }, { ...fullyClosable() }).eligible,
    'light positive criteria pass',
  );
  const confirm = evaluateClosure(
    { requireCustomerConfirmation: true },
    { ...fullyClosable(), customerConfirmed: false, customerConfirmationWaived: true },
  );
  t.ok(confirm.eligible, 'a waiver satisfies the confirmation requirement');

  // --- duplicate / related matching -------------------------------------------------------------
  t.equal(RELATIONSHIP_KINDS.length, 3, 'three relationship kinds');
  t.ok(isRelationshipKind('duplicate') && !isRelationshipKind('twin'), 'relationship kind recognized');
  t.equal(duplicateKey('txn-1'), duplicateKey('txn-1'), 'duplicate key deterministic');
  t.ok(duplicateKey('txn-1') !== duplicateKey('txn-2'), 'distinct transactions differ');
  t.equal(
    relatedKey('c1', 'loan', 'service'),
    relatedKey('c1', 'loan', 'service'),
    'related key deterministic',
  );

  // --- hash --------------------------------------------------------------------------------------
  t.equal(
    contentHashOf({ a: 1, b: 2 }),
    contentHashOf({ b: 2, a: 1 }),
    'content hash is key-order independent',
  );
  t.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}', 'canonical json sorts keys');

  // --- clock ports (deterministic SLA math) -----------------------------------------------------
  t.ok(new SystemClock().now() > 0, 'system clock returns epoch ms');
  const fixed = new FixedClock(start);
  t.equal(fixed.now(), start, 'fixed clock is fixed');
  fixed.advance(60_000);
  t.equal(fixed.now(), start + 60_000, 'fixed clock advances deterministically');
});
