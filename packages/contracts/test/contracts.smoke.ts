import { defineSuite } from '@finapp/test-runner';
import {
  DOMAIN_EVENT_FAMILIES,
  DATA_CLASSIFICATIONS,
  isValidEventFamily,
  EVENT_FAMILY_PATTERN,
  TENANT_LIFECYCLE_FAMILY,
  TENANT_LIFECYCLE_EVENT_TYPES,
  TENANT_LIFECYCLE_VERSION,
} from '@finapp/contracts';

/**
 * Contracts PURE smoke suite.
 *
 * The family count is asserted exactly, and it is meant to be edited: a family may only appear here in
 * the same change as the module that owns and emits it (CLAUDE.md — events ship with their module). If
 * this number changes on its own, someone has declared an event ahead of its module.
 *
 * Stage 0: 0 families. Stage 1A: 1 (`tenant.lifecycle`, m01-tenant).
 */
export default defineSuite('contracts', (t) => {
  t.equal(DOMAIN_EVENT_FAMILIES.length, 1, 'Stage 1A declares exactly one event family');
  t.ok(DOMAIN_EVENT_FAMILIES.includes(TENANT_LIFECYCLE_FAMILY), 'the family is tenant.lifecycle');
  t.ok(isValidEventFamily(TENANT_LIFECYCLE_FAMILY), 'tenant.lifecycle satisfies the family pattern');
  t.equal(new Set(DOMAIN_EVENT_FAMILIES).size, DOMAIN_EVENT_FAMILIES.length, 'no family is declared twice');

  // Every family in the union must be well-formed — the check that catches a PascalCase or three-segment
  // family slipping in with a future module.
  for (const family of DOMAIN_EVENT_FAMILIES) {
    t.ok(isValidEventFamily(family), `declared family "${family}" is well-formed`);
  }

  t.equal(TENANT_LIFECYCLE_VERSION, 1, 'tenant.lifecycle payloads are at version 1');
  t.equal(TENANT_LIFECYCLE_EVENT_TYPES.length, 17, 'tenant.lifecycle declares 17 event types');
  t.equal(
    new Set(TENANT_LIFECYCLE_EVENT_TYPES).size,
    TENANT_LIFECYCLE_EVENT_TYPES.length,
    'no event type is declared twice',
  );

  t.equal(DATA_CLASSIFICATIONS.length, 4, 'four data classifications');
  t.ok(DATA_CLASSIFICATIONS.includes('restricted'), 'restricted is a classification (ADR-006 gates it)');

  t.ok(isValidEventFamily('case.lifecycle'), 'a dot-lowercase family is valid');
  t.ok(isValidEventFamily('gl_reconciliation.exception_raised'), 'snake_case segments are valid');
  t.ok(!isValidEventFamily('Case.Lifecycle'), 'PascalCase is rejected');
  t.ok(!isValidEventFamily('case'), 'a family without a domain segment is rejected');
  t.ok(!isValidEventFamily('case.lifecycle.extra'), 'a three-segment family is rejected');
  t.ok(!isValidEventFamily(''), 'an empty family is rejected');
  t.ok(!isValidEventFamily('case..lifecycle'), 'an empty segment is rejected');
  t.ok(
    !isValidEventFamily('CASE_OPENED'),
    'an audit code is not an event family (ADR-005 keeps the axes distinct)',
  );

  // The pattern is exported for the conformance suite to reuse; it must not carry the /g flag, whose
  // lastIndex would make repeated .test() calls alternate between true and false.
  t.ok(!EVENT_FAMILY_PATTERN.global, 'EVENT_FAMILY_PATTERN is not global (repeated .test() is stable)');
  t.ok(EVENT_FAMILY_PATTERN.test('case.lifecycle'), 'pattern matches on first call');
  t.ok(EVENT_FAMILY_PATTERN.test('case.lifecycle'), 'pattern still matches on a repeat call');
});
