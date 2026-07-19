import { defineSuite } from '@finapp/test-runner';
import { ProblemError, type RequestContext, type SystemContext } from '@finapp/kernel';
import {
  ROLE_STATUSES,
  ROLE_TERMINAL,
  isRoleStatus,
  checkRoleTransition,
  roleGrantsPermissions,
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_TERMINAL,
  isAssignmentStatus,
  checkAssignmentTransition,
  assignmentIsEffective,
  SCOPE_LEVELS,
  isScopeLevel,
  assignmentScopeContains,
  parseScope,
  RBAC_PERMISSIONS,
  ALL_RBAC_PERMISSIONS,
  RBAC_PERMISSION_NAMESPACE,
  RBAC_AUDIT_CODES,
  ALL_RBAC_AUDIT_CODES,
  RBAC_AUDIT_PREFIX,
  RbacAuthz,
} from '@finapp/m02-rbac';

/**
 * m02-rbac PURE smoke suite — the domain the whole stage rests on, exercised with no database: the role and
 * assignment state machines, the scope-containment algebra, the registered permission/audit vocabularies,
 * and the set-check authorizer. Persistence, RLS and the API are proven in the DB specs; this proves the
 * decisions those layers merely carry out, and it fails CLOSED at every ambiguous edge.
 */
export default defineSuite('m02-rbac', async (t) => {
  // --- role state machine --------------------------------------------------------------------------
  t.deepEqual([...ROLE_STATUSES], ['draft', 'active', 'suspended', 'retired'], 'the role statuses are the four ADR-017 states');
  t.ok(isRoleStatus('active') && !isRoleStatus('paused'), 'isRoleStatus admits only real statuses');

  t.equal(checkRoleTransition('draft', 'activate').to, 'active', 'draft -> activate -> active');
  t.ok(!checkRoleTransition('draft', 'activate').reason, 'activate needs no reason');
  t.ok(!checkRoleTransition('active', 'suspend').allowed || checkRoleTransition('active', 'suspend', { reason: 'x' }).allowed, 'suspend needs a reason');
  t.ok(!checkRoleTransition('active', 'suspend').allowed, 'suspend without a reason is refused');
  t.equal(checkRoleTransition('active', 'suspend', { reason: 'policy' }).to, 'suspended', 'active + reason -> suspended');
  t.equal(checkRoleTransition('suspended', 'reactivate').to, 'active', 'suspended -> reactivate -> active');
  t.equal(checkRoleTransition('active', 'retire', { reason: 'eol' }).to, 'retired', 'active -> retire -> retired');
  t.ok(!checkRoleTransition('active', 'reactivate').allowed, 'active -> reactivate is not a legal transition');
  t.ok(!checkRoleTransition('retired', 'activate').allowed, 'a retired role is terminal — nothing reopens it');
  t.deepEqual([...ROLE_TERMINAL], ['retired'], 'retired is the only terminal role status');

  t.ok(roleGrantsPermissions('active'), 'only an ACTIVE role grants its permissions');
  t.ok(!roleGrantsPermissions('draft') && !roleGrantsPermissions('suspended') && !roleGrantsPermissions('retired'), 'a draft/suspended/retired role grants nothing (fail closed)');

  // --- assignment state machine --------------------------------------------------------------------
  t.deepEqual([...ASSIGNMENT_STATUSES], ['active', 'suspended', 'revoked', 'expired'], 'the assignment statuses');
  t.ok(isAssignmentStatus('revoked') && !isAssignmentStatus('deleted'), 'isAssignmentStatus admits only real statuses');
  t.equal(checkAssignmentTransition('active', 'suspend', { reason: 'leave' }).to, 'suspended', 'active -> suspend -> suspended');
  t.equal(checkAssignmentTransition('active', 'revoke', { reason: 'offboard' }).to, 'revoked', 'active -> revoke -> revoked');
  t.ok(!checkAssignmentTransition('active', 'revoke').allowed, 'revoke without a reason is refused');
  t.ok(!checkAssignmentTransition('revoked', 'reactivate').allowed, 'a revoked assignment is terminal');
  t.deepEqual([...ASSIGNMENT_TERMINAL], ['revoked', 'expired'], 'revoked and expired are terminal');

  // --- assignment effectiveness (status AND window) ------------------------------------------------
  const now = 1_000_000;
  t.ok(assignmentIsEffective('active', now, null, null), 'active with no window is effective');
  t.ok(!assignmentIsEffective('suspended', now, null, null), 'a suspended assignment is never effective');
  t.ok(!assignmentIsEffective('active', now, now + 1, null), 'a not-yet-effective assignment yields nothing');
  t.ok(!assignmentIsEffective('active', now, null, now), 'an assignment at its exact expiry yields nothing (half-open)');
  t.ok(assignmentIsEffective('active', now, now, now + 1), 'effective_from is inclusive, expires_at exclusive');

  // --- scope algebra ---------------------------------------------------------------------------------
  t.deepEqual([...SCOPE_LEVELS], ['platform', 'tenant', 'entity', 'branch', 'department'], 'the MVP scope levels');
  t.ok(isScopeLevel('branch') && !isScopeLevel('galaxy'), 'isScopeLevel admits only real levels');

  t.ok(assignmentScopeContains({ level: 'platform', ref: null }, { level: 'department', ref: 'n1' }), 'platform contains everything');
  t.ok(assignmentScopeContains({ level: 'tenant', ref: null }, { level: 'branch', ref: 'n1' }), 'a tenant-wide assignment contains any in-tenant scope');
  t.ok(assignmentScopeContains({ level: 'entity', ref: 'n1' }, { level: 'entity', ref: 'n1' }), 'an org assignment contains its exact node');
  t.ok(!assignmentScopeContains({ level: 'entity', ref: 'n1' }, { level: 'entity', ref: 'n2' }), 'but not a different node (default deny)');
  t.ok(!assignmentScopeContains({ level: 'entity', ref: 'n1' }, { level: 'branch', ref: 'n1' }), 'nor a different level with the same ref');

  t.equal(parseScope('tenant', null)?.level, 'tenant', 'a tenant scope with no ref parses');
  t.equal(parseScope('unknown', null), null, 'an unrecognised level fails closed to null');
  t.equal(parseScope('tenant', 'n1'), null, 'a tenant scope carrying a ref is rejected');
  t.equal(parseScope('entity', null), null, 'an org scope missing its ref is rejected');
  t.equal(parseScope('entity', 'n1')?.ref, 'n1', 'an org scope with a ref parses');

  // --- registered vocabularies ---------------------------------------------------------------------
  for (const code of ALL_RBAC_PERMISSIONS) {
    t.ok(code.startsWith(RBAC_PERMISSION_NAMESPACE), `${code} is inside the rbac.* namespace`);
    t.equal(code.split('.').length, 3, `${code} has three segments (the @Endpoint rule)`);
  }
  t.equal(ALL_RBAC_PERMISSIONS.length, Object.keys(RBAC_PERMISSIONS).length, 'every declared permission is exported once');
  t.equal(new Set(ALL_RBAC_PERMISSIONS).size, ALL_RBAC_PERMISSIONS.length, 'no duplicate permission codes');

  for (const code of ALL_RBAC_AUDIT_CODES) {
    t.ok(code.startsWith(RBAC_AUDIT_PREFIX), `${code} carries the RBAC_ prefix`);
    t.ok(code.split('_').length >= 3, `${code} matches <PREFIX>_<ENTITY>_<ACTION>`);
  }
  t.equal(new Set(ALL_RBAC_AUDIT_CODES).size, Object.keys(RBAC_AUDIT_CODES).length, 'no duplicate audit codes');

  // --- the set-check authorizer (default deny) -----------------------------------------------------
  const authz = new RbacAuthz();
  const tenantCtx: RequestContext = { tenantId: 't1', userId: 'u1', correlationId: 'c1', permissions: ['rbac.role.view'] };
  const emptyCtx: RequestContext = { tenantId: 't1', userId: 'u1', correlationId: 'c2', permissions: [] };
  const sysCtx: SystemContext & { permissions: readonly string[] } = { reason: 'x', correlationId: 'c3', permissions: ['rbac.sod.manage'] };
  const bareSys: SystemContext = { reason: 'y', correlationId: 'c4' };

  t.ok(await authz.can(tenantCtx, 'rbac.role.view'), 'can() is true for a held permission');
  t.ok(!(await authz.can(tenantCtx, 'rbac.role.create')), 'can() is false for one not held (default deny)');
  t.ok(!(await authz.can(emptyCtx, 'rbac.role.view')), 'an empty set grants nothing');
  t.ok(await authz.can(sysCtx, 'rbac.sod.manage'), 'a system context answers from the permissions it carries');
  t.ok(!(await authz.can(bareSys, 'rbac.sod.manage')), 'a system context with NO permissions is not a universal allow');
  await authz.require(tenantCtx, 'rbac.role.view');
  await t.rejects(authz.require(tenantCtx, 'rbac.role.create'), 'require() rejects a missing permission');
  let forbidden = false;
  try {
    await authz.require(emptyCtx, 'rbac.role.view');
  } catch (e: unknown) {
    forbidden = e instanceof ProblemError && e.status === 403;
  }
  t.ok(forbidden, 'require() throws a 403 ProblemError, never a bare Error');
});
