import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M35 Developer Portal DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the guarantees across
 * the 9 devportal_* tables: RLS ENABLE+FORCE + tenant_isolation everywhere; tenant isolation holds; NO DELETE and INSERT+
 * SELECT only on the 5 append-only ledgers; NO float; ZERO secret/credential VALUE columns (a credential is a one-way
 * sha256: hash XOR an opaque secretref: pointer). THE INVARIANTS ARE DB-ENFORCED: a published product is IMMUTABLE (trigger);
 * a product cannot be published without a passing validation (evidence_ck); an exposed operation must carry a 3-segment m02
 * permission (product_scope perm_ck — the FACADE rule); a credential carries EXACTLY ONE of a well-formed hash XOR reference
 * and NO plaintext (material_ck + shape_ck); a review/subscription DECISION needs decided_by/approved_by <> requester (SoD);
 * one published product per key; the devportal.* permissions are seeded; a single outbox (m06 — m35 owns none); PostgreSQL 16.
 */
const M35_TABLES = [
  'devportal_app',
  'devportal_api_product',
  'devportal_product_scope',
  'devportal_credential',
  'devportal_subscription',
  'devportal_review',
  'devportal_credential_event',
  'devportal_history',
  'devportal_idempotency',
];
const APPEND_ONLY = [
  'devportal_product_scope',
  'devportal_review',
  'devportal_credential_event',
  'devportal_history',
  'devportal_idempotency',
];

export default defineDbSpec('m35-devportal', async (ctx, t) => {
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M35_TABLES],
    );
    t.equal(r.rows.length, M35_TABLES.length, 'all 9 devportal tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M35_TABLES],
    );
    t.equal(p.rows.length, M35_TABLES.length, 'every devportal table has a tenant_isolation policy');
  });

  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name LIKE 'devportal_%'`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any devportal table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the five append-only ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'devportal_%' AND data_type IN ('real','double precision')`,
    );
    t.equal(floats.rows[0]?.c, '0', 'no devportal column uses a binary float');
    // Any column whose NAME implies a plaintext secret VALUE is forbidden. Structural columns are exempt: an opaque FK id
    // (`*_id`), an opaque secretref pointer (`*_ref`), and a one-way hash (`*_hash`) are not plaintext values by construction.
    const secrets = await tx.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'devportal_%'
         AND column_name ~ '(password|passphrase|api[_]?key|access_token|auth_token|private_key|secret_value|credential|secret_material)'
         AND column_name !~ '(_id|_ref|_hash)$'`,
    );
    t.equal(
      secrets.rows.length,
      0,
      'ZERO plaintext secret/credential VALUE column (a credential is a one-way *_hash XOR an opaque *_ref pointer)',
    );
    const immut = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM pg_trigger WHERE tgrelid::regclass::text = 'devportal_api_product' AND NOT tgisinternal`,
    );
    t.equal(immut.rows[0]?.c, '1', 'one published-immutability trigger (devportal_api_product)');
  });

  await ctx.asSuperuser(null, async (tx) => {
    const perms = await tx.query<{ code: string; privileged: boolean }>(
      `SELECT code, privileged FROM permissions WHERE module='m35-devportal' ORDER BY code`,
    );
    t.equal(perms.rows.length, 8, 'eight devportal.* permissions are seeded');
    t.ok(
      perms.rows.every((p) => p.code.startsWith('devportal.') && p.code.split('.').length === 3),
      'all seeded codes are 3-segment devportal.*',
    );
    t.ok(
      perms.rows.find((p) => p.code === 'devportal.product.publish')?.privileged === true,
      'product publish is privileged',
    );
    const outboxes = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%outbox%'`,
    );
    t.ok(
      outboxes.rows.length === 1 && outboxes.rows[0]?.table_name === 'workflow_event_outbox',
      'exactly one outbox (m06) — m35 owns none',
    );
  });

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const requester = randomUUID();

  let appId = '';
  let productId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const a = await tx.query<{ id: string }>(
      `INSERT INTO devportal_app (tenant_id, scope, app_key, name, status, correlation_id, created_by)
       VALUES ($1,'tenant','acme','Acme','active',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), requester],
    );
    appId = a.rows[0]?.id ?? '';
    const p = await tx.query<{ id: string }>(
      `INSERT INTO devportal_api_product (tenant_id, scope, product_key, title, category, visibility, source_kind, state, validation_passed, content_hash, correlation_id, created_by)
       VALUES ($1,'tenant','billing','Billing API','finance','tenant','internal','published',true,'sha256:x',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), requester],
    );
    productId = p.rows[0]?.id ?? '';
    // a well-formed credential: a one-way hash alone (no plaintext, no reference).
    const cred = await tx.query<{ id: string }>(
      `INSERT INTO devportal_credential (tenant_id, app_id, key_id, purpose, secret_hash, correlation_id, created_by)
       VALUES ($1,$2,$3,'api',$4,$5,$6) RETURNING id`,
      [tenantA, appId, `dpk_${randomUUID()}`, `sha256:${'a'.repeat(64)}`, randomUUID(), requester],
    );
    t.ok(
      appId !== '' && productId !== '' && (cred.rows[0]?.id ?? '') !== '',
      'tenant A seeds an app, a published product and a hash-only credential',
    );
    // a well-formed exposed operation: carries a 3-segment m02 permission (facade rule).
    const scope = await tx.query<{ id: string }>(
      `INSERT INTO devportal_product_scope (tenant_id, product_id, operation_ref, required_permission, correlation_id) VALUES ($1,$2,'GET /invoices','finance.invoice.read',$3) RETURNING id`,
      [tenantA, productId, randomUUID()],
    );
    t.ok(
      (scope.rows[0]?.id ?? '') !== '',
      'an operation carrying a 3-segment permission is accepted (facade rule)',
    );
  });

  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM devportal_api_product WHERE id=$1`,
      [productId],
    );
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's product (RLS)");
  });

  // published product is IMMUTABLE (trigger) — each reject in its own tx.
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE devportal_api_product SET source_ref='other' WHERE id=$1`, [productId]),
      'a published product is immutable (trigger)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE devportal_api_product SET state='draft' WHERE id=$1`, [productId]),
      'a published product can only move to deprecated',
    );
  });

  // evidence_ck + one-published
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO devportal_api_product (tenant_id, scope, product_key, title, category, visibility, source_kind, state, validation_passed, content_hash, correlation_id) VALUES ($1,'tenant','k2','t','finance','tenant','internal','published',false,'sha256:y',$2)`,
        [tenantA, randomUUID()],
      ),
      'a product cannot be published without validation_passed (evidence_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO devportal_api_product (tenant_id, scope, product_key, title, category, visibility, source_kind, state, validation_passed, content_hash, correlation_id) VALUES ($1,'tenant','billing','dupe','finance','tenant','internal','published',true,'sha256:z',$2)`,
        [tenantA, randomUUID()],
      ),
      'only one published product per key (devportal_api_product_one_published)',
    );
  });

  // FACADE rule: an exposed operation without a 3-segment permission is refused.
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO devportal_product_scope (tenant_id, product_id, operation_ref, required_permission, correlation_id) VALUES ($1,$2,'GET /x','read',$3)`,
        [tenantA, productId, randomUUID()],
      ),
      'an exposed operation must carry a 3-segment m02 permission (devportal_product_scope_perm_ck)',
    );
  });

  // SECRET SEAM: no plaintext; exactly one of a well-formed hash XOR an opaque reference.
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO devportal_credential (tenant_id, app_id, key_id, purpose, secret_hash, secret_ref, correlation_id) VALUES ($1,$2,$3,'api',$4,'secretref:v/k/x',$5)`,
        [tenantA, appId, `dpk_${randomUUID()}`, `sha256:${'b'.repeat(64)}`, randomUUID()],
      ),
      'a credential cannot carry BOTH a hash and a reference (devportal_credential_material_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO devportal_credential (tenant_id, app_id, key_id, purpose, correlation_id) VALUES ($1,$2,$3,'api',$4)`,
        [tenantA, appId, `dpk_${randomUUID()}`, randomUUID()],
      ),
      'a credential must carry a hash or a reference — never neither (no plaintext elsewhere)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO devportal_credential (tenant_id, app_id, key_id, purpose, secret_hash, correlation_id) VALUES ($1,$2,$3,'api','hunter2',$4)`,
        [tenantA, appId, `dpk_${randomUUID()}`, randomUUID()],
      ),
      'a plaintext secret cannot be stored as a hash (devportal_credential_hash_shape_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO devportal_credential (tenant_id, app_id, key_id, purpose, secret_ref, correlation_id) VALUES ($1,$2,$3,'api','hunter2',$4)`,
        [tenantA, appId, `dpk_${randomUUID()}`, randomUUID()],
      ),
      'a raw secret cannot be stored as a reference (devportal_credential_ref_shape_ck)',
    );
  });

  // maker-checker DB CHECKs on devportal_review
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO devportal_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, correlation_id) VALUES ($1,'product',$2,'approved',$3,$3,$4)`,
        [tenantA, productId, requester, randomUUID()],
      ),
      'a decider can never be the requester (devportal_review_sod_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO devportal_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, correlation_id) VALUES ($1,'product',$2,'approved',$3,NULL,$4)`,
        [tenantA, productId, requester, randomUUID()],
      ),
      'an approved decision requires a decider (devportal_review_decider_ck)',
    );
  });

  // subscription SoD: approved_by can never be the requester.
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO devportal_subscription (tenant_id, app_id, product_id, status, requested_by, approved_by, correlation_id) VALUES ($1,$2,$3,'active',$4,$4,$5)`,
        [tenantA, appId, productId, requester, randomUUID()],
      ),
      'a subscription approver can never be the requester (devportal_subscription_sod_ck)',
    );
  });

  // idempotency uniqueness: success then reject.
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `idem-${randomUUID()}`;
    await tx.query(
      `INSERT INTO devportal_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
      [tenantA, key, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO devportal_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
        [tenantA, key, randomUUID()],
      ),
      'the idempotency ledger rejects a duplicate key (devportal_idempotency_key_uk)',
    );
  });
});
