import { randomUUID } from 'node:crypto';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { type RequestContext, type SystemContext } from '@finapp/kernel';
import { PgDb } from '@finapp/kernel/pg';
import { AuditRepository, AuditService, verifyChain } from '@finapp/m03-audit';

/**
 * m03-audit AGAINST A REAL DATABASE — the guarantees only PostgreSQL can prove, exercised through the REAL
 * AuditService and repository as the NON-SUPERUSER application role: events persist and read back, a
 * tenant's evidence never leaks to another tenant, PLATFORM events are invisible under tenant context, the
 * actor is taken from the trusted context (there is no client channel to spoof it), sensitive detail is
 * redacted before it is stored, the chain verifies, and the spine is APPEND-ONLY — update and delete are
 * rejected even for a superuser.
 */

async function seedTenant(ctx: DbSpecContext, code: string): Promise<string> {
  const tenantId = randomUUID();
  await ctx.asSuperuser(null, (tx) =>
    tx.query(
      `INSERT INTO tenants (id, code, legal_name, tenant_type, status, activated_at)
       VALUES ($1, $2, $3, 'enterprise_customer', 'active', now())`,
      [tenantId, `${code}_${tenantId.slice(0, 8)}`, `${code} Ltd`],
    ),
  );
  return tenantId;
}

export default defineDbSpec('m03-audit', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const audit = new AuditService(db);
  const repo = new AuditRepository();

  const tenantA = await seedTenant(ctx, 'audita');
  const tenantB = await seedTenant(ctx, 'auditb');
  const identity = randomUUID();
  const ctxA: RequestContext = {
    tenantId: tenantA,
    userId: identity,
    correlationId: randomUUID(),
    permissions: [],
  };
  const ctxB: RequestContext = {
    tenantId: tenantB,
    userId: randomUUID(),
    correlationId: randomUUID(),
    permissions: [],
  };
  const sys: SystemContext = { reason: 'platform op (spec)', correlationId: randomUUID() };

  // --- persistence + actor-from-context ------------------------------------------------------------
  {
    await audit.recordSuccess(ctxA, {
      code: 'TENANT_REGISTRY_CREATED',
      resourceType: 'tenant',
      resourceId: tenantA,
    });
    const rows = await db.withTenant(ctxA, (tx) => repo.search(tx, { limit: 10, offset: 0 }));
    t.equal(rows.length, 1, 'the event persisted and reads back in its tenant');
    const row = rows[0];
    t.equal(row?.tenant_id, tenantA, 'scoped to the acting tenant');
    t.equal(
      row?.actor_id,
      identity,
      'the actor is the AUTHENTICATED identity from context — not a client claim',
    );
    t.equal(row?.actor_type, 'user', 'a request context records a user actor');
    t.equal(row?.module, 'm01-tenant', 'the module is derived from the audit code prefix');
    t.equal(row?.outcome, 'success', 'a recordSuccess is a success outcome');
    t.equal(row?.event_hash.length, 64, 'a sha-256 event hash was computed server-side');
    t.ok(row?.occurred_at instanceof Date, 'the timestamp is server-generated');
  }

  // --- tenant isolation ----------------------------------------------------------------------------
  {
    const inB = await db.withTenant(ctxB, (tx) => repo.search(tx, { limit: 10, offset: 0 }));
    t.equal(inB.length, 0, "another tenant sees NONE of tenant A's audit events (RLS)");
  }

  // --- platform-event separation -------------------------------------------------------------------
  {
    await audit.recordSuccess(sys, {
      code: 'AUDIT_RETENTION_EXECUTED',
      resourceType: 'retention',
      resourceId: 'run1',
    });
    const tenantView = await db.withTenant(ctxA, (tx) => repo.search(tx, { limit: 50, offset: 0 }));
    t.ok(
      tenantView.every((r) => r.tenant_id === tenantA),
      'a tenant admin never sees PLATFORM events',
    );
    const platformView = await db.withSystem(sys, (tx) =>
      repo.search(tx, { limit: 50, offset: 0, platform: true }),
    );
    t.ok(
      platformView.some((r) => r.action === 'AUDIT_RETENTION_EXECUTED' && r.tenant_id === null),
      'the platform event is visible under the system escape',
    );
    t.equal(
      platformView.find((r) => r.action === 'AUDIT_RETENTION_EXECUTED')?.actor_type,
      'system_process',
      'a system context records a system_process actor with no user id',
    );
  }

  // --- redaction: nothing sensitive is stored ------------------------------------------------------
  {
    await audit.recordSuccess(ctxA, {
      code: 'AUTH_CREDENTIAL_VERIFIED',
      resourceType: 'credential',
      resourceId: 'cred1',
      detail: { password: 'hunter2', token: 'abc', note: 'ok' },
    });
    const rows = await db.withTenant(ctxA, (tx) =>
      repo.search(tx, { action: 'AUTH_CREDENTIAL_VERIFIED', limit: 1, offset: 0 }),
    );
    const after = rows[0]?.after_snapshot ?? {};
    t.equal(after['password'], '[REDACTED]', 'a secret in detail is masked before storage');
    t.equal(after['token'], '[REDACTED]', 'a token in detail is masked before storage');
    t.equal(after['note'], 'ok', 'non-secret detail survives');
  }

  // --- failure + authorization-decision recording --------------------------------------------------
  {
    await audit.recordFailure(ctxA, {
      code: 'TENANT_REGISTRY_UPDATED',
      resourceType: 'tenant',
      resourceId: tenantA,
      reason: 'version conflict',
    });
    await audit.recordAuthorizationDecision(ctxA, {
      code: 'RBAC_ROLE_CREATED',
      permission: 'rbac.role.create',
      resourceType: 'role',
      resourceId: 'r1',
      reason: 'missing permission',
    });
    const rows = await db.withTenant(ctxA, (tx) => repo.search(tx, { limit: 50, offset: 0 }));
    t.ok(
      rows.some((r) => r.outcome === 'failure'),
      'a failed action is recorded with a failure outcome',
    );
    const denied = rows.find((r) => r.outcome === 'denied');
    t.ok(denied !== undefined, 'an authorization denial is recorded');
    t.equal(denied?.category, 'authorization', 'and categorised as authorization');
  }

  // --- hash chain verifies over the real stored chain ----------------------------------------------
  {
    const chain = await db.withTenant(ctxA, (tx) => repo.scopeChain(tx, tenantA));
    t.ok(chain.length >= 3, 'tenant A has a multi-event chain');
    const result = verifyChain(chain.map((r) => AuditService.hashableOf(r)));
    t.ok(result.ok, 'the persisted chain verifies end to end (no tamper)');
  }

  // --- append-only: update and delete are rejected -------------------------------------------------
  {
    // As the application role: no UPDATE/DELETE privilege was ever granted.
    const noUpdatePriv = await refused(() =>
      db.withTenant(ctxA, (tx) =>
        tx.query(`UPDATE audit_events SET summary = 'tampered' WHERE tenant_id = $1`, [tenantA]),
      ),
    );
    t.ok(noUpdatePriv, 'the application role cannot UPDATE audit events (no privilege)');
    const noDeletePriv = await refused(() =>
      db.withTenant(ctxA, (tx) => tx.query(`DELETE FROM audit_events WHERE tenant_id = $1`, [tenantA])),
    );
    t.ok(noDeletePriv, 'the application role cannot DELETE audit events (no privilege)');

    // As the SUPERUSER (bypasses RLS and privilege): the triggers still reject — append-only binds everyone.
    const triggerBlocksUpdate = await refused(() =>
      ctx.asSuperuser(null, (tx) =>
        tx.query(`UPDATE audit_events SET summary = 'tampered' WHERE tenant_id = $1`, [tenantA]),
      ),
    );
    t.ok(triggerBlocksUpdate, 'even a superuser UPDATE is rejected by the append-only trigger');
    const triggerBlocksDelete = await refused(() =>
      ctx.asSuperuser(null, (tx) => tx.query(`DELETE FROM audit_events WHERE tenant_id = $1`, [tenantA])),
    );
    t.ok(triggerBlocksDelete, 'even a superuser DELETE is rejected by the append-only trigger');
  }
});

/** True if the thunk rejects (each attempt in its own transaction, since Postgres aborts a tx on error). */
async function refused(thunk: () => Promise<unknown>): Promise<boolean> {
  try {
    await thunk();
    return false;
  } catch {
    return true;
  }
}
