import { defineSuite } from '@finapp/test-runner';
import {
  M32_PERMISSIONS,
  ALL_M32_PERMISSIONS,
  M32_PRIVILEGED_PERMISSIONS,
  ALL_M32_AUDIT_CODES,
  ANALYTICS_AUDIT_PREFIX,
  AGGREGATIONS,
  VALUE_KINDS,
  QUERY_OPERATORS,
  isMetricFrozen,
  isHumanActor,
  evaluateSodGate,
  evaluatePublishGate,
  evaluateEntitlement,
  compileMetricQuery,
  validateMetricDefinition,
  measureColumnForKind,
  REASON_CODES,
  contentHashOf,
  type DatasetSchema,
} from '../src/index.ts';

/**
 * M32 Analytics PURE smoke suite. Exercises the load-bearing controls WITHOUT a database: the analytics.* permission +
 * ANALYTICS_ audit shape; maker-checker/SoD + publish gates; the ENTITLEMENT intersection (aggregation grants no access);
 * and the GOVERNED SEMANTIC QUERY COMPILER (whitelisted dims/measures/operators, scalar-only values — an unknown field/
 * measure/operator or a non-scalar value fails closed, proving no arbitrary SQL).
 */
export default defineSuite('m32-analytics', (t) => {
  // --- permission shape ---------------------------------------------------------------------------
  t.equal(ALL_M32_PERMISSIONS.length, 12, 'twelve analytics.* permissions');
  for (const p of ALL_M32_PERMISSIONS) {
    t.ok(p.startsWith('analytics.'), `${p} is in the analytics namespace`);
    t.equal(p.split('.').length, 3, `${p} is exactly three segments`);
  }
  t.equal(new Set(ALL_M32_PERMISSIONS).size, ALL_M32_PERMISSIONS.length, 'no duplicate permission');
  t.ok(!ALL_M32_PERMISSIONS.includes('analytics.admin' as never), 'there is NO analytics.admin wildcard');
  t.equal(M32_PRIVILEGED_PERMISSIONS.length, 6, 'six privileged permissions');
  t.ok(
    M32_PRIVILEGED_PERMISSIONS.includes(M32_PERMISSIONS.metricPublish),
    'metric publish is privileged (controlled action)',
  );
  t.ok(M32_PRIVILEGED_PERMISSIONS.includes(M32_PERMISSIONS.exportCreate), 'export is privileged');
  t.ok(
    !M32_PRIVILEGED_PERMISSIONS.includes(M32_PERMISSIONS.queryRun),
    'running a query is not privileged (entitlement-gated in-service)',
  );

  // --- audit shape --------------------------------------------------------------------------------
  t.equal(ALL_M32_AUDIT_CODES.length, 17, 'seventeen ANALYTICS_ audit codes');
  for (const c of ALL_M32_AUDIT_CODES) {
    t.ok(c.startsWith(ANALYTICS_AUDIT_PREFIX), `${c} carries the ANALYTICS_ prefix`);
    t.ok(c.split('_').length >= 3, `${c} is >= 3 segments`);
  }
  t.equal(new Set(ALL_M32_AUDIT_CODES).size, ALL_M32_AUDIT_CODES.length, 'no duplicate audit code');

  // --- vocabulary ---------------------------------------------------------------------------------
  t.deepEqual(
    [...AGGREGATIONS],
    ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'],
    'six whitelisted aggregations',
  );
  t.deepEqual(
    [...VALUE_KINDS],
    ['count', 'minor_amount', 'decimal', 'bps'],
    'four money-safe value kinds (no float)',
  );
  t.deepEqual(
    [...QUERY_OPERATORS],
    ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'between'],
    'eight whitelisted operators',
  );
  t.ok(isMetricFrozen('superseded') && isMetricFrozen('rejected'), 'terminal metric states are frozen');
  t.ok(!isMetricFrozen('published'), 'published is not terminal (may move to superseded)');
  t.equal(
    measureColumnForKind('minor_amount'),
    'measure_value_minor',
    'money reads the bigint minor column (no float)',
  );
  t.equal(measureColumnForKind('decimal'), 'measure_value_numeric', 'ratios read the exact numeric column');
  t.equal(measureColumnForKind('count'), 'measure_count', 'counts read the bigint count column');

  // --- maker-checker / SoD ------------------------------------------------------------------------
  t.ok(!evaluateSodGate('u1', 'u1').allowed, 'the approver cannot be the requester (self-approval)');
  t.ok(!evaluateSodGate('u1', 'ai').allowed, 'AI cannot approve');
  t.ok(!evaluateSodGate('u1', null).allowed, 'a null approver is refused');
  t.ok(evaluateSodGate('u1', 'u2').allowed, 'a distinct human approver is allowed');
  t.ok(
    !evaluatePublishGate({ validationPassed: false, requestedBy: 'u1', approver: 'u2' }).allowed,
    'an unvalidated metric cannot be published',
  );
  t.ok(
    evaluatePublishGate({ validationPassed: true, requestedBy: 'u1', approver: 'u2' }).allowed,
    'a validated + independently-approved metric can be published',
  );
  t.ok(!isHumanActor('automation'), 'automation is not human');

  // --- entitlement intersection: aggregation grants NO access -------------------------------------
  const caller = {
    tenantId: 't',
    scopeLevel: 'tenant',
    entitlements: ['analytics.metric.read'],
    sensitivityClearance: 'internal',
  };
  t.ok(
    evaluateEntitlement(
      { requiredEntitlements: ['analytics.metric.read'], minScope: 'tenant', sensitivityFloor: 'internal' },
      caller,
    ).allowed,
    'a caller holding the required entitlement at scope is allowed',
  );
  t.ok(
    !evaluateEntitlement(
      {
        requiredEntitlements: ['analytics.metric.read', 'finance.analytics.read'],
        minScope: 'tenant',
        sensitivityFloor: 'internal',
      },
      caller,
    ).allowed,
    'a caller missing ONE required entitlement is denied (aggregation grants no access)',
  );
  t.equal(
    evaluateEntitlement(
      { requiredEntitlements: ['finance.analytics.read'], minScope: 'tenant', sensitivityFloor: 'internal' },
      caller,
    ).reasonCode,
    REASON_CODES.missingEntitlement,
    'missing-entitlement reason',
  );
  t.ok(
    !evaluateEntitlement(
      { requiredEntitlements: [], minScope: 'platform', sensitivityFloor: 'internal' },
      caller,
    ).allowed,
    'a tenant caller cannot reach a platform-scoped metric',
  );
  t.ok(
    !evaluateEntitlement(
      { requiredEntitlements: [], minScope: 'tenant', sensitivityFloor: 'restricted' },
      caller,
    ).allowed,
    'a caller below the sensitivity floor is denied',
  );

  // --- GOVERNED QUERY COMPILER: no arbitrary SQL --------------------------------------------------
  const schema: DatasetSchema = { dimensionKeys: ['region', 'status'], measureKeys: ['amount', 'id'] };
  const good = compileMetricQuery({ aggregation: 'sum', measureKey: 'amount' }, schema, {
    aggregation: 'sum',
    measureKey: 'amount',
    groupBy: ['region'],
    filters: [{ field: 'status', op: 'eq', value: 'open' }],
  });
  t.ok(good.ok && good.plan !== undefined, 'a query over whitelisted dims/measure/operator compiles');
  t.equal(good.plan?.filters.length, 1, 'the compiled plan is a structured descriptor (not SQL)');
  const badDim = compileMetricQuery({ aggregation: 'sum', measureKey: 'amount' }, schema, {
    aggregation: 'sum',
    measureKey: 'amount',
    groupBy: ['not_a_dim'],
  });
  t.ok(
    !badDim.ok && badDim.reasonCode === REASON_CODES.unknownDimension,
    'an unknown group-by dimension fails closed',
  );
  const badMeasure = compileMetricQuery({ aggregation: 'sum', measureKey: 'nope' }, schema, {
    aggregation: 'sum',
    measureKey: 'nope',
  });
  t.ok(
    !badMeasure.ok && badMeasure.reasonCode === REASON_CODES.unknownMeasure,
    'an unknown measure fails closed',
  );
  const badOp = compileMetricQuery({ aggregation: 'sum', measureKey: 'amount' }, schema, {
    aggregation: 'sum',
    measureKey: 'amount',
    filters: [{ field: 'region', op: 'like', value: 'x' }],
  });
  t.ok(
    !badOp.ok && badOp.reasonCode === REASON_CODES.unknownOperator,
    'a non-whitelisted operator (like) fails closed',
  );
  const sqlInjectionField = compileMetricQuery({ aggregation: 'sum', measureKey: 'amount' }, schema, {
    aggregation: 'sum',
    measureKey: 'amount',
    filters: [{ field: 'region; DROP TABLE analytics_metric', op: 'eq', value: 'x' }],
  });
  t.ok(
    !sqlInjectionField.ok && sqlInjectionField.reasonCode === REASON_CODES.unknownDimension,
    'an SQL-injection field name is rejected (not a whitelisted dimension)',
  );
  const nonScalar = compileMetricQuery({ aggregation: 'sum', measureKey: 'amount' }, schema, {
    aggregation: 'sum',
    measureKey: 'amount',
    filters: [{ field: 'region', op: 'eq', value: { $ne: null } as never }],
  });
  t.ok(
    !nonScalar.ok && nonScalar.reasonCode === REASON_CODES.unsafeValue,
    'a non-scalar (object) filter value fails closed (no expression injection)',
  );

  // --- metric definition validation ---------------------------------------------------------------
  t.ok(
    validateMetricDefinition(
      {
        aggregation: 'sum',
        measureKey: 'amount',
        valueKind: 'minor_amount',
        currency: 'USD',
        dimensions: ['region'],
      },
      schema,
    ).passed,
    'a valid money metric with currency passes',
  );
  t.ok(
    !validateMetricDefinition(
      { aggregation: 'sum', measureKey: 'amount', valueKind: 'minor_amount', currency: null, dimensions: [] },
      schema,
    ).passed,
    'a money metric without a currency fails (no silent cross-currency)',
  );
  t.ok(
    !validateMetricDefinition(
      { aggregation: 'sum', measureKey: 'ghost', valueKind: 'count', currency: null, dimensions: [] },
      schema,
    ).passed,
    'a metric over an unknown measure fails',
  );

  // --- content hash deterministic -----------------------------------------------------------------
  t.equal(contentHashOf({ a: 1 }), contentHashOf({ a: 1 }), 'content hash is deterministic');
  t.ok(contentHashOf({ a: 1 }) !== contentHashOf({ a: 2 }), 'different definitions hash differently');
});
