import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M34 Marketplace DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the marketplace guarantees
 * across the 9 marketplace_* tables: RLS ENABLE+FORCE + tenant_isolation everywhere; tenant isolation holds; NO DELETE and
 * INSERT+SELECT only on the 5 append-only ledgers; NO float; ZERO secret VALUE columns (secrets are opaque secretref:
 * pointers). THE INVARIANTS ARE DB-ENFORCED: a published listing is IMMUTABLE (trigger); a listing cannot be published
 * without a passing validation (evidence_ck); CONSENT is human-governed (marketplace_consent_human_ck); an install secret
 * must match the secretref: shape; a review DECISION needs a decider and decided_by <> requested_by (SoD); one published
 * listing per key; the marketplace.* permissions are seeded; a single outbox (m06 — m34 owns none); PostgreSQL 16.
 */
const M34_TABLES = [
  'marketplace_listing',
  'marketplace_listing_capability',
  'marketplace_installation',
  'marketplace_consent',
  'marketplace_install_secret',
  'marketplace_upgrade',
  'marketplace_review',
  'marketplace_history',
  'marketplace_idempotency',
];
const APPEND_ONLY = [
  'marketplace_listing_capability',
  'marketplace_upgrade',
  'marketplace_review',
  'marketplace_history',
  'marketplace_idempotency',
];

export default defineDbSpec('m34-marketplace', async (ctx, t) => {
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M34_TABLES],
    );
    t.equal(r.rows.length, M34_TABLES.length, 'all 9 marketplace tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M34_TABLES],
    );
    t.equal(p.rows.length, M34_TABLES.length, 'every marketplace table has a tenant_isolation policy');
  });

  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name LIKE 'marketplace_%'`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any marketplace table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the five append-only ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'marketplace_%' AND data_type IN ('real','double precision')`,
    );
    t.equal(floats.rows[0]?.c, '0', 'no marketplace column uses a binary float');
    const secrets = await tx.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'marketplace_%' AND column_name ~ '(password|passphrase|api[_]?key|access_token|auth_token|private_key|secret_value|credential|secret_material)'`,
    );
    t.equal(
      secrets.rows.length,
      0,
      'ZERO secret/credential VALUE column (install secrets are opaque secretref pointers only)',
    );
    const immut = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM pg_trigger WHERE tgrelid::regclass::text = 'marketplace_listing' AND NOT tgisinternal`,
    );
    t.equal(immut.rows[0]?.c, '1', 'one published-immutability trigger (marketplace_listing)');
  });

  await ctx.asSuperuser(null, async (tx) => {
    const perms = await tx.query<{ code: string; privileged: boolean }>(
      `SELECT code, privileged FROM permissions WHERE module='m34-marketplace' ORDER BY code`,
    );
    t.equal(perms.rows.length, 8, 'eight marketplace.* permissions are seeded');
    t.ok(
      perms.rows.every((p) => p.code.startsWith('marketplace.') && p.code.split('.').length === 3),
      'all seeded codes are 3-segment marketplace.*',
    );
    t.ok(
      perms.rows.find((p) => p.code === 'marketplace.listing.publish')?.privileged === true,
      'listing publish is privileged',
    );
    const outboxes = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%outbox%'`,
    );
    t.ok(
      outboxes.rows.length === 1 && outboxes.rows[0]?.table_name === 'workflow_event_outbox',
      'exactly one outbox (m06) — m34 owns none',
    );
  });

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const requester = randomUUID();

  let listingId = '';
  let installationId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const l = await tx.query<{ id: string }>(
      `INSERT INTO marketplace_listing (tenant_id, scope, listing_key, connector_ref, title, category, visibility, state, validation_passed, content_hash, correlation_id, created_by)
       VALUES ($1,'tenant','sf-crm','conn-1','Salesforce','crm','tenant','published',true,'sha256:x',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), requester],
    );
    listingId = l.rows[0]?.id ?? '';
    const i = await tx.query<{ id: string }>(
      `INSERT INTO marketplace_installation (tenant_id, listing_id, connector_ref, scope, install_key, status, requested_by, correlation_id, created_by)
       VALUES ($1,$2,'conn-1','tenant','inst-a','active',$3,$4,$5) RETURNING id`,
      [tenantA, listingId, requester, randomUUID(), requester],
    );
    installationId = i.rows[0]?.id ?? '';
    t.ok(listingId !== '' && installationId !== '', 'tenant A seeds a published listing + installation');
  });

  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM marketplace_listing WHERE id=$1`,
      [listingId],
    );
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's listing (RLS)");
  });

  // published listing is IMMUTABLE (trigger) — each reject in its own tx.
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE marketplace_listing SET connector_ref='other' WHERE id=$1`, [listingId]),
      'a published listing is immutable (trigger)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE marketplace_listing SET state='draft' WHERE id=$1`, [listingId]),
      'a published listing can only move to deprecated',
    );
  });

  // evidence_ck + one-published
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO marketplace_listing (tenant_id, scope, listing_key, connector_ref, title, category, visibility, state, validation_passed, content_hash, correlation_id) VALUES ($1,'tenant','k2','c2','t','crm','tenant','published',false,'sha256:y',$2)`,
        [tenantA, randomUUID()],
      ),
      'a listing cannot be published without validation_passed (evidence_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO marketplace_listing (tenant_id, scope, listing_key, connector_ref, title, category, visibility, state, validation_passed, content_hash, correlation_id) VALUES ($1,'tenant','sf-crm','c3','dupe','crm','tenant','published',true,'sha256:z',$2)`,
        [tenantA, randomUUID()],
      ),
      'only one published listing per key (marketplace_listing_one_published)',
    );
  });

  // CONSENT is human-governed: a granted consent must record the human granter.
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO marketplace_consent (tenant_id, installation_id, scopes, status, granted_by, correlation_id) VALUES ($1,$2,'{read}','granted',NULL,$3)`,
        [tenantA, installationId, randomUUID()],
      ),
      'a granted consent must record the human who granted it (marketplace_consent_human_ck)',
    );
  });

  // SECRET SEAM: success (secretref) first, then reject (raw) — a reject aborts the tx.
  await ctx.asTenant(tenantA, async (tx) => {
    const ok = await tx.query<{ id: string }>(
      `INSERT INTO marketplace_install_secret (tenant_id, installation_id, purpose, secret_ref, correlation_id) VALUES ($1,$2,'oauth','secretref:vault/kv/sf',$3) RETURNING id`,
      [tenantA, installationId, randomUUID()],
    );
    t.ok((ok.rows[0]?.id ?? '') !== '', 'a well-formed opaque secret reference is accepted (pointer only)');
    await t.rejects(
      tx.query(
        `INSERT INTO marketplace_install_secret (tenant_id, installation_id, purpose, secret_ref, correlation_id) VALUES ($1,$2,'api','hunter2',$3)`,
        [tenantA, installationId, randomUUID()],
      ),
      'a raw secret value cannot be stored as a reference (marketplace_install_secret_ref_shape_ck)',
    );
  });

  // maker-checker DB CHECKs on marketplace_review
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO marketplace_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, correlation_id) VALUES ($1,'listing',$2,'approved',$3,$3,$4)`,
        [tenantA, listingId, requester, randomUUID()],
      ),
      'a decider can never be the requester (marketplace_review_sod_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO marketplace_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, correlation_id) VALUES ($1,'listing',$2,'approved',$3,NULL,$4)`,
        [tenantA, listingId, requester, randomUUID()],
      ),
      'an approved decision requires a decider (marketplace_review_decider_ck)',
    );
  });

  // idempotency uniqueness: success then reject.
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `idem-${randomUUID()}`;
    await tx.query(
      `INSERT INTO marketplace_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
      [tenantA, key, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO marketplace_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
        [tenantA, key, randomUUID()],
      ),
      'the idempotency ledger rejects a duplicate key (marketplace_idempotency_key_uk)',
    );
  });
});
