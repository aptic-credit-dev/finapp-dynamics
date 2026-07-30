import { defineSuite } from '@finapp/test-runner';
import {
  DOMAIN_EVENT_FAMILIES,
  DATA_CLASSIFICATIONS,
  isValidEventFamily,
  EVENT_FAMILY_PATTERN,
  TENANT_LIFECYCLE_FAMILY,
  TENANT_LIFECYCLE_EVENT_TYPES,
  TENANT_LIFECYCLE_VERSION,
  IDENTITY_LIFECYCLE_FAMILY,
  IDENTITY_LIFECYCLE_EVENT_TYPES,
  AUTH_LIFECYCLE_FAMILY,
  AUTH_LIFECYCLE_EVENT_TYPES,
  AUTH_LIFECYCLE_VERSION,
  AUTHZ_LIFECYCLE_FAMILY,
  AUTHZ_LIFECYCLE_EVENT_TYPES,
  AUTHZ_LIFECYCLE_VERSION,
  WORKFLOW_LIFECYCLE_FAMILY,
  WORKFLOW_LIFECYCLE_EVENT_TYPES,
  WORKFLOW_LIFECYCLE_VERSION,
  RULES_LIFECYCLE_FAMILY,
  RULES_LIFECYCLE_EVENT_TYPES,
  RULES_LIFECYCLE_VERSION,
  NOTIFICATION_LIFECYCLE_FAMILY,
  NOTIFICATION_LIFECYCLE_EVENT_TYPES,
  NOTIFICATION_LIFECYCLE_VERSION,
  DOCUMENT_LIFECYCLE_FAMILY,
  DOCUMENT_LIFECYCLE_EVENT_TYPES,
  DOCUMENT_LIFECYCLE_VERSION,
  FEEDBACK_LIFECYCLE_FAMILY,
  FEEDBACK_LIFECYCLE_EVENT_TYPES,
  FEEDBACK_LIFECYCLE_VERSION,
  CASE_LIFECYCLE_FAMILY,
  CASE_LIFECYCLE_EVENT_TYPES,
  CASE_LIFECYCLE_VERSION,
  CASE_CONVERTED_TO_MATTER_FAMILY,
  CASE_CONVERTED_TO_MATTER_EVENT_TYPES,
  CASE_CONVERTED_TO_MATTER_VERSION,
  LEGAL_LIFECYCLE_FAMILY,
  LEGAL_LIFECYCLE_EVENT_TYPES,
  LEGAL_LIFECYCLE_VERSION,
  LITIGATION_LIFECYCLE_FAMILY,
  LITIGATION_LIFECYCLE_EVENT_TYPES,
  LITIGATION_LIFECYCLE_VERSION,
  RECOVERY_LIFECYCLE_FAMILY,
  RECOVERY_LIFECYCLE_EVENT_TYPES,
  RECOVERY_LIFECYCLE_VERSION,
  LEGALDOCS_LIFECYCLE_FAMILY,
  LEGALDOCS_LIFECYCLE_EVENT_TYPES,
  LEGALDOCS_LIFECYCLE_VERSION,
  FINANCE_LIFECYCLE_FAMILY,
  FINANCE_LIFECYCLE_EVENT_TYPES,
  FINANCE_LIFECYCLE_VERSION,
  RECONCILIATION_LIFECYCLE_FAMILY,
  RECONCILIATION_LIFECYCLE_EVENT_TYPES,
  RECONCILIATION_LIFECYCLE_VERSION,
} from '@finapp/contracts';

/**
 * Contracts PURE smoke suite.
 *
 * The family count is asserted exactly, and it is meant to be edited: a family may only appear here in
 * the same change as the module that owns and emits it (CLAUDE.md — events ship with their module). If
 * this number changes on its own, someone has declared an event ahead of its module.
 *
 * Stage 0: 0 families. Stage 1A: 1 (`tenant.lifecycle`, m01-tenant). Stage 1B: 2 (+ `identity.lifecycle`,
 * m02-identity).
 */
export default defineSuite('contracts', (t) => {
  t.equal(DOMAIN_EVENT_FAMILIES.length, 17, 'Stage 3 declares seventeen event families');
  t.ok(DOMAIN_EVENT_FAMILIES.includes(TENANT_LIFECYCLE_FAMILY), 'tenant.lifecycle is declared');
  t.ok(DOMAIN_EVENT_FAMILIES.includes(IDENTITY_LIFECYCLE_FAMILY), 'identity.lifecycle is declared');
  t.ok(DOMAIN_EVENT_FAMILIES.includes(AUTH_LIFECYCLE_FAMILY), 'identity.authentication is declared (1C)');
  t.ok(DOMAIN_EVENT_FAMILIES.includes(AUTHZ_LIFECYCLE_FAMILY), 'identity.authorization is declared (1D)');
  t.ok(DOMAIN_EVENT_FAMILIES.includes(WORKFLOW_LIFECYCLE_FAMILY), 'workflow.lifecycle is declared (2.2)');
  t.ok(DOMAIN_EVENT_FAMILIES.includes(RULES_LIFECYCLE_FAMILY), 'rules.lifecycle is declared (2.3)');
  t.ok(
    DOMAIN_EVENT_FAMILIES.includes(NOTIFICATION_LIFECYCLE_FAMILY),
    'notification.lifecycle is declared (2.4)',
  );
  t.ok(DOMAIN_EVENT_FAMILIES.includes(DOCUMENT_LIFECYCLE_FAMILY), 'document.lifecycle is declared (2.5)');
  t.ok(DOMAIN_EVENT_FAMILIES.includes(FEEDBACK_LIFECYCLE_FAMILY), 'feedback.lifecycle is declared (3.1)');
  t.ok(DOMAIN_EVENT_FAMILIES.includes(CASE_LIFECYCLE_FAMILY), 'case.lifecycle is declared (3.2)');
  t.ok(
    DOMAIN_EVENT_FAMILIES.includes(CASE_CONVERTED_TO_MATTER_FAMILY),
    'case.converted_to_matter is declared (3.2)',
  );
  // Order is append-only: consumers and the outbox key off the family name, and reordering the union is
  // how a replay silently reinterprets history.
  t.equal(
    DOMAIN_EVENT_FAMILIES[0],
    TENANT_LIFECYCLE_FAMILY,
    'tenant.lifecycle stays first — families append at the tail',
  );
  t.equal(IDENTITY_LIFECYCLE_EVENT_TYPES.length, 18, 'identity.lifecycle declares 18 event types');
  t.equal(
    new Set(IDENTITY_LIFECYCLE_EVENT_TYPES).size,
    IDENTITY_LIFECYCLE_EVENT_TYPES.length,
    'no identity event type is declared twice',
  );
  t.equal(AUTH_LIFECYCLE_VERSION, 1, 'identity.authentication payloads are at version 1');
  t.equal(AUTH_LIFECYCLE_EVENT_TYPES.length, 11, 'identity.authentication declares 11 event types');
  t.equal(
    new Set(AUTH_LIFECYCLE_EVENT_TYPES).size,
    AUTH_LIFECYCLE_EVENT_TYPES.length,
    'no auth event type is declared twice',
  );
  t.ok(isValidEventFamily(AUTH_LIFECYCLE_FAMILY), 'identity.authentication satisfies the family pattern');
  t.equal(AUTHZ_LIFECYCLE_VERSION, 1, 'identity.authorization payloads are at version 1');
  t.equal(AUTHZ_LIFECYCLE_EVENT_TYPES.length, 12, 'identity.authorization declares 12 event types');
  t.ok(isValidEventFamily(AUTHZ_LIFECYCLE_FAMILY), 'identity.authorization satisfies the family pattern');
  t.equal(WORKFLOW_LIFECYCLE_VERSION, 1, 'workflow.lifecycle payloads are at version 1');
  t.equal(WORKFLOW_LIFECYCLE_EVENT_TYPES.length, 14, 'workflow.lifecycle declares 14 event types');
  t.equal(
    new Set(WORKFLOW_LIFECYCLE_EVENT_TYPES).size,
    WORKFLOW_LIFECYCLE_EVENT_TYPES.length,
    'no workflow event type is declared twice',
  );
  t.ok(isValidEventFamily(WORKFLOW_LIFECYCLE_FAMILY), 'workflow.lifecycle satisfies the family pattern');
  t.equal(RULES_LIFECYCLE_VERSION, 1, 'rules.lifecycle payloads are at version 1');
  t.equal(RULES_LIFECYCLE_EVENT_TYPES.length, 9, 'rules.lifecycle declares 9 event types');
  t.ok(isValidEventFamily(RULES_LIFECYCLE_FAMILY), 'rules.lifecycle satisfies the family pattern');
  t.equal(NOTIFICATION_LIFECYCLE_VERSION, 1, 'notification.lifecycle payloads are at version 1');
  t.equal(NOTIFICATION_LIFECYCLE_EVENT_TYPES.length, 21, 'notification.lifecycle declares 21 event types');
  t.equal(
    new Set(NOTIFICATION_LIFECYCLE_EVENT_TYPES).size,
    NOTIFICATION_LIFECYCLE_EVENT_TYPES.length,
    'no notification event type is declared twice',
  );
  t.ok(
    isValidEventFamily(NOTIFICATION_LIFECYCLE_FAMILY),
    'notification.lifecycle satisfies the family pattern',
  );
  t.equal(DOCUMENT_LIFECYCLE_VERSION, 1, 'document.lifecycle payloads are at version 1');
  t.equal(DOCUMENT_LIFECYCLE_EVENT_TYPES.length, 22, 'document.lifecycle declares 22 event types');
  t.equal(
    new Set(DOCUMENT_LIFECYCLE_EVENT_TYPES).size,
    DOCUMENT_LIFECYCLE_EVENT_TYPES.length,
    'no document event type is declared twice',
  );
  t.ok(isValidEventFamily(DOCUMENT_LIFECYCLE_FAMILY), 'document.lifecycle satisfies the family pattern');
  t.equal(FEEDBACK_LIFECYCLE_VERSION, 1, 'feedback.lifecycle payloads are at version 1');
  t.equal(FEEDBACK_LIFECYCLE_EVENT_TYPES.length, 24, 'feedback.lifecycle declares 24 event types');
  t.equal(
    new Set(FEEDBACK_LIFECYCLE_EVENT_TYPES).size,
    FEEDBACK_LIFECYCLE_EVENT_TYPES.length,
    'no feedback event type is declared twice',
  );
  t.ok(isValidEventFamily(FEEDBACK_LIFECYCLE_FAMILY), 'feedback.lifecycle satisfies the family pattern');
  t.equal(CASE_LIFECYCLE_VERSION, 1, 'case.lifecycle payloads are at version 1');
  t.equal(CASE_LIFECYCLE_EVENT_TYPES.length, 32, 'case.lifecycle declares 32 event types');
  t.equal(
    new Set(CASE_LIFECYCLE_EVENT_TYPES).size,
    CASE_LIFECYCLE_EVENT_TYPES.length,
    'no case event type is declared twice',
  );
  t.ok(isValidEventFamily(CASE_LIFECYCLE_FAMILY), 'case.lifecycle satisfies the family pattern');
  t.equal(CASE_CONVERTED_TO_MATTER_VERSION, 1, 'case.converted_to_matter payloads are at version 1');
  t.equal(CASE_CONVERTED_TO_MATTER_EVENT_TYPES.length, 1, 'case.converted_to_matter declares one event type');
  t.ok(
    isValidEventFamily(CASE_CONVERTED_TO_MATTER_FAMILY),
    'case.converted_to_matter satisfies the family pattern',
  );
  t.ok(DOMAIN_EVENT_FAMILIES.includes(LEGAL_LIFECYCLE_FAMILY), 'legal.lifecycle is declared (4.1)');
  t.equal(LEGAL_LIFECYCLE_VERSION, 1, 'legal.lifecycle payloads are at version 1');
  t.equal(LEGAL_LIFECYCLE_EVENT_TYPES.length, 36, 'legal.lifecycle declares 36 event types');
  t.equal(
    new Set(LEGAL_LIFECYCLE_EVENT_TYPES).size,
    LEGAL_LIFECYCLE_EVENT_TYPES.length,
    'no legal event type is declared twice',
  );
  t.ok(isValidEventFamily(LEGAL_LIFECYCLE_FAMILY), 'legal.lifecycle satisfies the family pattern');
  t.ok(DOMAIN_EVENT_FAMILIES.includes(LITIGATION_LIFECYCLE_FAMILY), 'litigation.lifecycle is declared (4.2)');
  t.equal(LITIGATION_LIFECYCLE_VERSION, 1, 'litigation.lifecycle payloads are at version 1');
  t.equal(LITIGATION_LIFECYCLE_EVENT_TYPES.length, 36, 'litigation.lifecycle declares 36 event types');
  t.equal(
    new Set(LITIGATION_LIFECYCLE_EVENT_TYPES).size,
    LITIGATION_LIFECYCLE_EVENT_TYPES.length,
    'litigation.lifecycle event types are unique',
  );
  t.ok(isValidEventFamily(LITIGATION_LIFECYCLE_FAMILY), 'litigation.lifecycle satisfies the family pattern');
  t.ok(DOMAIN_EVENT_FAMILIES.includes(RECOVERY_LIFECYCLE_FAMILY), 'recovery.lifecycle is declared (4.3)');
  t.equal(RECOVERY_LIFECYCLE_VERSION, 1, 'recovery.lifecycle payloads are at version 1');
  t.equal(RECOVERY_LIFECYCLE_EVENT_TYPES.length, 36, 'recovery.lifecycle declares 36 event types');
  t.equal(
    new Set(RECOVERY_LIFECYCLE_EVENT_TYPES).size,
    RECOVERY_LIFECYCLE_EVENT_TYPES.length,
    'recovery.lifecycle event types are unique',
  );
  t.ok(isValidEventFamily(RECOVERY_LIFECYCLE_FAMILY), 'recovery.lifecycle satisfies the family pattern');
  t.ok(DOMAIN_EVENT_FAMILIES.includes(LEGALDOCS_LIFECYCLE_FAMILY), 'legaldocs.lifecycle is declared (4.4)');
  t.equal(LEGALDOCS_LIFECYCLE_VERSION, 1, 'legaldocs.lifecycle payloads are at version 1');
  t.equal(LEGALDOCS_LIFECYCLE_EVENT_TYPES.length, 36, 'legaldocs.lifecycle declares 36 event types');
  t.equal(
    new Set(LEGALDOCS_LIFECYCLE_EVENT_TYPES).size,
    LEGALDOCS_LIFECYCLE_EVENT_TYPES.length,
    'legaldocs.lifecycle event types are unique',
  );
  t.ok(isValidEventFamily(LEGALDOCS_LIFECYCLE_FAMILY), 'legaldocs.lifecycle satisfies the family pattern');
  t.ok(DOMAIN_EVENT_FAMILIES.includes(FINANCE_LIFECYCLE_FAMILY), 'finance.lifecycle is declared (3.1)');
  t.equal(FINANCE_LIFECYCLE_VERSION, 1, 'finance.lifecycle payloads are at version 1');
  t.equal(FINANCE_LIFECYCLE_EVENT_TYPES.length, 33, 'finance.lifecycle declares 33 event types');
  t.equal(
    new Set(FINANCE_LIFECYCLE_EVENT_TYPES).size,
    FINANCE_LIFECYCLE_EVENT_TYPES.length,
    'finance.lifecycle event types are unique',
  );
  t.ok(isValidEventFamily(FINANCE_LIFECYCLE_FAMILY), 'finance.lifecycle satisfies the family pattern');
  t.ok(
    DOMAIN_EVENT_FAMILIES.includes(RECONCILIATION_LIFECYCLE_FAMILY),
    'reconciliation.lifecycle is declared (3)',
  );
  t.equal(RECONCILIATION_LIFECYCLE_VERSION, 1, 'reconciliation.lifecycle payloads are at version 1');
  t.equal(
    RECONCILIATION_LIFECYCLE_EVENT_TYPES.length,
    24,
    'reconciliation.lifecycle declares 24 event types',
  );
  t.equal(
    new Set(RECONCILIATION_LIFECYCLE_EVENT_TYPES).size,
    RECONCILIATION_LIFECYCLE_EVENT_TYPES.length,
    'reconciliation.lifecycle event types are unique',
  );
  t.ok(
    isValidEventFamily(RECONCILIATION_LIFECYCLE_FAMILY),
    'reconciliation.lifecycle satisfies the family pattern',
  );
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
