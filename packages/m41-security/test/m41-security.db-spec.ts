import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M41 Security DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the guarantees across the 13
 * security_/grc_/privacy_ tables. THE LOAD-BEARING INVARIANT: ZERO secret-value / ciphertext / token / private-key / password
 * columns anywhere — a secret is an opaque secret_ref + an approved algorithm id only. Also: RLS ENABLE+FORCE + tenant_isolation
 * everywhere; tenant isolation holds; NO DELETE and INSERT+SELECT only on the 8 append-only ledgers; NO float. THE INVARIANTS
 * ARE DB-ENFORCED: a non-pending secret version is IMMUTABLE (trigger); AT MOST ONE active version per secret (partial unique
 * index — rotation is race-safe); a reveal/review needs SoD (approved_by/decided_by <> requested_by); a secret_ref must match
 * the secretref: shape; the security. / grc. / privacy. permissions are seeded; one outbox (m06 — m41 owns none); PostgreSQL 16.
 */
const M41_TABLES = [
  'security_secret',
  'security_secret_version',
  'security_reveal',
  'security_dlp_policy',
  'security_dlp_finding',
  'security_incident',
  'security_review',
  'security_history',
  'security_idempotency',
  'grc_control',
  'grc_assessment',
  'privacy_classification',
  'privacy_record',
];
const APPEND_ONLY = [
  'security_reveal',
  'security_dlp_finding',
  'security_incident',
  'security_review',
  'security_history',
  'security_idempotency',
  'grc_assessment',
  'privacy_record',
];

export default defineDbSpec('m41-security', async (ctx, t) => {
  // --- structure: tables, RLS, policies ------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M41_TABLES],
    );
    t.equal(r.rows.length, M41_TABLES.length, 'all 13 security/grc/privacy tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname='tenant_isolation'`,
      [M41_TABLES],
    );
    t.equal(p.rows.length, M41_TABLES.length, 'every table has a tenant_isolation policy');
  });

  // --- THE ZERO-SECRET-VALUE INVARIANT (load-bearing) ---------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const sv = await tx.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_name = ANY($1)
        AND (column_name LIKE '%secret%value%' OR column_name LIKE '%ciphertext%' OR column_name LIKE '%plaintext%'
             OR column_name LIKE '%private%key%' OR column_name LIKE '%password%' OR column_name LIKE '%token%'
             OR column_name = 'secret' OR column_name = 'material' OR column_name LIKE '%key_material%')`,
      [M41_TABLES],
    );
    t.equal(
      sv.rows.length,
      0,
      'ZERO secret-value / ciphertext / token / private-key / password / material columns anywhere',
    );
    const refs = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name = ANY($1) AND column_name IN ('secret_ref','provider_ref')`,
      [M41_TABLES],
    );
    t.ok(Number(refs.rows[0]?.c ?? '0') >= 2, 'secret_ref + provider_ref opaque pointers exist (the seam)');
    const fl = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name = ANY($1) AND data_type IN ('double precision','real')`,
      [M41_TABLES],
    );
    t.equal(fl.rows[0]?.c, '0', 'no float/double column anywhere');
  });

  // --- grants: no DELETE; append-only ledgers INSERT+SELECT only -----------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE'
        AND (table_name LIKE 'security_%' OR table_name LIKE 'grc_%' OR table_name LIKE 'privacy_%')`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any security/grc/privacy table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'no UPDATE grant on any of the 8 append-only ledgers');
  });

  // --- one immutability trigger + 14 seeded permissions + one outbox ------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const trg = await tx.query<{ tgname: string }>(
      `SELECT tg.tgname FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid WHERE (c.relname LIKE 'security_%' OR c.relname LIKE 'grc_%' OR c.relname LIKE 'privacy_%') AND NOT tg.tgisinternal`,
    );
    t.equal(trg.rows.length, 1, 'exactly one immutability trigger (security_secret_version)');
    const perms = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE code LIKE 'security.%' OR code LIKE 'grc.%' OR code LIKE 'privacy.%'`,
    );
    t.equal(perms.rows[0]?.c, '14', 'fourteen security.*/grc.*/privacy.* permissions are seeded');
    const noAdmin = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE code IN ('security.admin','grc.admin','privacy.admin') OR code LIKE 'security.%.%.%'`,
    );
    t.equal(noAdmin.rows[0]?.c, '0', 'no security.admin/grc.admin/privacy.admin and no 4-segment permission');
    const outbox = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'security_%outbox%' OR tablename LIKE 'grc_%outbox%')`,
    );
    t.equal(outbox.rows[0]?.c, '0', 'm41 owns NO outbox table (it uses the one m06 outbox)');
  });

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const requester = randomUUID();

  let secretId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const s = await tx.query<{ id: string }>(
      `INSERT INTO security_secret (tenant_id, material_kind, scope, secret_key, secret_ref, algorithm, state, current_version_no, correlation_id, created_by)
       VALUES ($1,'key','tenant','sig-key','secretref:vault/kv/sig','aes-256-gcm','active',1,$2,$3) RETURNING id`,
      [tenantA, randomUUID(), requester],
    );
    secretId = s.rows[0]?.id ?? '';
    await tx.query(
      `INSERT INTO security_secret_version (tenant_id, secret_id, version_no, state, provider_ref, activated_at, correlation_id, created_by)
       VALUES ($1,$2,1,'active','provider:k1',now(),$3,$4)`,
      [tenantA, secretId, randomUUID(), requester],
    );
    t.ok(secretId !== '', 'tenant A seeds an active secret + active version');
  });

  // tenant isolation
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM security_secret WHERE id=$1`, [
      secretId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's secret (RLS)");
  });

  // ONE active version per secret (partial unique index — rotation race-safe)
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO security_secret_version (tenant_id, secret_id, version_no, state, provider_ref, correlation_id, created_by)
         VALUES ($1,$2,2,'active','provider:k2',$3,$4)`,
        [tenantA, secretId, randomUUID(), requester],
      ),
      'a second ACTIVE version for the same secret is rejected (one-active index — rotation race-safe)',
    );
  });

  // a non-pending version is IMMUTABLE (trigger) — try to rewrite an active version's version_no
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE security_secret_version SET version_no=9 WHERE secret_id=$1 AND state='active'`, [
        secretId,
      ]),
      'an activated secret version is immutable (trigger — issue a new version to rotate)',
    );
  });

  // a secret_ref must match the secretref: shape
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO security_secret (tenant_id, material_kind, secret_key, secret_ref, correlation_id, created_by)
         VALUES ($1,'secret','bad','raw-plaintext-secret',$2,$3)`,
        [tenantA, randomUUID(), requester],
      ),
      'a non-secretref secret_ref is rejected (no raw secret value — shape CHECK)',
    );
  });

  // reveal SoD: approved_by cannot equal requested_by
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO security_reveal (tenant_id, secret_id, requested_by, approved_by, purpose, correlation_id)
         VALUES ($1,$2,$3,$3,'debug',$4)`,
        [tenantA, secretId, requester, randomUUID()],
      ),
      'a reveal approver cannot equal the requester (SoD CHECK)',
    );
  });

  // review SoD
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO security_review (tenant_id, target_kind, target_id, decision, requested_by, decided_by, correlation_id)
         VALUES ($1,'secret',$2,'approved',$3,$3,$4)`,
        [tenantA, secretId, requester, randomUUID()],
      ),
      'a review decided_by cannot equal requested_by (SoD CHECK)',
    );
  });
});
