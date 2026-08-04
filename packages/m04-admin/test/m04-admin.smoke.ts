import { defineSuite } from '@finapp/test-runner';
import * as m04 from '../src/index.ts';
import {
  M04_PERMISSIONS,
  ALL_M04_PERMISSIONS,
  M04_PRIVILEGED_PERMISSIONS,
  M04_PLATFORM_PERMISSIONS,
  isPlatformPermission,
  ALL_M04_AUDIT_CODES,
  ADMIN_AUDIT_PREFIX,
  ADMIN_SCOPES,
  isAdminScope,
  scopeOfPermission,
  OPERATION_TYPES,
  isOperationType,
  OPERATION_STATUSES,
  checkOperationTransition,
  isOperationTerminal,
  REASON_CODES,
  ALL_REASON_CODES,
  SAVED_VIEW_AREAS,
  isSavedViewArea,
  clampPage,
  M04_LIMITS,
} from '../src/index.ts';

export default defineSuite('m04-admin', (t) => {
  // --- permissions: three-segment, classified, no vague bypass ----------------------------------
  t.equal(ALL_M04_PERMISSIONS.length, 30, 'm04 declares 30 admin.* permissions');
  t.equal(M04_PRIVILEGED_PERMISSIONS.length, 17, 'm04 has 17 privileged permissions');
  t.equal(M04_PLATFORM_PERMISSIONS.length, 2, 'm04 has 2 platform (control-plane) permissions');
  t.ok(
    ALL_M04_PERMISSIONS.every((p) => p.startsWith('admin.') && p.split('.').length === 3),
    'every permission is a 3-segment admin.* code (the @Endpoint rule)',
  );
  const permList: readonly string[] = ALL_M04_PERMISSIONS;
  t.ok(
    !permList.includes('admin.admin') && !permList.includes('admin.all.access'),
    'there is no vague admin bypass',
  );
  t.ok(new Set(ALL_M04_PERMISSIONS).size === ALL_M04_PERMISSIONS.length, 'no permission is declared twice');

  // --- platform vs tenant classification (the boundary M04 certifies) ---------------------------
  t.equal(ADMIN_SCOPES.length, 2, 'two admin scopes (tenant, platform)');
  t.ok(isAdminScope('platform') && !isAdminScope('galaxy'), 'admin scope recognized');
  t.equal(
    scopeOfPermission(M04_PERMISSIONS.tenantSuspend),
    'tenant',
    'admin.tenant.suspend is tenant-scoped',
  );
  t.equal(
    scopeOfPermission(M04_PERMISSIONS.platformAdminister),
    'platform',
    'admin.platform.administer is platform-scoped',
  );
  t.equal(
    scopeOfPermission(M04_PERMISSIONS.platformAuditRead),
    'platform',
    'admin.platform_audit.read is platform-scoped',
  );
  t.ok(
    isPlatformPermission('admin.platform.administer') && !isPlatformPermission('admin.tenant.read'),
    'platform permission detection',
  );
  // every platform permission is also privileged (control-plane is never unprivileged)
  const priv: readonly string[] = M04_PRIVILEGED_PERMISSIONS;
  t.ok(
    M04_PLATFORM_PERMISSIONS.every((p) => priv.includes(p)),
    'every platform permission is privileged',
  );
  // a tenant read permission is NOT privileged and NOT platform
  t.ok(
    !priv.includes(M04_PERMISSIONS.tenantRead) && scopeOfPermission(M04_PERMISSIONS.tenantRead) === 'tenant',
    'tenant.read is an unprivileged tenant permission',
  );

  // --- admin operation lifecycle ----------------------------------------------------------------
  t.equal(OPERATION_TYPES.length, 15, 'fifteen orchestrated operation types');
  t.ok(
    isOperationType('tenant_suspend') && !isOperationType('delete_everything'),
    'operation type recognized',
  );
  t.equal(OPERATION_STATUSES.length, 5, 'five operation statuses');
  t.ok(checkOperationTransition('requested', 'executing').ok, 'requested -> executing');
  t.ok(checkOperationTransition('executing', 'completed').ok, 'executing -> completed');
  t.ok(checkOperationTransition('executing', 'failed').ok, 'executing -> failed');
  t.ok(checkOperationTransition('requested', 'cancelled').ok, 'requested -> cancelled');
  t.ok(
    !checkOperationTransition('requested', 'completed').ok,
    'an operation cannot complete without executing',
  );
  t.ok(!checkOperationTransition('completed', 'executing').ok, 'a completed operation is terminal');
  t.ok(
    isOperationTerminal('completed') && isOperationTerminal('failed') && isOperationTerminal('cancelled'),
    'completed/failed/cancelled are terminal',
  );

  // --- reason codes -----------------------------------------------------------------------------
  const reasons: readonly string[] = ALL_REASON_CODES;
  t.ok(
    reasons.includes('cross_tenant_denied') &&
      reasons.includes('immutable_system_role') &&
      reasons.includes('platform_role_denied'),
    'platform-vs-tenant reason codes present',
  );
  t.equal(
    REASON_CODES.platformScopeRequired,
    'platform_scope_required',
    'platform_scope_required reason code',
  );

  // --- saved view areas -------------------------------------------------------------------------
  t.equal(SAVED_VIEW_AREAS.length, 9, 'nine admin console areas');
  t.ok(isSavedViewArea('audit') && !isSavedViewArea('nonsense'), 'saved view area recognized');

  // --- bounded pagination (dashboards/lists never unbounded) ------------------------------------
  t.equal(clampPage(undefined, undefined).limit, M04_LIMITS.defaultPageSize, 'default page size when unset');
  t.equal(clampPage(100000, 0).limit, M04_LIMITS.maxPageSize, 'page size clamped to the max');
  t.equal(clampPage(10, -5).offset, 0, 'a negative offset clamps to 0');
  t.equal(clampPage(0, 0).limit, 1, 'a zero limit clamps to at least 1');

  // --- audit codes ------------------------------------------------------------------------------
  t.equal(ALL_M04_AUDIT_CODES.length, 29, 'm04 declares 29 audit codes');
  t.ok(
    ALL_M04_AUDIT_CODES.every((c) => c.startsWith(ADMIN_AUDIT_PREFIX) && c.split('_').length >= 3),
    'every audit code is ADMIN_ SCREAMING_SNAKE with >= 3 segments',
  );
  t.ok(new Set(ALL_M04_AUDIT_CODES).size === ALL_M04_AUDIT_CODES.length, 'no audit code is declared twice');
  const codeList: readonly string[] = ALL_M04_AUDIT_CODES;
  t.ok(
    codeList.includes('ADMIN_PLATFORM_AUDIT_ACCESSED') && codeList.includes('ADMIN_AUDIT_EXPORTED'),
    'sensitive reads (platform audit, export) are auditable — no privileged read is silent',
  );

  // --- no event family invention ----------------------------------------------------------------
  // M04 owns NO event family: its public surface exposes no *LIFECYCLE / *EVENT_TYPES / *Emitter export, because it
  // publishes no events and owns no outbox — delegated operations reuse the OWNING modules' existing events.
  const eventish = Object.keys(m04).filter((k) => /LIFECYCLE|EVENT_TYPES|Emitter|Outbox/i.test(k));
  t.deepEqual(
    eventish,
    [],
    'm04 exposes no event-family / emitter / outbox surface (orchestration reuses module events)',
  );
});
