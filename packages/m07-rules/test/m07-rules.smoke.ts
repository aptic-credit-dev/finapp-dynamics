import { defineSuite } from '@finapp/test-runner';
import {
  RuleError,
  add,
  compare,
  eq,
  formatDecimal,
  ge,
  gt,
  inRange,
  le,
  lt,
  multiply,
  ne,
  parseDecimal,
  percentOf,
  roundTo,
  subtract,
} from '../src/domain/decimal.ts';
import {
  collectFields,
  conditionDepth,
  conditionNodeCount,
  evaluateCondition,
  type Condition,
} from '../src/domain/conditions.ts';
import { evaluateTable, HIT_POLICIES, type DecisionTable } from '../src/domain/decision-table.ts';
import {
  RULESET_ACTIONS,
  RULESET_STATUSES,
  checkRuleSetTransition,
  isRuleSetContentFrozen,
} from '../src/domain/lifecycles.ts';
import { RULE_LIMITS, RULE_SCHEMA_VERSION, type RuleSetSpec } from '../src/domain/ruleset.ts';
import { derivedCycleCheck, validateRuleSet } from '../src/domain/validator.ts';
import { ENGINE_VERSION, evaluateRuleSet, inputHash } from '../src/domain/evaluate.ts';

function hasCode(result: { errors: readonly { code: string }[] }, code: string): boolean {
  return result.errors.some((e) => e.code === code);
}

/** A fresh, well-formed rule-set spec (typed) used as the base for the engine tests. */
function goodSpec(): RuleSetSpec {
  return {
    schemaVersion: 1,
    code: 'credit_decision',
    name: 'Credit decision',
    inputSchema: [
      { name: 'amount', type: 'decimal', required: true, scale: 2 },
      { name: 'country', type: 'enum', enumValues: ['KE', 'UG', 'TZ'] },
      { name: 'score', type: 'number' },
      { name: 'tier', type: 'string', maxLength: 10 },
    ],
    outputSchema: [
      { name: 'decision', type: 'string', required: true },
      { name: 'fee', type: 'decimal' },
    ],
    derived: [{ name: 'fee_base', op: 'percent', args: ['amount', '2'] }],
    decisionTables: [
      {
        id: 't_decision',
        hitPolicy: 'FIRST',
        inputFields: ['score'],
        outputFields: ['decision'],
        rows: [
          {
            id: 'r_ok',
            when: { type: 'compare', field: 'score', op: 'ge', value: 700, valueType: 'number' },
            outputs: { decision: 'APPROVE' },
            reasonCode: 'SCORE_OK',
          },
          {
            id: 'r_low',
            when: { type: 'compare', field: 'score', op: 'lt', value: 700, valueType: 'number' },
            outputs: { decision: 'REVIEW' },
            reasonCode: 'SCORE_LOW',
          },
        ],
      },
    ],
  };
}

/** A fresh plain (mutable) clone of the good spec for the validator defect tests. */
function clone(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(goodSpec())) as Record<string, unknown>;
}

export default defineSuite('m07-rules', (t) => {
  const AT = '2026-06-01T00:00:00Z';

  // =================================================================================================
  // 1) DECIMAL — decimal-safe, no binary float
  // =================================================================================================
  t.equal(
    formatDecimal(add(parseDecimal('0.10'), parseDecimal('0.20'))),
    '0.30',
    '0.10 + 0.20 == 0.30 exactly (no float error)',
  );
  t.ok(eq(add(parseDecimal('0.10'), parseDecimal('0.20')), parseDecimal('0.30')), 'decimal add equals 0.30');
  t.equal(formatDecimal(subtract(parseDecimal('1.00'), parseDecimal('0.55'))), '0.45', '1.00 - 0.55 == 0.45');
  t.equal(formatDecimal(multiply(parseDecimal('1.5'), parseDecimal('2'))), '3.0', '1.5 * 2 == 3.0');
  t.equal(formatDecimal(parseDecimal('100')), '100', 'integer parses cleanly');
  t.equal(formatDecimal(parseDecimal('-7.50')), '-7.50', 'negative decimal round-trips');
  t.equal(
    compare(parseDecimal('1.0'), parseDecimal('1.00')),
    0,
    'scale-different equal values compare equal',
  );
  t.ok(lt(parseDecimal('1.999'), parseDecimal('2')), '1.999 < 2');
  t.ok(gt(parseDecimal('2.001'), parseDecimal('2')), '2.001 > 2');
  t.ok(le(parseDecimal('2'), parseDecimal('2')), '2 <= 2');
  t.ok(ge(parseDecimal('2'), parseDecimal('2')), '2 >= 2');
  t.ok(ne(parseDecimal('2'), parseDecimal('3')), '2 != 3');
  t.ok(!eq(parseDecimal('2'), parseDecimal('3')), '2 not eq 3');
  t.equal(formatDecimal(percentOf(parseDecimal('200'), parseDecimal('10'))), '20.00', '10% of 200 == 20.00');
  t.equal(
    formatDecimal(percentOf(parseDecimal('1500.00'), parseDecimal('2'))),
    '30.0000',
    '2% of 1500.00 == 30.0000',
  );
  t.equal(
    formatDecimal(roundTo(parseDecimal('2.345'), 2, 'half_up')),
    '2.35',
    'half_up rounds 2.345 -> 2.35',
  );
  t.equal(
    formatDecimal(roundTo(parseDecimal('2.345'), 2, 'half_even')),
    '2.34',
    'half_even rounds 2.345 -> 2.34 (banker)',
  );
  t.equal(formatDecimal(roundTo(parseDecimal('2.349'), 2, 'down')), '2.34', 'down truncates 2.349 -> 2.34');
  t.equal(
    formatDecimal(roundTo(parseDecimal('2.355'), 2, 'half_even')),
    '2.36',
    'half_even rounds 2.355 -> 2.36 (up to even)',
  );
  t.equal(formatDecimal(roundTo(parseDecimal('5'), 2, 'half_up')), '5.00', 'rounding pads scale up');
  t.ok(inRange(parseDecimal('5'), parseDecimal('1'), parseDecimal('10'), true, true), '5 within [1,10]');
  t.ok(
    !inRange(parseDecimal('10'), parseDecimal('1'), parseDecimal('10'), true, false),
    '10 not within [1,10)',
  );
  t.ok(!inRange(parseDecimal('0'), parseDecimal('1'), undefined, true, true), '0 not within [1,+inf)');
  t.throws(() => parseDecimal(0.1), 'a non-integer JS number is rejected (would lose precision)');
  t.throws(() => parseDecimal('1.2.3'), 'a malformed decimal string is rejected');
  t.throws(() => parseDecimal('abc'), 'a non-numeric string is rejected');
  t.throws(() => parseDecimal('1.0000000000000'), 'more than the max fractional scale is rejected');
  t.throws(() => parseDecimal(Number.POSITIVE_INFINITY), 'Infinity is rejected');
  t.throws(() => roundTo(parseDecimal('1'), 99, 'down'), 'an out-of-range target scale is rejected');
  let caught: unknown;
  try {
    parseDecimal('nope');
  } catch (e) {
    caught = e;
  }
  t.ok(caught instanceof RuleError, 'parse errors are RuleError instances (fail closed)');
  t.equal((caught as RuleError).code, 'DECIMAL_INVALID', 'the RuleError carries a machine-readable code');

  // =================================================================================================
  // 2) CONDITIONS — every type, matched + not-matched, decimal-safe, fail-closed
  // =================================================================================================
  const env = {
    amount: '1500.00',
    country: 'KE',
    score: 720,
    active: true,
    name: 'Acme Corp',
    opened: '2026-03-15',
  };

  const cmpDec: Condition = {
    type: 'compare',
    field: 'amount',
    op: 'ge',
    value: '1000',
    valueType: 'decimal',
  };
  t.ok(evaluateCondition(cmpDec, env).matched, 'decimal compare: 1500.00 >= 1000');
  t.ok(
    !evaluateCondition(
      { type: 'compare', field: 'amount', op: 'lt', value: '1000', valueType: 'decimal' },
      env,
    ).matched,
    'decimal compare: 1500.00 not < 1000',
  );
  t.ok(
    evaluateCondition({ type: 'compare', field: 'score', op: 'gt', value: 700, valueType: 'number' }, env)
      .matched,
    'number compare matched',
  );
  t.ok(
    !evaluateCondition({ type: 'compare', field: 'score', op: 'gt', value: 900, valueType: 'number' }, env)
      .matched,
    'number compare not matched',
  );
  t.ok(
    evaluateCondition({ type: 'compare', field: 'active', op: 'eq', value: true }, env).matched,
    'boolean eq matched',
  );
  t.ok(
    !evaluateCondition({ type: 'compare', field: 'missing', op: 'eq', value: 1 }, env).matched,
    'a missing field in compare is not-matched (not an error)',
  );

  t.ok(
    evaluateCondition({ type: 'in', field: 'country', values: ['KE', 'UG'] }, env).matched,
    'in: KE is a member',
  );
  t.ok(
    !evaluateCondition({ type: 'in', field: 'country', values: ['TZ'] }, env).matched,
    'in: KE is not in [TZ]',
  );

  t.ok(
    evaluateCondition({ type: 'range', field: 'amount', min: '1000', max: '2000', valueType: 'decimal' }, env)
      .matched,
    'decimal range matched',
  );
  t.ok(
    !evaluateCondition(
      { type: 'range', field: 'amount', min: '2000', max: '3000', valueType: 'decimal' },
      env,
    ).matched,
    'decimal range not matched',
  );
  t.ok(
    evaluateCondition({ type: 'range', field: 'score', min: 700, max: 800, valueType: 'number' }, env)
      .matched,
    'number range matched',
  );

  t.ok(evaluateCondition({ type: 'present', field: 'name' }, env).matched, 'present: name is present');
  t.ok(
    !evaluateCondition({ type: 'present', field: 'missing' }, env).matched,
    'present: missing field is not present',
  );
  t.ok(
    evaluateCondition({ type: 'absent', field: 'missing' }, env).matched,
    'absent: missing field is absent',
  );
  t.ok(!evaluateCondition({ type: 'absent', field: 'name' }, env).matched, 'absent: name is not absent');

  t.ok(
    evaluateCondition({ type: 'string', field: 'name', op: 'startsWith', value: 'Acme' }, env).matched,
    'string startsWith matched',
  );
  t.ok(
    evaluateCondition({ type: 'string', field: 'name', op: 'endsWith', value: 'Corp' }, env).matched,
    'string endsWith matched',
  );
  t.ok(
    evaluateCondition({ type: 'string', field: 'name', op: 'contains', value: 'me Co' }, env).matched,
    'string contains matched',
  );
  t.ok(
    evaluateCondition(
      { type: 'string', field: 'name', op: 'equals', value: 'acme corp', normalize: true },
      env,
    ).matched,
    'string equals with normalize matched',
  );
  t.ok(
    !evaluateCondition({ type: 'string', field: 'name', op: 'contains', value: 'zzz' }, env).matched,
    'string contains not matched',
  );

  t.ok(
    evaluateCondition({ type: 'date', field: 'opened', op: 'gt', value: '2026-01-01' }, env).matched,
    'date gt matched',
  );
  t.ok(
    !evaluateCondition({ type: 'date', field: 'opened', op: 'lt', value: '2026-01-01' }, env).matched,
    'date lt not matched',
  );
  t.ok(
    evaluateCondition({ type: 'date', field: 'opened', op: 'le', value: '2026-03-15' }, env).matched,
    'date le on equal day matched',
  );

  const andCond: Condition = {
    type: 'and',
    conditions: [
      { type: 'compare', field: 'amount', op: 'ge', value: '1000', valueType: 'decimal' },
      { type: 'compare', field: 'score', op: 'gt', value: 700, valueType: 'number' },
    ],
  };
  t.ok(evaluateCondition(andCond, env).matched, 'and: both children true');
  t.ok(
    !evaluateCondition({ type: 'and', conditions: [andCond, { type: 'present', field: 'missing' }] }, env)
      .matched,
    'and: one false child fails the whole',
  );
  t.ok(
    evaluateCondition(
      {
        type: 'or',
        conditions: [
          { type: 'present', field: 'missing' },
          { type: 'present', field: 'name' },
        ],
      },
      env,
    ).matched,
    'or: one true child passes',
  );
  t.ok(
    !evaluateCondition(
      {
        type: 'or',
        conditions: [
          { type: 'present', field: 'missing' },
          { type: 'absent', field: 'name' },
        ],
      },
      env,
    ).matched,
    'or: all false',
  );
  t.ok(
    evaluateCondition({ type: 'not', condition: { type: 'present', field: 'missing' } }, env).matched,
    'not: negates a false child',
  );
  t.ok(
    !evaluateCondition({ type: 'not', condition: { type: 'present', field: 'name' } }, env).matched,
    'not: negates a true child',
  );

  // trace structure
  const traced = evaluateCondition(andCond, env);
  t.equal(traced.trace.type, 'and', 'trace root reflects the condition type');
  t.equal(traced.trace.matched, true, 'trace root records the match');
  t.equal(traced.trace.children?.length, 2, 'trace carries a child per sub-condition');
  t.equal(traced.trace.children?.[0]?.field, 'amount', 'a leaf trace records its field');

  // determinism
  const d1 = evaluateCondition(andCond, env);
  const d2 = evaluateCondition(andCond, env);
  t.deepEqual(d2.trace, d1.trace, 'identical evaluation yields an identical trace (determinism)');

  // conditions are PURE DATA — no eval path
  t.ok(
    !evaluateCondition({ type: 'compare', field: 'name', op: 'eq', value: 'process.exit(1)' }, env).matched,
    'a code-like string value is treated as inert data, never executed',
  );

  // fail closed
  t.throws(
    () => evaluateCondition({ type: 'compare', field: 'score', op: 'bogus' as 'eq', value: 1 }, env),
    'an unknown compare operator throws (fail closed)',
  );
  t.throws(
    () => evaluateCondition({ type: 'evil', field: 'x' } as unknown as Condition, env),
    'an unknown condition type throws (fail closed)',
  );
  t.throws(
    () => evaluateCondition({ type: 'date', field: 'opened', op: 'eq', value: 'not-a-date' }, env),
    'an invalid ISO date throws',
  );
  let condErr: unknown;
  try {
    evaluateCondition({ type: 'compare', field: 'x', op: 'zzz' as 'eq', value: 1 }, { x: 1 });
  } catch (e) {
    condErr = e;
  }
  t.ok(
    condErr instanceof RuleError && condErr.code === 'BAD_OPERATOR',
    'the unsafe-operator error is a coded RuleError',
  );

  // structural helpers
  t.deepEqual(
    collectFields(andCond),
    ['amount', 'score'],
    'collectFields gathers referenced columns (sorted, deduped)',
  );
  t.equal(conditionDepth(andCond), 2, 'conditionDepth measures nesting');
  t.equal(conditionDepth({ type: 'not', condition: andCond }), 3, 'not adds a level of depth');
  t.equal(conditionNodeCount(andCond), 3, 'conditionNodeCount counts every node');

  // =================================================================================================
  // 3) DECISION TABLES — hit policies
  // =================================================================================================
  t.equal(HIT_POLICIES.length, 4, 'four hit policies');

  const alwaysA: Condition = { type: 'compare', field: 'x', op: 'ge', value: 0, valueType: 'number' };
  const firstTable: DecisionTable = {
    id: 'first_t',
    hitPolicy: 'FIRST',
    inputFields: ['x'],
    outputFields: ['label'],
    rows: [
      { id: 'a', when: alwaysA, outputs: { label: 'A' }, reasonCode: 'RA' },
      { id: 'b', when: alwaysA, outputs: { label: 'B' }, reasonCode: 'RB' },
    ],
  };
  const first = evaluateTable(firstTable, { x: 5 }, AT);
  t.equal(first.outputs['label'], 'A', 'FIRST returns the first matched row');
  t.deepEqual(first.matchedRowIds, ['a'], 'FIRST reports one matched row id');
  t.deepEqual(first.reasonCodes, ['RA'], 'FIRST reports the matched reason code');
  t.equal(first.rowTraces.length, 2, 'FIRST traces every evaluated row');

  const uniqueTable: DecisionTable = { ...firstTable, id: 'uniq_t', hitPolicy: 'UNIQUE' };
  t.throws(
    () => evaluateTable(uniqueTable, { x: 5 }, AT),
    'UNIQUE with two matches throws UNIQUE_MATCH_VIOLATION',
  );
  const uniqueOne: DecisionTable = {
    id: 'uniq_one',
    hitPolicy: 'UNIQUE',
    inputFields: ['x'],
    outputFields: ['label'],
    rows: [
      {
        id: 'a',
        when: { type: 'compare', field: 'x', op: 'ge', value: 10, valueType: 'number' },
        outputs: { label: 'HI' },
        reasonCode: 'R',
      },
      {
        id: 'b',
        when: { type: 'compare', field: 'x', op: 'lt', value: 10, valueType: 'number' },
        outputs: { label: 'LO' },
        reasonCode: 'R',
      },
    ],
  };
  t.equal(
    evaluateTable(uniqueOne, { x: 5 }, AT).outputs['label'],
    'LO',
    'UNIQUE with exactly one match returns it',
  );

  const collectTable: DecisionTable = {
    id: 'coll_t',
    hitPolicy: 'COLLECT',
    inputFields: ['x'],
    outputFields: ['amt'],
    aggregate: { field: 'amt', op: 'sum' },
    rows: [
      { id: 'a', when: alwaysA, outputs: { amt: '10.50' }, reasonCode: 'RA' },
      { id: 'b', when: alwaysA, outputs: { amt: '20.25' }, reasonCode: 'RB' },
      {
        id: 'c',
        when: { type: 'compare', field: 'x', op: 'gt', value: 100, valueType: 'number' },
        outputs: { amt: '99.99' },
        reasonCode: 'RC',
      },
    ],
  };
  const collected = evaluateTable(collectTable, { x: 5 }, AT);
  t.equal(collected.outputs['amt'], '30.75', 'COLLECT sums the matched rows decimal-safe (10.50 + 20.25)');
  t.deepEqual(
    collected.matchedRowIds,
    ['a', 'b'],
    'COLLECT reports all matched rows and skips the non-match',
  );
  t.equal(collected.reasonCodes.length, 2, 'COLLECT reports a reason code per matched row');
  const counted = evaluateTable({ ...collectTable, aggregate: { field: 'amt', op: 'count' } }, { x: 5 }, AT);
  t.equal(counted.outputs['amt'], 2, 'COLLECT count aggregates an integer count');

  const priorityTable: DecisionTable = {
    id: 'prio_t',
    hitPolicy: 'PRIORITY',
    inputFields: ['x'],
    outputFields: ['label'],
    rows: [
      { id: 'low', priority: 1, when: alwaysA, outputs: { label: 'LOW' }, reasonCode: 'RL' },
      { id: 'high', priority: 5, when: alwaysA, outputs: { label: 'HIGH' }, reasonCode: 'RH' },
    ],
  };
  const prio = evaluateTable(priorityTable, { x: 5 }, AT);
  t.equal(prio.outputs['label'], 'HIGH', 'PRIORITY selects the highest-priority matched row');
  t.deepEqual(prio.matchedRowIds, ['high'], 'PRIORITY reports the winning row');

  const noMatch = evaluateTable(
    {
      ...firstTable,
      rows: [
        {
          id: 'a',
          when: { type: 'compare', field: 'x', op: 'gt', value: 999, valueType: 'number' },
          outputs: { label: 'A' },
          reasonCode: 'RA',
        },
      ],
    },
    { x: 5 },
    AT,
  );
  t.deepEqual(noMatch.matchedRowIds, [], 'no match => no matched rows');
  t.deepEqual(noMatch.outputs, {}, 'no match => empty outputs');
  t.ok(noMatch.warnings.includes('NO_MATCH'), 'no match => a NO_MATCH warning');

  // effective-date windowing uses the explicit evaluatedAt
  const effTable: DecisionTable = {
    id: 'eff_t',
    hitPolicy: 'FIRST',
    inputFields: ['x'],
    outputFields: ['label'],
    rows: [
      {
        id: 'future',
        when: { type: 'present', field: 'x' },
        outputs: { label: 'F' },
        reasonCode: 'RF',
        effectiveFrom: '2027-01-01',
      },
      { id: 'current', when: { type: 'present', field: 'x' }, outputs: { label: 'C' }, reasonCode: 'RC' },
    ],
  };
  t.equal(
    evaluateTable(effTable, { x: 1 }, '2026-06-01').outputs['label'],
    'C',
    'a not-yet-effective row is skipped at the given evaluatedAt',
  );
  t.equal(
    evaluateTable(effTable, { x: 1 }, '2027-06-01').outputs['label'],
    'F',
    'once effective, the row participates',
  );
  const disabled = evaluateTable(
    {
      ...effTable,
      rows: [
        {
          id: 'off',
          enabled: false,
          when: { type: 'present', field: 'x' },
          outputs: { label: 'X' },
          reasonCode: 'R',
        },
        { id: 'on', when: { type: 'present', field: 'x' }, outputs: { label: 'Y' }, reasonCode: 'R' },
      ],
    },
    { x: 1 },
    AT,
  );
  t.equal(disabled.outputs['label'], 'Y', 'a disabled row is skipped');

  // =================================================================================================
  // 4) LIFECYCLE — state machine + immutability
  // =================================================================================================
  t.equal(RULESET_STATUSES.length, 6, 'six rule-set statuses');
  t.equal(RULESET_ACTIONS.length, 6, 'six rule-set actions');
  const v = checkRuleSetTransition('DRAFT', 'validate');
  t.ok(v.ok && v.to === 'VALIDATED', 'DRAFT --validate--> VALIDATED');
  const pub = checkRuleSetTransition('VALIDATED', 'publish');
  t.ok(pub.ok && pub.to === 'PUBLISHED', 'VALIDATED --publish--> PUBLISHED');
  t.ok(checkRuleSetTransition('PUBLISHED', 'activate').ok, 'PUBLISHED --activate--> ACTIVE');
  t.ok(!checkRuleSetTransition('DRAFT', 'publish').ok, 'cannot publish an unvalidated draft');
  t.ok(!checkRuleSetTransition('PUBLISHED', 'revise').ok, 'cannot revise a published version');
  t.ok(!checkRuleSetTransition('ARCHIVED', 'activate').ok, 'ARCHIVED is terminal');
  t.ok(!isRuleSetContentFrozen('DRAFT'), 'draft content is editable');
  t.ok(!isRuleSetContentFrozen('VALIDATED'), 'validated content is still editable via revise');
  t.ok(isRuleSetContentFrozen('PUBLISHED'), 'published content is frozen');
  t.ok(isRuleSetContentFrozen('ACTIVE'), 'active content is frozen');
  t.ok(isRuleSetContentFrozen('ARCHIVED'), 'archived content is frozen');

  // =================================================================================================
  // 5) VALIDATOR — accepts good, rejects each defect
  // =================================================================================================
  t.ok(validateRuleSet(goodSpec()).ok, 'a well-formed rule set validates');
  t.ok(!validateRuleSet(null).ok, 'a non-object is rejected');
  t.ok(hasCode(validateRuleSet('nope'), 'NOT_OBJECT'), 'a string rule set is NOT_OBJECT');
  t.equal(RULE_SCHEMA_VERSION, 1, 'schema version is 1');

  const badVersion = clone();
  badVersion['schemaVersion'] = 2;
  t.ok(hasCode(validateRuleSet(badVersion), 'BAD_SCHEMA_VERSION'), 'a wrong schemaVersion is rejected');

  const badCode = clone();
  badCode['code'] = 'Not A Slug';
  t.ok(hasCode(validateRuleSet(badCode), 'BAD_CODE'), 'a non-slug code is rejected');

  const dupTable = clone();
  const tables = dupTable['decisionTables'] as Record<string, unknown>[];
  tables.push(JSON.parse(JSON.stringify(tables[0])) as Record<string, unknown>);
  t.ok(hasCode(validateRuleSet(dupTable), 'DUP_TABLE'), 'a duplicate table id is rejected');

  const dupRow = clone();
  const rows0 = (dupRow['decisionTables'] as Record<string, unknown>[])[0]?.['rows'] as Record<
    string,
    unknown
  >[];
  rows0[1] = { ...rows0[0]! };
  t.ok(hasCode(validateRuleSet(dupRow), 'DUP_ROW'), 'a duplicate row id within a table is rejected');

  const badColumn = clone();
  ((badColumn['decisionTables'] as Record<string, unknown>[])[0]?.['rows'] as Record<string, unknown>[])[0]![
    'when'
  ] = { type: 'compare', field: 'ghost', op: 'eq', value: 1 };
  t.ok(
    hasCode(validateRuleSet(badColumn), 'BAD_COLUMN_REF'),
    'a condition referencing an unknown column is rejected',
  );

  const missingOut = clone();
  ((missingOut['decisionTables'] as Record<string, unknown>[])[0]?.['rows'] as Record<string, unknown>[])[0]![
    'outputs'
  ] = {};
  t.ok(
    hasCode(validateRuleSet(missingOut), 'MISSING_OUTPUT'),
    'a row missing a mandatory output is rejected',
  );

  const badOutRef = clone();
  ((badOutRef['decisionTables'] as Record<string, unknown>[])[0]?.['rows'] as Record<string, unknown>[])[0]![
    'outputs'
  ] = { decision: 'OK', ghost: 1 };
  t.ok(
    hasCode(validateRuleSet(badOutRef), 'BAD_OUTPUT_REF'),
    'a row output not in the output schema is rejected',
  );

  const badEnum = clone();
  ((badEnum['decisionTables'] as Record<string, unknown>[])[0]?.['rows'] as Record<string, unknown>[])[0]![
    'when'
  ] = { type: 'compare', field: 'country', op: 'eq', value: 'XX' };
  t.ok(hasCode(validateRuleSet(badEnum), 'BAD_ENUM'), 'comparing an enum field to a non-member is rejected');

  const badRange = clone();
  ((badRange['decisionTables'] as Record<string, unknown>[])[0]?.['rows'] as Record<string, unknown>[])[0]![
    'when'
  ] = { type: 'range', field: 'amount', min: '100', max: '50', valueType: 'decimal' };
  t.ok(hasCode(validateRuleSet(badRange), 'BAD_RANGE'), 'a range whose min exceeds max is rejected');

  const cyclic = clone();
  cyclic['derived'] = [
    { name: 'a', op: 'add', args: ['b', '1'] },
    { name: 'b', op: 'add', args: ['a', '1'] },
  ];
  t.ok(hasCode(validateRuleSet(cyclic), 'DERIVED_CYCLE'), 'a cyclic derived-field graph is rejected');
  t.deepEqual(
    derivedCycleCheck([
      { name: 'a', op: 'add', args: ['b', '1'] },
      { name: 'b', op: 'add', args: ['a', '1'] },
    ]),
    ['a', 'b'],
    'derivedCycleCheck names the members of the cycle',
  );
  t.deepEqual(
    derivedCycleCheck([{ name: 'a', op: 'add', args: ['x', '1'] }]),
    [],
    'an acyclic derived graph has no cycle',
  );

  const tooManyRows = clone();
  const bigRows: Record<string, unknown>[] = [];
  for (let i = 0; i < RULE_LIMITS.maxRowsPerTable + 1; i += 1) {
    bigRows.push({
      id: `row_${String(i)}`,
      when: { type: 'present', field: 'score' },
      outputs: { decision: 'X' },
      reasonCode: 'R',
    });
  }
  (tooManyRows['decisionTables'] as Record<string, unknown>[])[0]!['rows'] = bigRows;
  t.ok(
    hasCode(validateRuleSet(tooManyRows), 'TOO_MANY_ROWS'),
    'exceeding the per-table row limit is rejected',
  );

  const tooDeep = clone();
  let deep: unknown = { type: 'compare', field: 'score', op: 'ge', value: 0, valueType: 'number' };
  for (let i = 0; i < RULE_LIMITS.maxConditionDepth + 2; i += 1) deep = { type: 'not', condition: deep };
  ((tooDeep['decisionTables'] as Record<string, unknown>[])[0]?.['rows'] as Record<string, unknown>[])[0]![
    'when'
  ] = deep;
  t.ok(hasCode(validateRuleSet(tooDeep), 'COND_TOO_DEEP'), 'an over-deep condition is rejected');

  const unsafeOp = clone();
  ((unsafeOp['decisionTables'] as Record<string, unknown>[])[0]?.['rows'] as Record<string, unknown>[])[0]![
    'when'
  ] = { type: 'compare', field: 'score', op: 'exec', value: 1 };
  t.ok(
    hasCode(validateRuleSet(unsafeOp), 'BAD_OPERATOR'),
    'an unsafe/unknown operator is rejected at validate time',
  );

  const unsafeType = clone();
  ((unsafeType['decisionTables'] as Record<string, unknown>[])[0]?.['rows'] as Record<string, unknown>[])[0]![
    'when'
  ] = { type: '__proto__', field: 'score' };
  t.ok(
    hasCode(validateRuleSet(unsafeType), 'UNSAFE_CONDITION'),
    'an unknown condition type is rejected at validate time',
  );

  const badAgg = clone();
  const aggTable = (badAgg['decisionTables'] as Record<string, unknown>[])[0];
  if (aggTable !== undefined) {
    aggTable['hitPolicy'] = 'COLLECT';
    aggTable['aggregate'] = { field: 'decision', op: 'sum' }; // decision is a string, not decimal
  }
  t.ok(hasCode(validateRuleSet(badAgg), 'AGG_INVALID'), 'aggregating a non-decimal output field is rejected');

  // =================================================================================================
  // 6) ENGINE — deterministic evaluation + structured explanation
  // =================================================================================================
  const goodInput = { input: { amount: '1500.00', country: 'KE', score: 720, tier: 'gold' } };
  const exp = evaluateRuleSet(goodSpec(), goodInput);
  t.equal(exp.engineVersion, ENGINE_VERSION, 'the explanation carries the engine version');
  t.equal(exp.engineVersion, 'm07-rules/1', 'engine version is pinned');
  t.equal(exp.ruleSetCode, 'credit_decision', 'the explanation carries the rule-set code');
  t.equal(exp.outcome, 'matched', 'a matching input yields a matched outcome');
  t.equal(exp.outputs['decision'], 'APPROVE', 'the engine produces the expected output');
  t.ok(exp.matchedRuleIds.includes('r_ok'), 'the matched rule id is reported');
  t.ok(exp.reasonCodes.includes('SCORE_OK'), 'the reason code is reported');
  t.equal(exp.tableTraces[0]?.tableId, 't_decision', 'the table trace names the table in declared order');
  t.equal(exp.tableTraces.length, 1, 'one table trace for one table');
  t.equal(
    exp.derivedValues['fee_base'],
    '30.0000',
    'the derived field (2% of amount) is computed decimal-safe',
  );

  const exp2 = evaluateRuleSet(goodSpec(), goodInput);
  t.deepEqual(exp2, exp, 'identical (spec, input) yields an identical explanation (determinism)');

  const lowInput = { input: { amount: '500.00', country: 'UG', score: 550, tier: 'std' } };
  const lowExp = evaluateRuleSet(goodSpec(), lowInput);
  t.equal(lowExp.outputs['decision'], 'REVIEW', 'a low score routes to REVIEW');
  t.ok(lowExp.reasonCodes.includes('SCORE_LOW'), 'the low-score reason code is reported');

  // input schema validation (fail closed => INPUT_INVALID)
  t.throws(
    () => evaluateRuleSet(goodSpec(), { input: { country: 'KE', score: 720 } }),
    'a missing required input throws INPUT_INVALID',
  );
  t.throws(
    () => evaluateRuleSet(goodSpec(), { input: { amount: '1500.00', score: 'high' } }),
    'a wrong-typed input throws INPUT_INVALID',
  );
  t.throws(
    () => evaluateRuleSet(goodSpec(), { input: { amount: '1500.00', country: 'XX' } }),
    'an out-of-enum input throws INPUT_INVALID',
  );
  t.throws(
    () => evaluateRuleSet(goodSpec(), { input: { amount: '1500.00', tier: 'waaaay-too-long' } }),
    'an over-length input string throws INPUT_INVALID',
  );
  t.throws(
    () => evaluateRuleSet(goodSpec(), { input: { amount: '1.234' } }),
    'a decimal exceeding its declared scale throws INPUT_INVALID',
  );

  let inErr: unknown;
  try {
    evaluateRuleSet(goodSpec(), { input: { country: 'KE' } });
  } catch (e) {
    inErr = e;
  }
  t.ok(inErr instanceof RuleError && inErr.code === 'INPUT_INVALID', 'the input error is a coded RuleError');

  // output schema validation (fail closed => OUTPUT_INVALID)
  const badOutSpec: RuleSetSpec = {
    schemaVersion: 1,
    code: 'bad_out',
    name: 'bad out',
    inputSchema: [{ name: 'x', type: 'number' }],
    outputSchema: [{ name: 'decision', type: 'string', required: true }],
    decisionTables: [
      {
        id: 't',
        hitPolicy: 'FIRST',
        inputFields: ['x'],
        outputFields: ['decision'],
        rows: [
          {
            id: 'r',
            when: { type: 'present', field: 'x' },
            outputs: { decision: 5 },
            reasonCode: 'R',
          },
        ],
      },
    ],
  };
  t.throws(
    () => evaluateRuleSet(badOutSpec, { input: { x: 1 } }),
    'a produced output of the wrong type throws OUTPUT_INVALID',
  );

  // no-match at the engine level
  const noHitSpec = goodSpec();
  const noHit = evaluateRuleSet(
    {
      ...noHitSpec,
      decisionTables: [
        {
          id: 't_decision',
          hitPolicy: 'FIRST',
          inputFields: ['score'],
          outputFields: ['decision'],
          rows: [
            {
              id: 'r_ok',
              when: { type: 'compare', field: 'score', op: 'gt', value: 999, valueType: 'number' },
              outputs: { decision: 'APPROVE' },
              reasonCode: 'SCORE_OK',
            },
          ],
        },
      ],
    },
    goodInput,
  );
  t.equal(noHit.outcome, 'no_match', 'no matching row yields a no_match outcome');
  t.deepEqual(noHit.outputs, {}, 'a no_match yields empty outputs');

  // input bounds / abuse
  t.throws(
    () =>
      evaluateRuleSet(
        { ...goodSpec(), inputSchema: [{ name: 'big', type: 'string' }, ...goodSpec().inputSchema] },
        { input: { amount: '1500.00', big: 'x'.repeat(RULE_LIMITS.maxStringLength + 1) } },
      ),
    'an oversized input string is rejected',
  );
  const deepInput: Record<string, unknown> = {};
  let cursor = deepInput;
  for (let i = 0; i < RULE_LIMITS.maxInputDepth + 2; i += 1) {
    const next: Record<string, unknown> = {};
    cursor['n'] = next;
    cursor = next;
  }
  t.throws(
    () => evaluateRuleSet(goodSpec(), { input: { amount: '1500.00', nested: deepInput } }),
    'excessively nested input is rejected',
  );
  const bigArray = new Array(RULE_LIMITS.maxCollectionSize + 1).fill(0);
  t.throws(
    () => evaluateRuleSet(goodSpec(), { input: { amount: '1500.00', list: bigArray } }),
    'an oversized input collection is rejected',
  );

  // =================================================================================================
  // 7) INPUT HASH — stable, order-independent, sensitive to change
  // =================================================================================================
  const h1 = inputHash({ a: 1, b: 2, c: [3, { d: 4 }] });
  const h2 = inputHash({ c: [3, { d: 4 }], b: 2, a: 1 });
  t.equal(h1, h2, 'inputHash is independent of key order (canonicalized)');
  t.equal(h1.length, 64, 'inputHash is a sha256 hex digest');
  t.notEqual(inputHash({ a: 1 }), inputHash({ a: 2 }), 'inputHash changes when a value changes');
  t.equal(inputHash({ a: 1 }), inputHash({ a: 1 }), 'inputHash is stable for identical input');
});
