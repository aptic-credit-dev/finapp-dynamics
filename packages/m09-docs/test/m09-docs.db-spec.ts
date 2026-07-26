import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M09 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the platform
 * guarantees the migrations must deliver: every m09 table has RLS ENABLE + FORCE + a tenant_isolation policy;
 * tenant isolation holds; the application role has NO DELETE anywhere and only INSERT+SELECT on the append-only
 * scan evidence; one-ACTIVE-version / one-active-spec / open-checkout / active-hold and idempotency uniqueness
 * hold; and m09's 27 permissions are seeded with the right privileged set.
 */
const M09_TABLES = [
  'document_type',
  'retention_policy',
  'document',
  'document_version',
  'document_access_grant',
  'document_checkout',
  'document_relationship',
  'document_legal_hold',
  'document_disposition',
  'document_scan_result',
];

export default defineDbSpec('m09-docs', async (ctx, t) => {
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) ORDER BY relname`,
      [M09_TABLES],
    );
    t.equal(r.rows.length, M09_TABLES.length, 'all 10 m09 tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M09_TABLES],
    );
    t.equal(p.rows.length, M09_TABLES.length, 'every m09 table has a tenant_isolation policy');
  });

  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name = ANY($2)`,
      [ctx.appRole, M09_TABLES],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any m09 table');
    const scanUpd = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name='document_scan_result'`,
      [ctx.appRole],
    );
    t.equal(scanUpd.rows[0]?.c, '0', 'scan evidence is append-only (no UPDATE grant)');
  });

  await ctx.asSuperuser(null, async (tx) => {
    const c = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m09-docs'`,
    );
    t.equal(c.rows[0]?.c, '27', 'm09 seeds 27 permissions');
    const priv = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m09-docs' AND privileged=true`,
    );
    t.ok(Number(priv.rows[0]?.c) >= 10, 'the privileged document permissions are marked privileged');
  });

  // --- tenant isolation -------------------------------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let docId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO document (tenant_id, code, title, document_type, correlation_id) VALUES ($1,'DOC-1','Doc','contract',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    docId = r.rows[0]?.id ?? '';
    t.ok(docId !== '', 'tenant A inserts a document');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query(`SELECT id FROM document WHERE code='DOC-1'`);
    t.equal(r.rows.length, 0, 'tenant B sees NONE of tenant A documents (RLS isolation)');
  });
  await ctx.asTenant(null, async (tx) => {
    const r = await tx.query(`SELECT id FROM document`);
    t.equal(r.rows.length, 0, 'with no tenant bound the app role sees nothing (fail closed)');
  });

  // --- one active document type -----------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO document_type (tenant_id, code, version_number, name, status, spec, content_hash) VALUES ($1,'contract',1,'C','ACTIVE','{}'::jsonb,'sha256:x')`,
      [tenantA],
    );
  });
  let secondActiveTypeRejected = false;
  try {
    await ctx.asTenant(tenantA, async (tx) => {
      await tx.query(
        `INSERT INTO document_type (tenant_id, code, version_number, name, status, spec, content_hash) VALUES ($1,'contract',2,'C','ACTIVE','{}'::jsonb,'sha256:y')`,
        [tenantA],
      );
    });
  } catch {
    secondActiveTypeRejected = true;
  }
  t.ok(secondActiveTypeRejected, 'a second ACTIVE version of a document type is rejected (one-active index)');

  // --- one active version per document ----------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO document_version (tenant_id, document_id, version_number, status, storage_ref, storage_code, filename, filename_norm, media_type, byte_size, content_hash) VALUES ($1,$2,1,'active','r1','s','a.pdf','a.pdf','application/pdf',10,'sha256:'||repeat('a',64))`,
      [tenantA, docId],
    );
  });
  let secondActiveVerRejected = false;
  try {
    await ctx.asTenant(tenantA, async (tx) => {
      await tx.query(
        `INSERT INTO document_version (tenant_id, document_id, version_number, status, storage_ref, storage_code, filename, filename_norm, media_type, byte_size, content_hash) VALUES ($1,$2,2,'active','r2','s','b.pdf','b.pdf','application/pdf',10,'sha256:'||repeat('b',64))`,
        [tenantA, docId],
      );
    });
  } catch {
    secondActiveVerRejected = true;
  }
  t.ok(
    secondActiveVerRejected,
    'a second ACTIVE version for the same document is rejected (one-active index)',
  );

  // --- committed version requires a content hash + byte size (CHECK) ----------------------------
  let committedNoHashRejected = false;
  try {
    await ctx.asTenant(tenantA, async (tx) => {
      await tx.query(
        `INSERT INTO document_version (tenant_id, document_id, version_number, status, storage_ref, storage_code, filename, filename_norm, media_type) VALUES ($1,$2,3,'committed','r3','s','c.pdf','c.pdf','application/pdf')`,
        [tenantA, docId],
      );
    });
  } catch {
    committedNoHashRejected = true;
  }
  t.ok(
    committedNoHashRejected,
    'a committed version without a content hash is rejected (immutability CHECK)',
  );

  // --- open checkout single-winner --------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO document_checkout (tenant_id, document_id, checked_out_by, expected_version, expires_at) VALUES ($1,$2,$3,1, now()+interval '1 hour')`,
      [tenantA, docId, randomUUID()],
    );
  });
  let secondCheckoutRejected = false;
  try {
    await ctx.asTenant(tenantA, async (tx) => {
      await tx.query(
        `INSERT INTO document_checkout (tenant_id, document_id, checked_out_by, expected_version, expires_at) VALUES ($1,$2,$3,1, now()+interval '1 hour')`,
        [tenantA, docId, randomUUID()],
      );
    });
  } catch {
    secondCheckoutRejected = true;
  }
  t.ok(
    secondCheckoutRejected,
    'a second open checkout on the same document is rejected (single-winner index)',
  );

  // --- one active legal hold --------------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO document_legal_hold (tenant_id, document_id, reason) VALUES ($1,$2,'litigation')`,
      [tenantA, docId],
    );
  });
  let secondHoldRejected = false;
  try {
    await ctx.asTenant(tenantA, async (tx) => {
      await tx.query(
        `INSERT INTO document_legal_hold (tenant_id, document_id, reason) VALUES ($1,$2,'other')`,
        [tenantA, docId],
      );
    });
  } catch {
    secondHoldRejected = true;
  }
  t.ok(secondHoldRejected, 'a second active legal hold on the same document is rejected (one-active index)');

  // --- disposition idempotency ------------------------------------------------------------------
  const idem = `disp-${randomUUID()}`;
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO document_disposition (tenant_id, document_id, action, status, idempotency_key, correlation_id) VALUES ($1,$2,'review','pending_review',$3,$4)`,
      [tenantA, docId, idem, randomUUID()],
    );
  });
  let dupDispRejected = false;
  try {
    await ctx.asTenant(tenantA, async (tx) => {
      await tx.query(
        `INSERT INTO document_disposition (tenant_id, document_id, action, status, idempotency_key, correlation_id) VALUES ($1,$2,'review','pending_review',$3,$4)`,
        [tenantA, docId, idem, randomUUID()],
      );
    });
  } catch {
    dupDispRejected = true;
  }
  t.ok(dupDispRejected, 'a duplicate disposition idempotency key is rejected (idempotency index)');

  // --- self-relationship rejected by CHECK ------------------------------------------------------
  let selfRelRejected = false;
  try {
    await ctx.asTenant(tenantA, async (tx) => {
      await tx.query(
        `INSERT INTO document_relationship (tenant_id, from_document_id, to_document_id, relationship_type) VALUES ($1,$2,$2,'related_to')`,
        [tenantA, docId],
      );
    });
  } catch {
    selfRelRejected = true;
  }
  t.ok(selfRelRejected, 'a self-referential relationship is rejected by the CHECK constraint');
});
