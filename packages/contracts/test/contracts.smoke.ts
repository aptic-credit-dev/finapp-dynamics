import { defineSuite } from '@finapp/test-runner';
import { DOMAIN_EVENT_FAMILIES, isValidEventFamily, EVENT_FAMILY_PATTERN } from '@finapp/contracts';

/**
 * Contracts PURE smoke suite.
 *
 * Stage 0 asserts the union is EMPTY. That is the real assertion: no business event may exist before
 * the module that owns it (CLAUDE.md — events ship with their module). When Stage 1 lands m01, this
 * count changes deliberately, in the same commit as the family it describes.
 */
export default defineSuite('contracts', (t) => {
  t.equal(DOMAIN_EVENT_FAMILIES.length, 0, 'Stage 0 declares zero event families');

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
