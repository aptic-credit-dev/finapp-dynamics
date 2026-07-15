import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { defineSuite } from '@finapp/test-runner';
import { validateEndpointSpec } from '@finapp/kernel';
import {
  DOMAIN_EVENT_FAMILIES,
  TENANT_LIFECYCLE_FAMILY,
  TENANT_LIFECYCLE_EVENT_TYPES,
} from '@finapp/contracts';
import {
  TENANT_STATUSES,
  TENANT_TRANSITIONS,
  checkTransition,
  isTerminal,
  allowsBusinessReads,
  allowsBusinessWrites,
  isTenantStatus,
  TENANT_TYPES,
  isTenantType,
  validateTenantCode,
  validateOrgCode,
  validateTimezone,
  validateCurrency,
  validateCountry,
  validateOrgNode,
  validateEnvironment,
  validateEffectiveDates,
  wouldCreateCycle,
  ENVIRONMENT_TYPES,
  ALL_TENANT_PERMISSIONS,
  ALL_TENANT_AUDIT_CODES,
  TENANT_ACTION_MAP,
  TENANT_ACTION_PERMISSIONS,
  TENANT_PERMISSION_NAMESPACE,
  TENANT_AUDIT_PREFIX,
  UUID_PATTERN,
  type TenantAction,
} from '@finapp/m01-tenant';

/**
 * M01 PURE smoke suite — the deterministic safety core, plus registry conformance.
 *
 * No database, no DI, no HTTP. Everything asserted here is what must hold before a single tenant row
 * exists: the lifecycle cannot be driven into an illegal state, validation is strict, and every name the
 * module uses is actually registered.
 */

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

function readYaml(relative: string): unknown {
  return parse(readFileSync(resolve(REPO_ROOT, relative), 'utf8'));
}

export default defineSuite('m01-tenant', (t) => {
  // --- lifecycle state machine ---------------------------------------------------------------------
  t.equal(TENANT_STATUSES.length, 10, 'ten tenant statuses');
  t.ok(isTenantStatus('active'), 'active is a status');
  t.ok(!isTenantStatus('enabled'), 'enabled is not a status');

  // The happy path, one transition at a time.
  t.equal(checkTransition('draft', 'submit_review').to, 'under_review', 'draft -> under_review');
  t.equal(checkTransition('under_review', 'approve').to, 'approved', 'under_review -> approved');
  t.equal(checkTransition('approved', 'start_provisioning').to, 'provisioning', 'approved -> provisioning');
  t.equal(
    checkTransition('provisioning', 'complete_provisioning').to,
    'approved',
    'provisioning -> approved',
  );
  t.equal(checkTransition('approved', 'activate').to, 'active', 'approved -> active');

  // Skipping a step is refused. This is the whole point of server-side enforcement: a client calling
  // endpoints out of order must not be able to shortcut review.
  t.ok(!checkTransition('draft', 'activate').allowed, 'cannot activate straight from draft');
  t.ok(!checkTransition('draft', 'approve').allowed, 'cannot approve an unreviewed tenant');
  t.ok(!checkTransition('under_review', 'activate').allowed, 'cannot activate from under_review');
  t.ok(!checkTransition('active', 'approve').allowed, 'cannot re-approve an active tenant');

  // Adverse outcomes need a reason.
  t.ok(!checkTransition('under_review', 'reject').allowed, 'reject without a reason is refused');
  t.ok(
    checkTransition('under_review', 'reject', { reason: 'failed KYC' }).allowed,
    'reject with a reason is allowed',
  );
  t.ok(
    !checkTransition('active', 'suspend', { reason: '   ' }).allowed,
    'a whitespace-only reason is not a reason',
  );
  t.ok(!checkTransition('active', 'restrict').allowed, 'restrict requires a reason');
  t.ok(
    !checkTransition('provisioning', 'fail_provisioning').allowed,
    'provisioning failure requires a reason',
  );

  // Provisioning is retryable without re-approval.
  t.ok(
    checkTransition('provisioning_failed', 'start_provisioning').allowed,
    'provisioning can be retried after failure',
  );

  // Suspension / restriction / reactivation.
  t.ok(checkTransition('active', 'suspend', { reason: 'non-payment' }).allowed, 'active -> suspended');
  t.ok(checkTransition('restricted', 'suspend', { reason: 'escalation' }).allowed, 'restricted -> suspended');
  t.equal(checkTransition('suspended', 'reactivate').to, 'active', 'suspended -> active');
  t.equal(checkTransition('restricted', 'reactivate').to, 'active', 'restricted -> active');
  t.ok(
    !checkTransition('suspended', 'restrict', { reason: 'x' }).allowed,
    'cannot restrict an already-suspended tenant',
  );

  // Terminal really is terminal — there is no reopen.
  t.ok(isTerminal('closed'), 'closed is terminal');
  t.ok(!isTerminal('suspended'), 'suspended is not terminal');
  for (const action of ['activate', 'reactivate', 'submit_review', 'approve'] as TenantAction[]) {
    t.ok(!checkTransition('closed', action, { reason: 'x' }).allowed, `closed tenant refuses ${action}`);
  }
  t.ok(
    !checkTransition('closed', 'close', { reason: 'again' }).allowed,
    'a closed tenant cannot be closed twice',
  );

  t.ok(!checkTransition('draft', 'not_an_action' as TenantAction).allowed, 'an unknown action is refused');

  // Every transition's target must be a real status, and every action must be reachable.
  for (const transition of TENANT_TRANSITIONS) {
    t.ok(isTenantStatus(transition.to), `${transition.action} targets a real status`);
    t.ok(transition.from.length > 0, `${transition.action} has at least one source status`);
  }

  // Status gates. `restricted` is read-only, not blocked.
  t.ok(allowsBusinessWrites('active'), 'active allows writes');
  t.ok(!allowsBusinessWrites('restricted'), 'restricted blocks writes');
  t.ok(allowsBusinessReads('restricted'), 'restricted still allows reads');
  t.ok(!allowsBusinessReads('suspended'), 'suspended blocks reads');
  t.ok(!allowsBusinessWrites('closed'), 'closed blocks writes');
  for (const status of TENANT_STATUSES) {
    if (allowsBusinessWrites(status))
      t.ok(allowsBusinessReads(status), `${status}: writable implies readable`);
  }

  // --- tenant types --------------------------------------------------------------------------------
  t.equal(TENANT_TYPES.length, 10, 'ten tenant types');
  t.ok(isTenantType('microfinance_institution'), 'known type accepted');
  t.ok(!isTenantType('bank_of_england'), 'unknown type rejected');

  // --- code / profile validation -------------------------------------------------------------------
  t.equal(validateTenantCode('aptic_credit'), null, 'a well-formed tenant code is accepted');
  t.ok(validateTenantCode('ab') !== null, 'a two-character code is too short');
  t.ok(validateTenantCode('Aptic') !== null, 'PascalCase is rejected');
  t.ok(validateTenantCode('1aptic') !== null, 'a code must start with a letter');
  t.ok(validateTenantCode('aptic-credit') !== null, 'kebab-case is rejected');
  t.ok(validateTenantCode('admin') !== null, 'a reserved code is rejected');
  t.ok(validateTenantCode('system') !== null, 'system is reserved');
  t.ok(validateTenantCode('a'.repeat(41)) !== null, 'an over-long code is rejected');

  t.equal(validateTimezone('Africa/Nairobi'), null, 'a real timezone is accepted');
  t.ok(
    validateTimezone('Africa/Nairobbi') !== null,
    'a misspelt timezone is rejected against the tz database',
  );
  t.ok(validateTimezone('EAT') !== null, 'an abbreviation is not an IANA name');
  t.equal(validateCurrency('KES'), null, 'ISO-4217 accepted');
  t.ok(validateCurrency('kes') !== null, 'lowercase currency rejected');
  t.ok(validateCurrency('KSH') === null, 'shape-checked, not membership-checked');
  t.equal(validateCountry('KE'), null, 'ISO-3166 alpha-2 accepted');
  t.ok(validateCountry('KEN') !== null, 'alpha-3 rejected');

  // --- organisational rules ------------------------------------------------------------------------
  t.equal(validateOrgCode('department', 'finance'), null, 'org code accepted');
  t.ok(validateOrgCode('department', 'F') !== null, 'single-character org code rejected');

  const now = new Date('2026-01-01T00:00:00Z');
  const later = new Date('2026-06-01T00:00:00Z');
  t.equal(validateEffectiveDates({ effectiveFrom: now, effectiveTo: later }), null, 'from < to is valid');
  t.equal(
    validateEffectiveDates({ effectiveFrom: now, effectiveTo: null }),
    null,
    'an open-ended period is valid',
  );
  t.ok(
    validateEffectiveDates({ effectiveFrom: later, effectiveTo: now }) !== null,
    'to before from is rejected',
  );
  t.ok(
    validateEffectiveDates({ effectiveFrom: now, effectiveTo: now }) !== null,
    'a zero-length period is rejected',
  );

  t.deepEqual(
    validateOrgNode({ kind: 'entity', code: 'sub_one', name: 'Sub One', effectiveFrom: now }),
    [],
    'a valid entity has no problems',
  );
  t.ok(
    validateOrgNode({ kind: 'branch', code: 'br_one', name: 'Branch', parentId: 'x', effectiveFrom: now })
      .length === 1,
    'a branch cannot have a parent branch',
  );
  t.ok(
    validateOrgNode({ kind: 'department', code: 'X', name: '', effectiveFrom: now }).length === 2,
    'every problem is reported, not just the first',
  );

  // Cycles — the check Postgres cannot express.
  t.ok(wouldCreateCycle('a', 'a', []), 'self-parenting is a cycle');
  t.ok(wouldCreateCycle('a', 'b', ['a']), 'A -> B -> A is a cycle');
  t.ok(!wouldCreateCycle('a', 'b', ['c']), 'an unrelated ancestor chain is not a cycle');
  t.ok(!wouldCreateCycle('a', null, []), 'a root node is not a cycle');

  t.equal(ENVIRONMENT_TYPES.length, 5, 'five environment types');
  t.deepEqual(
    validateEnvironment({ code: 'prod', environmentType: 'production', isDefault: true }),
    [],
    'valid environment',
  );
  t.ok(
    validateEnvironment({ code: 'prod', environmentType: 'staging', isDefault: false }).length === 1,
    'unknown environment type rejected',
  );

  // --- UUID guard ----------------------------------------------------------------------------------
  t.ok(UUID_PATTERN.test('7f1b3f6e-3a4b-4c2d-8e9f-0a1b2c3d4e5f'), 'a v4 uuid matches');
  t.ok(!UUID_PATTERN.test("' OR 1=1 --"), 'an injection attempt is not a uuid');
  t.ok(!UUID_PATTERN.test(''), 'an empty string is not a uuid');

  // --- the three axes stay in step -----------------------------------------------------------------
  const actions = Object.keys(TENANT_ACTION_MAP) as TenantAction[];
  for (const action of actions) {
    t.ok(TENANT_ACTION_PERMISSIONS[action] !== undefined, `${action} has a permission`);
    t.ok(
      TENANT_ACTION_MAP[action].auditCode.startsWith(TENANT_AUDIT_PREFIX),
      `${action} audit code carries the registered prefix`,
    );
    t.ok(
      TENANT_ACTION_PERMISSIONS[action].startsWith(TENANT_PERMISSION_NAMESPACE),
      `${action} permission is inside the registered namespace`,
    );
    t.ok(
      TENANT_LIFECYCLE_EVENT_TYPES.includes(TENANT_ACTION_MAP[action].eventType),
      `${action} maps to a declared event type`,
    );
  }
  // Every transition in the state machine has an entry in the action map — no orphan transitions.
  for (const transition of TENANT_TRANSITIONS) {
    t.ok(
      TENANT_ACTION_MAP[transition.action] !== undefined,
      `transition ${transition.action} is mapped to audit + event`,
    );
  }

  // --- permission and audit-code shape -------------------------------------------------------------
  // Every M01 permission must satisfy the kernel's own @Endpoint validator. This is the assertion that
  // catches the obvious-but-wrong `tenant.view`: two segments, rejected by the kernel at boot.
  for (const permission of ALL_TENANT_PERMISSIONS) {
    t.deepEqual(
      validateEndpointSpec({ permission, auditCode: 'TENANT_REGISTRY_CREATED' }),
      [],
      `permission ${permission} satisfies the kernel's @Endpoint validator`,
    );
    t.ok(
      permission.startsWith(TENANT_PERMISSION_NAMESPACE),
      `${permission} is inside the registered tenant.* namespace`,
    );
  }
  for (const code of ALL_TENANT_AUDIT_CODES) {
    t.deepEqual(
      validateEndpointSpec({ permission: 'tenant.registry.view', auditCode: code }),
      [],
      `audit code ${code} satisfies the kernel's @Endpoint validator`,
    );
    // The registry's format is <PREFIX>_<ENTITY>_<ACTION> — at least three segments.
    t.ok(code.split('_').length >= 3, `${code} matches <PREFIX>_<ENTITY>_<ACTION>`);
  }

  // --- registry conformance ------------------------------------------------------------------------
  // "Unregistered codes fail CI" (ADR-005). The platform-wide conformance tool does not exist yet, so
  // M01 enforces it for M01: if a code here is missing from the registry, this suite goes red.
  const auditRegistry = readYaml('manifests/audit-code-registry.yaml') as {
    codes?: { code: string; module?: string }[];
    registered_code_count?: number;
  };
  const registeredCodes = new Set((auditRegistry.codes ?? []).map((c) => c.code));
  for (const code of ALL_TENANT_AUDIT_CODES) {
    t.ok(registeredCodes.has(code), `audit code ${code} is registered in audit-code-registry.yaml`);
  }
  t.equal(
    auditRegistry.registered_code_count,
    (auditRegistry.codes ?? []).length,
    'audit-code-registry: registered_code_count matches the number of codes',
  );

  const permissionRegistry = readYaml('manifests/permission-registry.yaml') as {
    namespaces?: { namespace: string; module?: string }[];
  };
  const tenantNamespace = (permissionRegistry.namespaces ?? []).find((n) => n.module === 'm01-tenant');
  t.ok(tenantNamespace !== undefined, 'm01-tenant has a registered permission namespace');
  t.equal(tenantNamespace?.namespace, 'tenant.*', 'the registered namespace is tenant.*');

  // The event family must be declared in the union AND registered — naming-map flagged GAP-1 precisely
  // because the manifest claimed a family the event registry had never heard of.
  t.ok(DOMAIN_EVENT_FAMILIES.includes(TENANT_LIFECYCLE_FAMILY), 'tenant.lifecycle is in the contracts union');
  t.equal(DOMAIN_EVENT_FAMILIES.length, 1, 'exactly one family is declared at Stage 1A');
  const eventRegistry = readYaml('manifests/event-registry.yaml') as {
    family_groups?: { families: string[] }[];
  };
  const registeredFamilies = new Set((eventRegistry.family_groups ?? []).flatMap((g) => g.families));
  t.ok(
    registeredFamilies.has(TENANT_LIFECYCLE_FAMILY),
    'tenant.lifecycle is registered in event-registry.yaml (GAP-1 closed)',
  );

  const namingMap = readYaml('manifests/naming-map.yaml') as {
    modules?: { module: string; event_family_registered?: boolean }[];
  };
  const m01 = (namingMap.modules ?? []).find((m) => m.module === 'm01-tenant');
  t.equal(m01?.event_family_registered, true, 'naming-map records tenant.lifecycle as registered');
});
