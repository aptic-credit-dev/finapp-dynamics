-- ---------------------------------------------------------------------------------------------------
-- THE TENANT-SCOPED TABLE CONVENTION — the shape every tenant table in this platform copies.
--
-- This is a sample, not a migration. It lives outside packages/*/migrations/ so the runner never picks
-- it up; the RLS convention db-spec applies it to a throwaway table, proves isolation holds through a
-- non-owner role, then drops it (Stage 0 acceptance). Nothing survives the spec.
--
-- ADR-001 tenant-aware from day one · ADR-003 RLS FORCE + composite keys · ADR-010 soft delete
-- ---------------------------------------------------------------------------------------------------

-- A stand-in for m01's tenants table, which every composite FK ultimately points at.
CREATE TABLE rls_sample_tenant (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rls_sample_tenant_pkey PRIMARY KEY (id)
);

-- The parent tenant-scoped table.
CREATE TABLE rls_sample_parent (
  tenant_id  uuid        NOT NULL,
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  label      text        NOT NULL,

  -- ADR-010: soft delete is status + removed_at/removed_by. Never deleted_at, never a hard delete.
  status     text        NOT NULL DEFAULT 'active',
  removed_at timestamptz,
  removed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- ADR-003: the primary key is composite and tenant-first.
  CONSTRAINT rls_sample_parent_pkey PRIMARY KEY (tenant_id, id),
  -- ADR-003: no tenant_id NULL rows — enforced by NOT NULL above and by the FK below.
  CONSTRAINT rls_sample_parent_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES rls_sample_tenant (id),
  -- Required so a composite FK can reference (tenant_id, id) from a child table.
  CONSTRAINT rls_sample_parent_id_key UNIQUE (tenant_id, id),
  CONSTRAINT rls_sample_parent_removal_ck CHECK (
    (status = 'removed') = (removed_at IS NOT NULL)
  )
);

-- The child, demonstrating the composite FK.
CREATE TABLE rls_sample_child (
  tenant_id  uuid        NOT NULL,
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  parent_id  uuid        NOT NULL,
  note       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rls_sample_child_pkey PRIMARY KEY (tenant_id, id),
  -- ADR-003, the point of the whole convention: the FK carries tenant_id, so a child can only ever
  -- reference a parent IN ITS OWN TENANT. A plain FK on parent_id alone would let tenant A's child
  -- point at tenant B's parent — an orphan reference across a tenant boundary that RLS would then
  -- happily hide rather than prevent.
  CONSTRAINT rls_sample_child_parent_fkey FOREIGN KEY (tenant_id, parent_id)
    REFERENCES rls_sample_parent (tenant_id, id)
);

-- ENABLE alone exempts the table owner. FORCE is what makes the policy apply to the owner too, and is
-- non-negotiable on every tenant-scoped table (ADR-003).
ALTER TABLE rls_sample_parent ENABLE ROW LEVEL SECURITY;
ALTER TABLE rls_sample_parent FORCE  ROW LEVEL SECURITY;
ALTER TABLE rls_sample_child  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rls_sample_child  FORCE  ROW LEVEL SECURITY;

-- The policy name is `tenant_isolation` on every tenant table, so conformance can assert its presence
-- structurally across the whole schema.
--
-- Read the expression carefully — every piece of it is load-bearing:
--
--   current_setting('app.tenant_id', true)  The `true` means "missing is NULL, not an error".
--   NULLIF(..., '')                         The part that is easy to miss, and that the db-spec caught.
--
-- `current_setting(..., true)` returns NULL only when the GUC was NEVER set in the session. Once it has
-- been set even once, a transaction-local SET reverts at COMMIT to the EMPTY STRING, not to NULL. On a
-- pooled connection — which is every connection in production — the second transaction to reuse a
-- connection therefore sees '' and `''::uuid` raises `invalid input syntax for type uuid`, instead of
-- matching zero rows. NULLIF collapses both "never set" and "reset to empty" to NULL.
--
-- With the tenant NULL the comparison is NULL, which is not TRUE, so the policy matches NOTHING. Fail
-- closed: forgetting to enter tenant context yields zero rows, never all rows and never a 500.
--
-- WITH CHECK mirrors USING so a caller cannot INSERT or UPDATE a row INTO another tenant — reading and
-- writing are separately enforced.
CREATE POLICY tenant_isolation ON rls_sample_parent
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON rls_sample_child
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX rls_sample_parent_tenant_status_idx ON rls_sample_parent (tenant_id, status);
CREATE INDEX rls_sample_child_tenant_parent_idx  ON rls_sample_child  (tenant_id, parent_id);
