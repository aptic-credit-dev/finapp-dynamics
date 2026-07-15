-- ---------------------------------------------------------------------------------------------------
-- M01 — Tenancy control plane and organisational scope.
--
-- Conventions: docs/07-engineering/DATABASE_CONVENTIONS.md. The tenant_isolation policies below are the
-- Stage 0 convention VERBATIM — including NULLIF(..., ''), without which a pooled connection whose GUC
-- has reverted to the empty string raises instead of matching zero rows.
--
-- ADR-001 tenant-aware from day one · ADR-003 RLS FORCE + composite keys · ADR-010 soft delete
-- ADR-014 (new) `tenants` is RLS-protected with an explicit system-context escape.
-- ---------------------------------------------------------------------------------------------------

-- ============================================================================================
-- tenant_type_catalogue — GLOBAL reference registry (ADR-001 enumerated exception).
--
-- Reference data, identical for every tenant. No RLS: there is nothing tenant-specific to isolate, and
-- provisioning a private copy per tenant would create thousands of rows that must never diverge.
-- tenants.tenant_type is a FK to this table, so the type list cannot drift from the code that uses it.
-- ============================================================================================
CREATE TABLE tenant_type_catalogue (
  code        text        NOT NULL,
  label       text        NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_type_catalogue_pkey PRIMARY KEY (code),
  CONSTRAINT tenant_type_catalogue_code_ck CHECK (code ~ '^[a-z][a-z0-9_]{2,39}$')
);

INSERT INTO tenant_type_catalogue (code, label, sort_order) VALUES
  ('internal_entity',           'Internal entity',        10),
  ('subsidiary',                'Subsidiary',             20),
  ('enterprise_customer',       'Enterprise customer',    30),
  ('bank',                      'Bank',                   40),
  ('microfinance_institution',  'Microfinance institution', 50),
  ('insurance_business',        'Insurance business',     60),
  ('partner',                   'Partner',                70),
  ('white_label_customer',      'White-label customer',   80),
  ('sandbox',                   'Sandbox',                90),
  ('demonstration',             'Demonstration',         100);

-- ============================================================================================
-- tenants — the tenancy control plane.
--
-- ADR-014. ADR-001 permits this table to be global and non-FORCE. It is FORCEd anyway, with a policy
-- that admits either the tenant's own row or an explicit system context, because "global and unprotected"
-- means any query made in tenant context can read, count and enumerate every other tenant on the
-- platform — the tenant list is itself commercially sensitive (it is the customer list).
--
-- The escape is `app.system_context`, set ONLY by Db.withSystem (packages/kernel/src/pg-db.ts), which
-- requires a stated reason. Tenant-scoped tables below have NO escape.
-- ============================================================================================
CREATE TABLE tenants (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  code              text        NOT NULL,
  legal_name        text        NOT NULL,
  trading_name      text,
  tenant_type       text        NOT NULL,
  default_timezone  text        NOT NULL DEFAULT 'Africa/Nairobi',
  default_currency  char(3)     NOT NULL DEFAULT 'KES',
  country           char(2)     NOT NULL DEFAULT 'KE',
  status            text        NOT NULL DEFAULT 'draft',

  -- Lifecycle timestamps. Nullable because a tenant that was never suspended has no suspension date —
  -- a sentinel would be a lie that reporting would later average.
  activated_at      timestamptz,
  suspended_at      timestamptz,
  closed_at         timestamptz,

  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Optimistic concurrency. Two administrators editing the same tenant must not silently overwrite each
  -- other; the loser gets a 409 and re-reads.
  version           integer     NOT NULL DEFAULT 1,

  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenants_pkey PRIMARY KEY (id),
  -- Required so tenant-scoped children can carry a composite FK back to (id).
  CONSTRAINT tenants_code_key UNIQUE (code),
  CONSTRAINT tenants_type_fkey FOREIGN KEY (tenant_type) REFERENCES tenant_type_catalogue (code),
  CONSTRAINT tenants_code_ck CHECK (code ~ '^[a-z][a-z0-9_]{2,39}$'),
  CONSTRAINT tenants_currency_ck CHECK (default_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT tenants_country_ck CHECK (country ~ '^[A-Z]{2}$'),
  CONSTRAINT tenants_version_ck CHECK (version >= 1),
  CONSTRAINT tenants_status_ck CHECK (status IN (
    'draft', 'under_review', 'approved', 'rejected', 'provisioning',
    'provisioning_failed', 'active', 'restricted', 'suspended', 'closed'
  )),
  -- The timestamp and the status cannot disagree. Without this, a row can claim status='active' with no
  -- activated_at, and every downstream report that trusts either column is wrong.
  CONSTRAINT tenants_activated_ck CHECK (status <> 'active' OR activated_at IS NOT NULL),
  CONSTRAINT tenants_suspended_ck CHECK (status <> 'suspended' OR suspended_at IS NOT NULL),
  CONSTRAINT tenants_closed_ck CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenants
  USING (
        id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  )
  WITH CHECK (
        id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  );

CREATE INDEX tenants_status_idx ON tenants (status);
CREATE INDEX tenants_type_idx   ON tenants (tenant_type);

-- ============================================================================================
-- tenant_status_history — append-only lifecycle record. TENANT-SCOPED.
--
-- Every transition is written here in the same transaction as the tenants.status update, so the history
-- can never disagree with the current state. There is no UPDATE or DELETE grant in the application role;
-- history is written once and read forever.
-- ============================================================================================
CREATE TABLE tenant_status_history (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  from_status    text,
  to_status      text        NOT NULL,
  action         text        NOT NULL,
  reason         text,
  correlation_id text        NOT NULL,
  changed_by     uuid,
  changed_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenant_status_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT tenant_status_history_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  -- from_status is null only for the very first row (creation). Anything else is a lost transition.
  CONSTRAINT tenant_status_history_from_ck CHECK (from_status IS NOT NULL OR action = 'create')
);

ALTER TABLE tenant_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_status_history FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant_status_history
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX tenant_status_history_tenant_changed_idx ON tenant_status_history (tenant_id, changed_at DESC);

-- ============================================================================================
-- tenant_environments — TENANT-SCOPED.
-- ============================================================================================
CREATE TABLE tenant_environments (
  tenant_id           uuid        NOT NULL,
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  code                text        NOT NULL,
  environment_type    text        NOT NULL,
  region              text,
  status              text        NOT NULL DEFAULT 'planned',
  is_default          boolean     NOT NULL DEFAULT false,
  provisioning_status text        NOT NULL DEFAULT 'not_started',

  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer     NOT NULL DEFAULT 1,

  CONSTRAINT tenant_environments_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT tenant_environments_id_key UNIQUE (tenant_id, id),
  CONSTRAINT tenant_environments_code_key UNIQUE (tenant_id, code),
  CONSTRAINT tenant_environments_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT tenant_environments_code_ck CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  CONSTRAINT tenant_environments_type_ck CHECK (environment_type IN
    ('production', 'sandbox', 'uat', 'training', 'demonstration')),
  CONSTRAINT tenant_environments_status_ck CHECK (status IN ('planned', 'active', 'suspended', 'retired')),
  CONSTRAINT tenant_environments_prov_ck CHECK (provisioning_status IN
    ('not_started', 'in_progress', 'provisioned', 'failed'))
);

ALTER TABLE tenant_environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_environments FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant_environments
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- At most one default environment per tenant. A partial unique index rather than a trigger: "which
-- environment do I use by default" must have exactly one answer, enforced by the database.
CREATE UNIQUE INDEX tenant_environments_one_default_idx
  ON tenant_environments (tenant_id) WHERE is_default;

CREATE INDEX tenant_environments_tenant_type_idx ON tenant_environments (tenant_id, environment_type);

-- ============================================================================================
-- tenant_entities — subsidiaries / legal entities. TENANT-SCOPED.
--
-- ADR-014: docs/03-platform/SAAS_FOUNDATION.md lists subsidiaries among the global control-plane tables.
-- They are tenant-scoped and FORCEd here instead. A subsidiary belongs to exactly one tenant and carries
-- tenant_id, which is ADR-003's definition of tenant-scoped; leaving it global would expose one tenant's
-- corporate structure to every other tenant.
-- ============================================================================================
CREATE TABLE tenant_entities (
  tenant_id        uuid        NOT NULL,
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  code             text        NOT NULL,
  legal_name       text        NOT NULL,
  trading_name     text,
  parent_entity_id uuid,
  country          char(2),
  status           text        NOT NULL DEFAULT 'active',
  effective_from   timestamptz NOT NULL DEFAULT now(),
  effective_to     timestamptz,

  removed_at  timestamptz,
  removed_by  uuid,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer     NOT NULL DEFAULT 1,

  CONSTRAINT tenant_entities_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT tenant_entities_id_key UNIQUE (tenant_id, id),
  CONSTRAINT tenant_entities_code_key UNIQUE (tenant_id, code),
  CONSTRAINT tenant_entities_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  -- The composite FK is the point (ADR-003): tenant_id travels with the reference, so an entity can only
  -- ever parent an entity IN ITS OWN TENANT. A plain FK on parent_entity_id alone would let tenant A's
  -- subsidiary point at tenant B's, and RLS would then hide the orphan rather than prevent it.
  CONSTRAINT tenant_entities_parent_fkey FOREIGN KEY (tenant_id, parent_entity_id)
    REFERENCES tenant_entities (tenant_id, id),
  CONSTRAINT tenant_entities_code_ck CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  CONSTRAINT tenant_entities_status_ck CHECK (status IN ('active', 'inactive', 'removed')),
  CONSTRAINT tenant_entities_removal_ck CHECK ((status = 'removed') = (removed_at IS NOT NULL)),
  CONSTRAINT tenant_entities_dates_ck CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- Cheap half of cycle prevention. A → A is catchable here; A → B → A is not expressible in a CHECK and
  -- is rejected in the service (domain/org.ts wouldCreateCycle).
  CONSTRAINT tenant_entities_self_parent_ck CHECK (parent_entity_id IS NULL OR parent_entity_id <> id)
);

ALTER TABLE tenant_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_entities FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant_entities
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX tenant_entities_tenant_status_idx ON tenant_entities (tenant_id, status);
CREATE INDEX tenant_entities_parent_idx        ON tenant_entities (tenant_id, parent_entity_id);

-- ============================================================================================
-- tenant_departments — TENANT-SCOPED. Belongs to an entity; may nest within its own kind.
-- ============================================================================================
CREATE TABLE tenant_departments (
  tenant_id            uuid        NOT NULL,
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  entity_id            uuid        NOT NULL,
  parent_department_id uuid,
  code                 text        NOT NULL,
  name                 text        NOT NULL,
  status               text        NOT NULL DEFAULT 'active',
  effective_from       timestamptz NOT NULL DEFAULT now(),
  effective_to         timestamptz,

  removed_at  timestamptz,
  removed_by  uuid,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer     NOT NULL DEFAULT 1,

  CONSTRAINT tenant_departments_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT tenant_departments_id_key UNIQUE (tenant_id, id),
  CONSTRAINT tenant_departments_code_key UNIQUE (tenant_id, code),
  CONSTRAINT tenant_departments_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT tenant_departments_entity_fkey FOREIGN KEY (tenant_id, entity_id)
    REFERENCES tenant_entities (tenant_id, id),
  CONSTRAINT tenant_departments_parent_fkey FOREIGN KEY (tenant_id, parent_department_id)
    REFERENCES tenant_departments (tenant_id, id),
  CONSTRAINT tenant_departments_code_ck CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  CONSTRAINT tenant_departments_status_ck CHECK (status IN ('active', 'inactive', 'removed')),
  CONSTRAINT tenant_departments_removal_ck CHECK ((status = 'removed') = (removed_at IS NOT NULL)),
  CONSTRAINT tenant_departments_dates_ck CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT tenant_departments_self_parent_ck CHECK (parent_department_id IS NULL OR parent_department_id <> id)
);

ALTER TABLE tenant_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_departments FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant_departments
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX tenant_departments_tenant_entity_idx ON tenant_departments (tenant_id, entity_id);
CREATE INDEX tenant_departments_parent_idx        ON tenant_departments (tenant_id, parent_department_id);

-- ============================================================================================
-- tenant_branches — TENANT-SCOPED. Attaches to an entity. Branches do not nest (domain/org.ts).
-- ============================================================================================
CREATE TABLE tenant_branches (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  entity_id      uuid        NOT NULL,
  code           text        NOT NULL,
  name           text        NOT NULL,
  country        char(2),
  status         text        NOT NULL DEFAULT 'active',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,

  removed_at  timestamptz,
  removed_by  uuid,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer     NOT NULL DEFAULT 1,

  CONSTRAINT tenant_branches_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT tenant_branches_id_key UNIQUE (tenant_id, id),
  CONSTRAINT tenant_branches_code_key UNIQUE (tenant_id, code),
  CONSTRAINT tenant_branches_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT tenant_branches_entity_fkey FOREIGN KEY (tenant_id, entity_id)
    REFERENCES tenant_entities (tenant_id, id),
  CONSTRAINT tenant_branches_code_ck CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  CONSTRAINT tenant_branches_status_ck CHECK (status IN ('active', 'inactive', 'removed')),
  CONSTRAINT tenant_branches_removal_ck CHECK ((status = 'removed') = (removed_at IS NOT NULL)),
  CONSTRAINT tenant_branches_dates_ck CHECK (effective_to IS NULL OR effective_to > effective_from)
);

ALTER TABLE tenant_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_branches FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant_branches
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX tenant_branches_tenant_entity_idx ON tenant_branches (tenant_id, entity_id);
