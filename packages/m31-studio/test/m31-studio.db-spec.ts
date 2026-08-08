import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M31 Studio DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the design-time guarantees
 * across the 9 studio_* tables: RLS ENABLE+FORCE + tenant_isolation everywhere; tenant isolation holds; NO DELETE
 * anywhere and INSERT+SELECT only on the 6 append-only ledgers; NO float; ZERO secret VALUE columns; and NO submitted
 * form-business-data table (FORM DEFINITION != BUSINESS RECORD). THE INVARIANTS ARE DB-ENFORCED: a published version is
 * IMMUTABLE (studio_artifact_version_immutable trigger); a design cannot reach published without a passing validation
 * (evidence_ck); a review DECISION needs a decider and decided_by <> requested_by (SoD); a workflow/rule binding must
 * carry the opaque canonical ids; a cross-tenant dependency is refused (composite FK); one published version per
 * artifact; the studio.* permissions are seeded; a single outbox (m06 — m31 owns none); PostgreSQL 16.
 */
const M31_TABLES = [
  'studio_project',
  'studio_artifact',
  'studio_artifact_version',
  'studio_dependency',
  'studio_validation_result',
  'studio_review',
  'studio_binding',
  'studio_artifact_history',
  'studio_idempotency',
];
const APPEND_ONLY = [
  'studio_dependency',
  'studio_validation_result',
  'studio_review',
  'studio_binding',
  'studio_artifact_history',
  'studio_idempotency',
];

export default defineDbSpec('m31-studio', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation ----------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M31_TABLES],
    );
    t.equal(r.rows.length, M31_TABLES.length, 'all 9 studio tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M31_TABLES],
    );
    t.equal(p.rows.length, M31_TABLES.length, 'every studio table has a tenant_isolation policy');
  });

  // --- NO DELETE; append-only no UPDATE; no float; ZERO secret VALUE cols; NO submitted-data table -
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name LIKE 'studio_%'`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any studio table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the six append-only ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'studio_%' AND data_type IN ('real','double precision')`,
    );
    t.equal(floats.rows[0]?.c, '0', 'no studio column uses a binary float');
    const secrets = await tx.query<{ column_name: string; table_name: string }>(
      `SELECT column_name, table_name FROM information_schema.columns WHERE table_name LIKE 'studio_%' AND column_name ~ '(password|passphrase|api[_]?key|access_token|auth_token|private_key|secret_value|credential|secret_material)'`,
    );
    t.equal(
      secrets.rows.length,
      0,
      'ZERO secret/credential VALUE column (secret-bearing design values are opaque secretref pointers inside the spec)',
    );
    // FORM DEFINITION != BUSINESS RECORD — m31 stores no submitted form data.
    const submissions = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.tables WHERE table_name LIKE 'studio_%' AND (table_name LIKE '%submission%' OR table_name LIKE '%response%' OR table_name LIKE '%answer%')`,
    );
    t.equal(
      submissions.rows[0]?.c,
      '0',
      'there is NO submitted-form-data table (form definition, not business record)',
    );
  });

  // --- permissions seeded -----------------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const perms = await tx.query<{ code: string; privileged: boolean }>(
      `SELECT code, privileged FROM permissions WHERE module='m31-studio' ORDER BY code`,
    );
    t.equal(perms.rows.length, 9, 'nine studio.* permissions are seeded');
    t.ok(
      perms.rows.every((p) => p.code.startsWith('studio.') && p.code.split('.').length === 3),
      'all seeded codes are 3-segment studio.*',
    );
    const publish = perms.rows.find((p) => p.code === 'studio.artifact.publish');
    t.ok(publish?.privileged === true, 'studio.artifact.publish is privileged');
  });

  // --- single outbox (m31 owns none) ------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const outboxes = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%outbox%' ORDER BY table_name`,
    );
    t.ok(
      outboxes.rows.length === 1 && outboxes.rows[0]?.table_name === 'workflow_event_outbox',
      'exactly one outbox exists (m06 workflow_event_outbox) — m31 owns none',
    );
  });

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const actorR = randomUUID();

  // Seed a project + artifact + a published version in tenant A (COMMITS: ids reused below).
  let projectId = '';
  let artifactId = '';
  let publishedVersionId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const pr = await tx.query<{ id: string }>(
      `INSERT INTO studio_project (tenant_id, scope, project_key, name, correlation_id, created_by) VALUES ($1,'tenant','proj-a','Proj A',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), actorR],
    );
    projectId = pr.rows[0]?.id ?? '';
    const ar = await tx.query<{ id: string }>(
      `INSERT INTO studio_artifact (tenant_id, project_id, scope, kind, artifact_key, name, latest_version, correlation_id, created_by) VALUES ($1,$2,'tenant','form','form-a','Form A',1,$3,$4) RETURNING id`,
      [tenantA, projectId, randomUUID(), actorR],
    );
    artifactId = ar.rows[0]?.id ?? '';
    const vr = await tx.query<{ id: string }>(
      `INSERT INTO studio_artifact_version (tenant_id, artifact_id, version_no, state, spec, content_hash, validation_passed, correlation_id, created_by)
       VALUES ($1,$2,1,'published','{"schemaVersion":1}'::jsonb,'sha256:x',true,$3,$4) RETURNING id`,
      [tenantA, artifactId, randomUUID(), actorR],
    );
    publishedVersionId = vr.rows[0]?.id ?? '';
    t.ok(
      projectId !== '' && artifactId !== '' && publishedVersionId !== '',
      'tenant A seeds project + artifact + published version',
    );
  });

  // --- tenant isolation -------------------------------------------------------------------------
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM studio_artifact WHERE id=$1`, [
      artifactId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's artifact (RLS)");
  });

  // --- PUBLISHED VERSION IS IMMUTABLE (trigger) -------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE studio_artifact_version SET notes='tampered' WHERE id=$1`, [publishedVersionId]),
      'a published version cannot be mutated (studio_artifact_version_immutable trigger)',
    );
  });

  // --- a design cannot be published without a passing validation (evidence_ck) ------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO studio_artifact_version (tenant_id, artifact_id, version_no, state, spec, content_hash, validation_passed, correlation_id) VALUES ($1,$2,2,'published','{}'::jsonb,'sha256:y',false,$3)`,
        [tenantA, artifactId, randomUUID()],
      ),
      'a version cannot be published without validation_passed (studio_artifact_version_evidence_ck)',
    );
  });

  // --- one published version per artifact (partial unique index) --------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO studio_artifact_version (tenant_id, artifact_id, version_no, state, spec, content_hash, validation_passed, correlation_id) VALUES ($1,$2,3,'published','{}'::jsonb,'sha256:z',true,$3)`,
        [tenantA, artifactId, randomUUID()],
      ),
      'only one published version per artifact (studio_artifact_version_one_published)',
    );
  });

  // --- maker-checker / SoD DB CHECKs on studio_review -------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO studio_review (tenant_id, artifact_version_id, kind, requested_by, decided_by, correlation_id) VALUES ($1,$2,'approved',$3,$3,$4)`,
        [tenantA, publishedVersionId, actorR, randomUUID()],
      ),
      'a decider can never be the requester (studio_review_sod_ck)',
    );
    await t.rejects(
      tx.query(
        `INSERT INTO studio_review (tenant_id, artifact_version_id, kind, requested_by, decided_by, correlation_id) VALUES ($1,$2,'approved',$3,NULL,$4)`,
        [tenantA, publishedVersionId, actorR, randomUUID()],
      ),
      'an approved decision requires a decider (studio_review_decider_ck)',
    );
  });

  // --- binding must carry the opaque canonical ids for workflow/rule ----------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO studio_binding (tenant_id, artifact_version_id, target_engine, correlation_id) VALUES ($1,$2,'workflow',$3)`,
        [tenantA, publishedVersionId, randomUUID()],
      ),
      'a workflow binding must carry the opaque canonical definition id (studio_binding_target_ck)',
    );
  });

  // --- a dependency needs an artifact OR a capability ref; a cross-tenant dependency is refused --
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO studio_dependency (tenant_id, artifact_version_id, correlation_id) VALUES ($1,$2,$3)`,
        [tenantA, publishedVersionId, randomUUID()],
      ),
      'a dependency needs an artifact or a capability reference (studio_dependency_target_ck)',
    );
  });
  let tenantBArtifactId = '';
  await ctx.asTenant(tenantB, async (tx) => {
    const pr = await tx.query<{ id: string }>(
      `INSERT INTO studio_project (tenant_id, scope, project_key, name, correlation_id) VALUES ($1,'tenant','proj-b','Proj B',$2) RETURNING id`,
      [tenantB, randomUUID()],
    );
    const ar = await tx.query<{ id: string }>(
      `INSERT INTO studio_artifact (tenant_id, project_id, scope, kind, artifact_key, name, correlation_id) VALUES ($1,$2,'tenant','rule','rule-b','Rule B',$3) RETURNING id`,
      [tenantB, pr.rows[0]?.id, randomUUID()],
    );
    tenantBArtifactId = ar.rows[0]?.id ?? '';
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO studio_dependency (tenant_id, artifact_version_id, depends_on_artifact_id, depends_on_kind, correlation_id) VALUES ($1,$2,$3,'rule',$4)`,
        [tenantA, publishedVersionId, tenantBArtifactId, randomUUID()],
      ),
      "a cross-tenant dependency is refused (composite FK — tenant A cannot bind to tenant B's artifact)",
    );
  });

  // --- an opaque capability reference IS accepted (m33 deferred, stored as opaque ref) ----------
  await ctx.asTenant(tenantA, async (tx) => {
    const d = await tx.query<{ id: string }>(
      `INSERT INTO studio_dependency (tenant_id, artifact_version_id, capability_ref, correlation_id) VALUES ($1,$2,'connector:salesforce/create-lead',$3) RETURNING id`,
      [tenantA, publishedVersionId, randomUUID()],
    );
    t.ok(
      (d.rows[0]?.id ?? '') !== '',
      'an opaque integration capability reference is accepted (m33 deferred)',
    );
  });

  // --- idempotency uniqueness -------------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `idem-${randomUUID()}`;
    await tx.query(
      `INSERT INTO studio_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
      [tenantA, key, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO studio_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
        [tenantA, key, randomUUID()],
      ),
      'the idempotency ledger rejects a duplicate key (studio_idempotency_key_uk)',
    );
  });
});
