import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M37 Governance/QA/Release DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the guarantees
 * across the 9 govrelease_* tables: RLS ENABLE+FORCE + tenant_isolation everywhere; tenant isolation holds; NO DELETE and
 * INSERT+SELECT only on the 5 append-only ledgers; NO float; ZERO secret VALUE columns (a signature is an opaque secretref:
 * pointer). THE INVARIANTS ARE DB-ENFORCED: a RELEASED record is IMMUTABLE (trigger); a release cannot enter review/released
 * without a passing QA gate (evidence_ck); a signature must match the secretref: shape; a review DECISION needs a decider and
 * decided_by <> requested_by (SoD); one released per artifact/environment; the govrelease.* permissions are seeded; a single
 * outbox (m06 — m37 owns none); PostgreSQL 16.
 */
const M37_TABLES = [
  'govrelease_artifact',
  'govrelease_environment',
  'govrelease_release',
  'govrelease_gate',
  'govrelease_check',
  'govrelease_review',
  'govrelease_evidence',
  'govrelease_history',
  'govrelease_idempotency',
];
const APPEND_ONLY = [
  'govrelease_check',
  'govrelease_review',
  'govrelease_evidence',
  'govrelease_history',
  'govrelease_idempotency',
];

export default defineDbSpec('m37-govrelease', async (ctx, t) => {
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M37_TABLES],
    );
    t.equal(r.rows.length, M37_TABLES.length, 'all 9 govrelease tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M37_TABLES],
    );
    t.equal(p.rows.length, M37_TABLES.length, 'every govrelease table has a tenant_isolation policy');
  });

  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name LIKE 'govrelease_%'`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any govrelease table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the five append-only ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'govrelease_%' AND data_type IN ('real','double precision')`,
    );
    t.equal(floats.rows[0]?.c, '0', 'no govrelease column uses a binary float');
    const secrets = await tx.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'govrelease_%'
         AND column_name ~ '(password|passphrase|api[_]?key|access_token|auth_token|private_key|secret_value|credential|secret_material)'
         AND column_name !~ '(_id|_ref|_hash)$'`,
    );
    t.equal(secrets.rows.length, 0, 'ZERO secret VALUE column (a signature is an opaque secretref pointer)');
    const immut = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM pg_trigger WHERE tgrelid::regclass::text = 'govrelease_release' AND NOT tgisinternal`,
    );
    t.equal(immut.rows[0]?.c, '1', 'one released-immutability trigger (govrelease_release)');
  });

  await ctx.asSuperuser(null, async (tx) => {
    const perms = await tx.query<{ code: string; privileged: boolean }>(
      `SELECT code, privileged FROM permissions WHERE module='m37-govrelease' ORDER BY code`,
    );
    t.equal(perms.rows.length, 8, 'eight govrelease.* permissions are seeded');
    t.ok(
      perms.rows.every((p) => p.code.startsWith('govrelease.') && p.code.split('.').length === 3),
      'all seeded codes are 3-segment govrelease.*',
    );
    t.ok(
      perms.rows.find((p) => p.code === 'govrelease.release.approve')?.privileged === true,
      'release approve is privileged',
    );
    const outboxes = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%outbox%'`,
    );
    t.ok(
      outboxes.rows.length === 1 && outboxes.rows[0]?.table_name === 'workflow_event_outbox',
      'exactly one outbox (m06) — m37 owns none',
    );
  });

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const requester = randomUUID();

  let artifactId = '';
  let envId = '';
  let releaseId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const a = await tx.query<{ id: string }>(
      `INSERT INTO govrelease_artifact (tenant_id, scope, artifact_key, artifact_kind, artifact_ref, name, status, correlation_id, created_by)
       VALUES ($1,'tenant','ak','connector','conn-1','Salesforce','active',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), requester],
    );
    artifactId = a.rows[0]?.id ?? '';
    const e = await tx.query<{ id: string }>(
      `INSERT INTO govrelease_environment (tenant_id, scope, env_key, tier, requires_approval, status, correlation_id, created_by) VALUES ($1,'tenant','prod',3,true,'active',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), requester],
    );
    envId = e.rows[0]?.id ?? '';
    const r = await tx.query<{ id: string }>(
      `INSERT INTO govrelease_release (tenant_id, artifact_id, environment_id, scope, release_key, to_version, state, qa_passed, requested_by, content_hash, correlation_id, created_by)
       VALUES ($1,$2,$3,'tenant','rk-1',2,'released',true,$4,'sha256:x',$5,$6) RETURNING id`,
      [tenantA, artifactId, envId, requester, randomUUID(), requester],
    );
    releaseId = r.rows[0]?.id ?? '';
    t.ok(
      artifactId !== '' && envId !== '' && releaseId !== '',
      'tenant A seeds an artifact, an environment and a released release',
    );
  });

  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM govrelease_release WHERE id=$1`,
      [releaseId],
    );
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's release (RLS)");
  });

  // released record is IMMUTABLE (trigger) — each reject in its own tx.
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE govrelease_release SET to_version=9 WHERE id=$1`, [releaseId]),
      'a released record identity (version) is immutable (trigger)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE govrelease_release SET state='draft' WHERE id=$1`, [releaseId]),
      'a released record may only move to rolled_back',
    );
  });

  // evidence_ck + one-released
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO govrelease_release (tenant_id, artifact_id, environment_id, scope, release_key, to_version, state, qa_passed, content_hash, correlation_id) VALUES ($1,$2,$3,'tenant','rk2',3,'released',false,'sha256:y',$4)`,
        [tenantA, artifactId, envId, randomUUID()],
      ),
      'a release cannot enter released without qa_passed (evidence_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO govrelease_release (tenant_id, artifact_id, environment_id, scope, release_key, to_version, state, qa_passed, content_hash, correlation_id) VALUES ($1,$2,$3,'tenant','rk3',4,'released',true,'sha256:z',$4)`,
        [tenantA, artifactId, envId, randomUUID()],
      ),
      'only one released per artifact/environment (govrelease_release_one_released)',
    );
  });

  // SECRET SEAM: a raw signature is refused; a secretref passes (success first, then reject).
  await ctx.asTenant(tenantA, async (tx) => {
    const ok = await tx.query<{ id: string }>(
      `INSERT INTO govrelease_evidence (tenant_id, release_id, evidence_kind, signature_ref, correlation_id) VALUES ($1,$2,'attestation','secretref:vault/kv/sig',$3) RETURNING id`,
      [tenantA, releaseId, randomUUID()],
    );
    t.ok((ok.rows[0]?.id ?? '') !== '', 'an opaque secretref signature is accepted (pointer only)');
    await t.rejects(
      tx.query(
        `INSERT INTO govrelease_evidence (tenant_id, release_id, evidence_kind, signature_ref, correlation_id) VALUES ($1,$2,'attestation','rawsig',$3)`,
        [tenantA, releaseId, randomUUID()],
      ),
      'a raw signature value cannot be stored (govrelease_evidence_sig_shape_ck)',
    );
  });

  // maker-checker DB CHECKs on govrelease_review
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO govrelease_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, correlation_id) VALUES ($1,'release',$2,'approved',$3,$3,$4)`,
        [tenantA, releaseId, requester, randomUUID()],
      ),
      'a decider can never be the requester (govrelease_review_sod_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO govrelease_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, correlation_id) VALUES ($1,'release',$2,'approved',$3,NULL,$4)`,
        [tenantA, releaseId, requester, randomUUID()],
      ),
      'an approved decision requires a decider (govrelease_review_decider_ck)',
    );
  });

  // idempotency uniqueness: success then reject.
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `idem-${randomUUID()}`;
    await tx.query(
      `INSERT INTO govrelease_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
      [tenantA, key, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO govrelease_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
        [tenantA, key, randomUUID()],
      ),
      'the idempotency ledger rejects a duplicate key (govrelease_idempotency_key_uk)',
    );
  });
});
