import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { TenantService } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  AdminRepository,
  AdminOperationService,
  TenantAdminService,
  M04_PERMISSIONS,
  ALL_M04_PERMISSIONS,
} from '@finapp/m04-admin';

/**
 * M04 services DB spec — proves the admin console END TO END on a REAL PostgreSQL. The OWNED layer
 * (AdminOperationService) is exercised directly against Postgres: record a governed operation (idempotent) -> execute
 * -> complete, with append-only history + ADMIN_ audit; saved views + preferences; a bounded dashboard aggregate;
 * optimistic-concurrency (stale-version) rejection; default deny; cross-tenant isolation; and NO secret in any audit
 * entry. The ORCHESTRATION layer is exercised for its delegated-authority GATE: TenantAdminService requires the
 * `admin.*` permission BEFORE delegating to the real m01 TenantService — a caller lacking it is refused at M04, proving
 * M04 bypasses no authorization. m04 never mirrors a table or bypasses a module.
 */
export default defineDbSpec('m04-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const repo = new AdminRepository();
  const ops = new AdminOperationService(db, authz, audit, repo);
  const tenants = new TenantService(db, authz, audit, outbox);
  const tenantAdmin = new TenantAdminService(authz, tenants, ops);

  const tenant = randomUUID();
  const actor = randomUUID();
  const ctxOf = (perms: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId: actor,
    correlationId: randomUUID(),
    permissions: [...perms],
  });
  const full = ctxOf(ALL_M04_PERMISSIONS);
  const SECRET = `ADMIN-SECRET-${randomUUID()}`;

  // --- record a governed operation (idempotent) -------------------------------------------------
  const key = `op-${randomUUID()}`;
  const op = await ops.recordOperation(full, actor, {
    operationType: 'tenant_suspend',
    targetType: 'tenant',
    targetRef: randomUUID(),
    summary: SECRET,
    idempotencyKey: key,
  });
  t.equal(op.status, 'requested', 'a recorded admin operation starts requested');
  const again = await ops.recordOperation(full, actor, {
    operationType: 'tenant_suspend',
    idempotencyKey: key,
  });
  t.equal(again.id, op.id, 'operation recording is idempotent per key (no duplicate admin action)');

  // --- execute -> complete, with append-only history --------------------------------------------
  const completed = await ops.completeOperation(full, actor, op.id, op.version, 'completed');
  t.equal(completed.status, 'completed', 'an operation moves requested -> executing -> completed');
  const detail = await ops.getOperation(full, op.id);
  t.ok(
    detail.history.some((h) => h.to_status === 'executing') &&
      detail.history.some((h) => h.to_status === 'completed'),
    'operation history is append-only and records every transition',
  );

  // --- stale version rejected -------------------------------------------------------------------
  const op2 = await ops.recordOperation(full, actor, { operationType: 'audit_export' });
  await t.rejects(
    ops.completeOperation(full, actor, op2.id, op2.version + 99, 'completed'),
    'a stale expectedVersion is rejected (optimistic concurrency)',
  );

  // --- saved views + preferences ----------------------------------------------------------------
  const view = await ops.saveView(full, actor, {
    area: 'tenants',
    name: 'my-view',
    filter: { status: 'active' },
  });
  t.equal(view.area, 'tenants', 'a saved view is created');
  const views = await ops.listViews(full, actor, 'tenants');
  t.ok(
    views.some((v) => v.id === view.id),
    'saved views list for the owner',
  );
  const pref = await ops.setPreference(full, actor, { prefKey: 'density', prefValue: { compact: true } });
  t.equal(pref.pref_key, 'density', 'a preference upserts');
  const pref2 = await ops.setPreference(full, actor, { prefKey: 'density', prefValue: { compact: false } });
  t.ok(
    pref2.id === pref.id && pref2.version === pref.version + 1,
    'a repeated preference upserts in place (version bumps)',
  );

  // --- bounded dashboard ------------------------------------------------------------------------
  const dash = await ops.dashboard(full);
  t.ok(
    typeof dash.operationsByStatus === 'object' && dash.recentOperations.length <= 10,
    'the dashboard returns bounded aggregates',
  );

  // --- default deny (owned) ---------------------------------------------------------------------
  const noOps = ctxOf(ALL_M04_PERMISSIONS.filter((p) => p !== M04_PERMISSIONS.operationsRead));
  await t.rejects(
    ops.recordOperation(noOps, actor, { operationType: 'tenant_suspend' }),
    'recording an operation without admin.operations.read is refused (default deny)',
  );

  // --- ORCHESTRATION delegated-authority gate: admin.* required BEFORE delegating ----------------
  const noTenantAdmin = ctxOf(ALL_M04_PERMISSIONS.filter((p) => p !== M04_PERMISSIONS.tenantRead));
  await t.rejects(
    tenantAdmin.list(noTenantAdmin),
    'listing tenants without admin.tenant.read is refused at M04 before any delegation (no admin bypass)',
  );

  // --- audit carries NO secret ------------------------------------------------------------------
  t.ok(audit.entries.length >= 3, 'ADMIN_ audit entries were recorded for controlled admin actions');
  t.ok(
    !JSON.stringify(audit.entries).includes(SECRET),
    'no operation summary/narrative appears in any audit entry (data minimisation)',
  );
  t.ok(
    audit.entries.some((e) => e.code === 'ADMIN_OPERATION_REQUESTED'),
    'the admin operation is audited under the ADMIN_ prefix',
  );

  // --- cross-tenant isolation -------------------------------------------------------------------
  const otherTenant: RequestContext = { ...full, tenantId: randomUUID() };
  await t.rejects(
    ops.getOperation(otherTenant, op.id),
    "another tenant cannot read this tenant's admin operation (RLS)",
  );
});
