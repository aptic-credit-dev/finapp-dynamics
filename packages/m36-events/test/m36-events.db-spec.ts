import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M36 Webhooks & Event Streaming DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the
 * guarantees across the 9 webhook_, eventstream_ and events_ tables: RLS ENABLE+FORCE + tenant_isolation everywhere; tenant
 * isolation holds; NO DELETE and INSERT+SELECT only on the 5 append-only ledgers; NO float (a cursor position is bigint);
 * ZERO secret VALUE columns (a signing secret is an opaque secretref: pointer). THE INVARIANTS ARE DB-ENFORCED: an approved
 * endpoint's url/key is IMMUTABLE (trigger); an endpoint cannot be activated without a passing validation (evidence_ck); a
 * signing secret must match the secretref: shape; delivery is idempotent (one 'delivered' per endpoint per event); a review
 * DECISION needs a decider and decided_by <> requested_by (SoD); one active endpoint per key; the events.* permissions are
 * seeded; a single outbox (m06 — m36 owns none); PostgreSQL 16.
 */
const M36_TABLES = [
  'webhook_endpoint',
  'webhook_subscription',
  'webhook_delivery',
  'webhook_review',
  'eventstream_config',
  'eventstream_cursor',
  'eventstream_subscription',
  'events_history',
  'events_idempotency',
];
const APPEND_ONLY = [
  'webhook_delivery',
  'webhook_review',
  'eventstream_subscription',
  'events_history',
  'events_idempotency',
];

export default defineDbSpec('m36-events', async (ctx, t) => {
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M36_TABLES],
    );
    t.equal(r.rows.length, M36_TABLES.length, 'all 9 events tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M36_TABLES],
    );
    t.equal(p.rows.length, M36_TABLES.length, 'every events table has a tenant_isolation policy');
  });

  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND (table_name LIKE 'webhook_%' OR table_name LIKE 'eventstream_%' OR table_name LIKE 'events_%')`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any events table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the five append-only ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE (table_name LIKE 'webhook_%' OR table_name LIKE 'eventstream_%' OR table_name LIKE 'events_%') AND data_type IN ('real','double precision')`,
    );
    t.equal(floats.rows[0]?.c, '0', 'no events column uses a binary float (cursor position is bigint)');
    const secrets = await tx.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE (table_name LIKE 'webhook_%' OR table_name LIKE 'eventstream_%' OR table_name LIKE 'events_%')
         AND column_name ~ '(password|passphrase|api[_]?key|access_token|auth_token|private_key|secret_value|credential|secret_material)'
         AND column_name !~ '(_id|_ref|_hash)$'`,
    );
    t.equal(
      secrets.rows.length,
      0,
      'ZERO secret VALUE column (a signing secret is an opaque secretref pointer)',
    );
    const immut = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM pg_trigger WHERE tgrelid::regclass::text = 'webhook_endpoint' AND NOT tgisinternal`,
    );
    t.equal(immut.rows[0]?.c, '1', 'one endpoint-immutability trigger (webhook_endpoint)');
  });

  await ctx.asSuperuser(null, async (tx) => {
    const perms = await tx.query<{ code: string; privileged: boolean }>(
      `SELECT code, privileged FROM permissions WHERE module='m36-events' ORDER BY code`,
    );
    t.equal(perms.rows.length, 8, 'eight events.* permissions are seeded');
    t.ok(
      perms.rows.every((p) => p.code.startsWith('events.') && p.code.split('.').length === 3),
      'all seeded codes are 3-segment events.*',
    );
    t.ok(
      perms.rows.find((p) => p.code === 'events.webhook.approve')?.privileged === true,
      'endpoint approval is privileged',
    );
    const outboxes = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%outbox%'`,
    );
    t.ok(
      outboxes.rows.length === 1 && outboxes.rows[0]?.table_name === 'workflow_event_outbox',
      'exactly one outbox (m06) — m36 owns none',
    );
  });

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const requester = randomUUID();

  let endpointId = '';
  let streamId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const e = await tx.query<{ id: string }>(
      `INSERT INTO webhook_endpoint (tenant_id, scope, endpoint_key, url, signing_secret_ref, state, validation_passed, correlation_id, created_by)
       VALUES ($1,'tenant','ep1','https://hooks.example.com/x','secretref:vault/kv/wh','active',true,$2,$3) RETURNING id`,
      [tenantA, randomUUID(), requester],
    );
    endpointId = e.rows[0]?.id ?? '';
    const s = await tx.query<{ id: string }>(
      `INSERT INTO eventstream_config (tenant_id, scope, stream_key, status, correlation_id, created_by) VALUES ($1,'tenant','s1','active',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), requester],
    );
    streamId = s.rows[0]?.id ?? '';
    // a delivered attempt (idempotency anchor).
    await tx.query(
      `INSERT INTO webhook_delivery (tenant_id, endpoint_id, event_id, event_family, event_type, dedupe_key, status, attempt_no, correlation_id) VALUES ($1,$2,$3,'finance.lifecycle','JournalPosted','dk-1','delivered',1,$4)`,
      [tenantA, endpointId, randomUUID(), randomUUID()],
    );
    t.ok(
      endpointId !== '' && streamId !== '',
      'tenant A seeds an active endpoint, a stream and a delivered attempt',
    );
  });

  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM webhook_endpoint WHERE id=$1`, [
      endpointId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's endpoint (RLS)");
  });

  // approved endpoint is IMMUTABLE (trigger) — each reject in its own tx.
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE webhook_endpoint SET url='https://evil.example.com/x' WHERE id=$1`, [endpointId]),
      'an approved endpoint url is immutable (trigger)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE webhook_endpoint SET endpoint_key='ep-other' WHERE id=$1`, [endpointId]),
      'an endpoint key is immutable (trigger)',
    );
  });

  // evidence_ck + one active per key + secretref shape
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO webhook_endpoint (tenant_id, scope, endpoint_key, url, state, validation_passed, correlation_id) VALUES ($1,'tenant','k2','https://h.example.com/y','active',false,$2)`,
        [tenantA, randomUUID()],
      ),
      'an endpoint cannot be activated without validation_passed (evidence_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO webhook_endpoint (tenant_id, scope, endpoint_key, url, state, validation_passed, correlation_id) VALUES ($1,'tenant','ep1','https://h.example.com/dupe','active',true,$2)`,
        [tenantA, randomUUID()],
      ),
      'only one active endpoint per key (webhook_endpoint_one_key)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO webhook_endpoint (tenant_id, scope, endpoint_key, url, signing_secret_ref, state, correlation_id) VALUES ($1,'tenant','k3','https://h.example.com/z','hunter2','draft',$2)`,
        [tenantA, randomUUID()],
      ),
      'a raw signing secret cannot be stored (webhook_endpoint_secret_ref_ck)',
    );
  });

  // delivery idempotency: a second 'delivered' for the same (endpoint, dedupe_key) is refused.
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO webhook_delivery (tenant_id, endpoint_id, event_id, event_family, event_type, dedupe_key, status, attempt_no, correlation_id) VALUES ($1,$2,$3,'finance.lifecycle','JournalPosted','dk-1','delivered',2,$4)`,
        [tenantA, endpointId, randomUUID(), randomUUID()],
      ),
      'at most one delivered per endpoint per event (webhook_delivery_one_delivered)',
    );
  });

  // maker-checker DB CHECKs on webhook_review
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO webhook_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, correlation_id) VALUES ($1,'endpoint',$2,'approved',$3,$3,$4)`,
        [tenantA, endpointId, requester, randomUUID()],
      ),
      'a decider can never be the requester (webhook_review_sod_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO webhook_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, correlation_id) VALUES ($1,'endpoint',$2,'approved',$3,NULL,$4)`,
        [tenantA, endpointId, requester, randomUUID()],
      ),
      'an approved decision requires a decider (webhook_review_decider_ck)',
    );
  });

  // cursor position is non-negative (no float; bigint >= 0).
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO eventstream_cursor (tenant_id, stream_id, consumer_key, position, correlation_id) VALUES ($1,$2,'c1',-5,$3)`,
        [tenantA, streamId, randomUUID()],
      ),
      'a cursor position cannot be negative (eventstream_cursor_pos_ck)',
    );
  });

  // idempotency uniqueness: success then reject.
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `idem-${randomUUID()}`;
    await tx.query(
      `INSERT INTO events_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
      [tenantA, key, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO events_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
        [tenantA, key, randomUUID()],
      ),
      'the idempotency ledger rejects a duplicate key (events_idempotency_key_uk)',
    );
  });
});
