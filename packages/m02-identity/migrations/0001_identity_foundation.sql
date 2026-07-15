-- ---------------------------------------------------------------------------------------------------
-- M02 (Stage 1B) — identity, account and tenant-membership foundation.
--
-- Conventions: docs/07-engineering/DATABASE_CONVENTIONS.md. The tenant_isolation policies are the Stage 0
-- convention VERBATIM, NULLIF(..., '') included.
--
-- THE SPLIT (ADR-014 pattern, extended to identity):
--   identities / user_accounts / authentication_subjects  -> GLOBAL control plane, RLS FORCE + system escape
--   tenant_memberships and every *_status_history         -> TENANT-SCOPED, RLS FORCE, NO escape
--
-- Why identities are global: a person exists before any tenant and may belong to several. An identity
-- confined to one tenant could not be the same person in two, so the platform would need a duplicate —
-- and duplicated people are how a leaver is offboarded from one tenant and silently retained in another.
-- Membership is the tenant-scoped part, so a tenant sees its own members and nothing else.
--
-- NOT IN THIS STAGE: no passwords, no credentials, no sessions, no refresh tokens, no login_attempts
-- (Stage 1C); no roles, permissions, user_roles or role_permissions (Stage 1D).
-- ---------------------------------------------------------------------------------------------------

-- ============================================================================================
-- Reference catalogues — GLOBAL reference registries (ADR-001 enumerated exception). No RLS.
-- FK-backed so the type lists cannot drift from the code that uses them.
-- ============================================================================================
CREATE TABLE identity_type_catalogue (
  code       text        NOT NULL,
  label      text        NOT NULL,
  is_human   boolean     NOT NULL DEFAULT true,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_type_catalogue_pkey PRIMARY KEY (code)
);

INSERT INTO identity_type_catalogue (code, label, is_human) VALUES
  ('internal_person',  'Internal person',  true),
  ('external_person',  'External person',  true),
  ('contractor',       'Contractor',       true),
  ('partner_user',     'Partner user',     true),
  ('service_identity', 'Service identity', false),
  ('system_identity',  'System identity',  false);

CREATE TABLE account_type_catalogue (
  code       text        NOT NULL,
  label      text        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_type_catalogue_pkey PRIMARY KEY (code)
);

INSERT INTO account_type_catalogue (code, label) VALUES
  ('human',       'Human'),
  ('service',     'Service'),
  ('system',      'System'),
  ('integration', 'Integration');

CREATE TABLE membership_type_catalogue (
  code       text        NOT NULL,
  label      text        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_type_catalogue_pkey PRIMARY KEY (code)
);

INSERT INTO membership_type_catalogue (code, label) VALUES
  ('employee',   'Employee'),
  ('contractor', 'Contractor'),
  ('partner',    'Partner'),
  ('external',   'External'),
  ('service',    'Service');

-- ============================================================================================
-- identities — GLOBAL control plane. RLS FORCE + system escape (ADR-014 pattern).
--
-- There is no `tenant_id` here BY DESIGN, so the policy cannot be the standard one. Reading an identity
-- requires system context, which Db.withSystem grants only with a stated reason. A tenant reaches its
-- people through tenant_memberships, which IS tenant-scoped and has no escape.
--
-- NO PASSWORD, NO CREDENTIAL, NO SECRET (§4.1, ADR-009).
-- ============================================================================================
CREATE TABLE identities (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  identity_type       text        NOT NULL,
  display_name        text        NOT NULL,
  given_name          text,
  family_name         text,
  primary_email       text,
  primary_email_norm  text,
  primary_phone       text,
  organization_ref    text,
  external_ref        text,
  status              text        NOT NULL DEFAULT 'draft',
  data_classification text        NOT NULL DEFAULT 'confidential',

  version    integer     NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT identities_pkey PRIMARY KEY (id),
  CONSTRAINT identities_type_fkey FOREIGN KEY (identity_type) REFERENCES identity_type_catalogue (code),
  CONSTRAINT identities_status_ck CHECK (status IN
    ('draft', 'active', 'inactive', 'suspended', 'rejected', 'archived', 'closed')),
  -- Identity data is personal data (Kenya DPA; OPEN_QUESTIONS #6/#7). The default is the strict end, and
  -- `public` is deliberately not an option for a natural person.
  CONSTRAINT identities_classification_ck CHECK (data_classification IN ('internal', 'confidential', 'restricted')),
  CONSTRAINT identities_version_ck CHECK (version >= 1),
  -- The normalized column exists only to be compared. Storing one without the original loses the address
  -- the person actually gave us; storing the original without the normalized makes uniqueness a guess.
  CONSTRAINT identities_email_pair_ck CHECK ((primary_email IS NULL) = (primary_email_norm IS NULL)),
  -- Biconditional, and deliberately so: a person MUST have an email, and a machine MUST NOT.
  --
  -- The one-directional form (`type IN (machine) OR email IS NOT NULL`) only enforces the first half,
  -- which leaves a service identity free to carry a mailbox — and the email column is exactly what makes
  -- an identity findable and contactable as a human. A machine principal with an email is a person in
  -- disguise. The service enforces this too; the constraint is what makes it true even for a caller that
  -- bypasses the service.
  CONSTRAINT identities_human_email_ck CHECK (
    (identity_type IN ('service_identity', 'system_identity')) = (primary_email IS NULL)
  )
);

ALTER TABLE identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE identities FORCE  ROW LEVEL SECURITY;

-- Global control plane: readable ONLY in system context. There is no tenant column to compare against,
-- so unlike m01's tenants there is no "own row" branch — the escape is the only way in.
CREATE POLICY tenant_isolation ON identities
  USING      (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on')
  WITH CHECK (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on');

-- Email uniqueness is GLOBAL, not per tenant: two tenants sharing a human must share the identity, or
-- offboarding one silently leaves the other. Partial, because machine identities have no email.
CREATE UNIQUE INDEX identities_email_norm_key ON identities (primary_email_norm)
  WHERE primary_email_norm IS NOT NULL;
CREATE INDEX identities_status_idx ON identities (status);
CREATE INDEX identities_type_idx   ON identities (identity_type);

-- ============================================================================================
-- user_accounts — GLOBAL control plane. RLS FORCE + system escape.
--
-- An account is HOW an identity authenticates. Separate from the identity because one person may hold a
-- human login and a break-glass account, and because a service identity has an account but no person.
--
-- NO password_hash. NO credential. NO secret. Stage 1C owns those (§4.2, ADR-009).
-- ============================================================================================
CREATE TABLE user_accounts (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  identity_id           uuid        NOT NULL,
  account_type          text        NOT NULL,
  login_identifier      text        NOT NULL,
  login_identifier_norm text        NOT NULL,

  -- Readiness columns for Stage 1C. Declared now so 1C adds behaviour, not schema churn; nothing in 1B
  -- ever writes them.
  auth_provider_ref     text,
  locked_at             timestamptz,
  last_authenticated_at timestamptz,

  status       text        NOT NULL DEFAULT 'pending_activation',
  activated_at timestamptz,
  suspended_at timestamptz,

  version    integer     NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT user_accounts_identity_fkey FOREIGN KEY (identity_id) REFERENCES identities (id),
  CONSTRAINT user_accounts_type_fkey FOREIGN KEY (account_type) REFERENCES account_type_catalogue (code),
  CONSTRAINT user_accounts_status_ck CHECK (status IN
    ('pending_activation', 'active', 'suspended', 'deactivated', 'locked', 'expired')),
  CONSTRAINT user_accounts_version_ck CHECK (version >= 1),
  CONSTRAINT user_accounts_activated_ck CHECK (status <> 'active' OR activated_at IS NOT NULL),
  CONSTRAINT user_accounts_suspended_ck CHECK (status <> 'suspended' OR suspended_at IS NOT NULL)
);

ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_accounts FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON user_accounts
  USING      (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on')
  WITH CHECK (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on');

-- The login identifier is globally unique. §7 warns against assuming email is globally unique — this is
-- the LOGIN, not the email: two accounts answering to the same login string is an authentication
-- ambiguity no provider can resolve later.
CREATE UNIQUE INDEX user_accounts_login_norm_key ON user_accounts (login_identifier_norm);
CREATE INDEX user_accounts_identity_idx ON user_accounts (identity_id);
CREATE INDEX user_accounts_status_idx   ON user_accounts (status);

-- ============================================================================================
-- authentication_subjects — GLOBAL. READINESS ONLY (§4.4).
--
-- Maps an external IdP subject to an account. REFERENCES ONLY — no tokens, no secrets, no client
-- credentials (ADR-009: no raw key storage). Stage 1B never authenticates against it.
-- ============================================================================================
CREATE TABLE authentication_subjects (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  account_id     uuid        NOT NULL,
  provider_code  text        NOT NULL,
  issuer         text        NOT NULL,
  subject        text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  last_verified_at timestamptz,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT authentication_subjects_pkey PRIMARY KEY (id),
  CONSTRAINT authentication_subjects_account_fkey FOREIGN KEY (account_id) REFERENCES user_accounts (id),
  CONSTRAINT authentication_subjects_status_ck CHECK (status IN ('active', 'revoked')),
  CONSTRAINT authentication_subjects_provider_ck CHECK (provider_code ~ '^[a-z][a-z0-9_]{1,39}$')
);

ALTER TABLE authentication_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE authentication_subjects FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON authentication_subjects
  USING      (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on')
  WITH CHECK (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on');

-- (issuer, subject) — NOT subject alone. A subject is only unique within its issuer, so two IdPs may both
-- legitimately issue subject "12345"; keying on subject alone would let a second IdP's user collide with,
-- and potentially take over, an existing account.
CREATE UNIQUE INDEX authentication_subjects_issuer_subject_key
  ON authentication_subjects (issuer, subject);
CREATE INDEX authentication_subjects_account_idx ON authentication_subjects (account_id);

-- ============================================================================================
-- tenant_memberships — TENANT-SCOPED. RLS FORCE, NO system escape.
--
-- THE JOIN, and the only part of identity a tenant may see. This is what M01 could not check: the tenant
-- resolver proved the tenant was real, not that the caller belonged to it.
-- ============================================================================================
CREATE TABLE tenant_memberships (
  tenant_id       uuid        NOT NULL,
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  identity_id     uuid        NOT NULL,
  account_id      uuid,
  membership_type text        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending',
  is_primary      boolean     NOT NULL DEFAULT false,

  start_date timestamptz NOT NULL DEFAULT now(),
  end_date   timestamptz,

  -- Readiness (§4.3). Composite FKs into m01's org tree, so a scope can only ever name a node in THIS
  -- tenant. Nullable: an unscoped membership is tenant-wide.
  sponsor_identity_id uuid,
  entity_id           uuid,
  department_id       uuid,
  branch_id           uuid,
  environment_id      uuid,

  version    integer     NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenant_memberships_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT tenant_memberships_id_key UNIQUE (tenant_id, id),
  CONSTRAINT tenant_memberships_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT tenant_memberships_identity_fkey FOREIGN KEY (identity_id) REFERENCES identities (id),
  CONSTRAINT tenant_memberships_account_fkey FOREIGN KEY (account_id) REFERENCES user_accounts (id),
  CONSTRAINT tenant_memberships_type_fkey FOREIGN KEY (membership_type)
    REFERENCES membership_type_catalogue (code),
  -- Composite FKs (ADR-003): tenant_id travels with every scope reference, so a membership in tenant A
  -- cannot be scoped to tenant B's department. A plain FK would let RLS hide the cross-tenant orphan
  -- rather than prevent it.
  CONSTRAINT tenant_memberships_entity_fkey FOREIGN KEY (tenant_id, entity_id)
    REFERENCES tenant_entities (tenant_id, id),
  CONSTRAINT tenant_memberships_department_fkey FOREIGN KEY (tenant_id, department_id)
    REFERENCES tenant_departments (tenant_id, id),
  CONSTRAINT tenant_memberships_branch_fkey FOREIGN KEY (tenant_id, branch_id)
    REFERENCES tenant_branches (tenant_id, id),
  CONSTRAINT tenant_memberships_environment_fkey FOREIGN KEY (tenant_id, environment_id)
    REFERENCES tenant_environments (tenant_id, id),
  CONSTRAINT tenant_memberships_status_ck CHECK (status IN ('pending', 'active', 'suspended', 'ended')),
  CONSTRAINT tenant_memberships_version_ck CHECK (version >= 1),
  CONSTRAINT tenant_memberships_dates_ck CHECK (end_date IS NULL OR end_date > start_date),
  CONSTRAINT tenant_memberships_ended_ck CHECK ((status = 'ended') = (end_date IS NOT NULL))
);

ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE  ROW LEVEL SECURITY;

-- The Stage 0 convention verbatim. NO system escape: withSystem can read the identity control plane and
-- sees NOTHING here, so it cannot become a way to enumerate another tenant's people.
CREATE POLICY tenant_isolation ON tenant_memberships
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- One LIVE membership per identity per tenant. Partial on the non-terminal statuses, so a leaver can
-- return later with a NEW membership while the ended one stays as the record that the gap existed.
CREATE UNIQUE INDEX tenant_memberships_one_live_idx
  ON tenant_memberships (tenant_id, identity_id) WHERE status <> 'ended';
-- At most one primary tenant per identity is NOT enforceable here: the index would have to span tenants,
-- and this table is tenant-scoped. Enforced in the service, in system context, and stated in the README.
CREATE UNIQUE INDEX tenant_memberships_one_primary_idx
  ON tenant_memberships (tenant_id, identity_id) WHERE is_primary AND status <> 'ended';
CREATE INDEX tenant_memberships_identity_idx ON tenant_memberships (tenant_id, identity_id);
CREATE INDEX tenant_memberships_account_idx  ON tenant_memberships (tenant_id, account_id);
CREATE INDEX tenant_memberships_status_idx   ON tenant_memberships (tenant_id, status);

-- ============================================================================================
-- Status histories — append-only. INSERT+SELECT only; the app role holds no UPDATE/DELETE (see 0002).
--
-- identity_ and account_status_history are GLOBAL (their subjects are); membership history is
-- tenant-scoped, like its subject.
-- ============================================================================================
CREATE TABLE identity_status_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  identity_id    uuid        NOT NULL,
  from_status    text,
  to_status      text        NOT NULL,
  action         text        NOT NULL,
  reason         text,
  correlation_id text        NOT NULL,
  changed_by     uuid,
  changed_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_status_history_pkey PRIMARY KEY (id),
  CONSTRAINT identity_status_history_identity_fkey FOREIGN KEY (identity_id) REFERENCES identities (id),
  CONSTRAINT identity_status_history_from_ck CHECK (from_status IS NOT NULL OR action = 'create')
);

ALTER TABLE identity_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON identity_status_history
  USING      (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on')
  WITH CHECK (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on');
CREATE INDEX identity_status_history_identity_idx ON identity_status_history (identity_id, changed_at DESC);

CREATE TABLE account_status_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  account_id     uuid        NOT NULL,
  from_status    text,
  to_status      text        NOT NULL,
  action         text        NOT NULL,
  reason         text,
  correlation_id text        NOT NULL,
  changed_by     uuid,
  changed_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_status_history_pkey PRIMARY KEY (id),
  CONSTRAINT account_status_history_account_fkey FOREIGN KEY (account_id) REFERENCES user_accounts (id),
  CONSTRAINT account_status_history_from_ck CHECK (from_status IS NOT NULL OR action = 'create')
);

ALTER TABLE account_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON account_status_history
  USING      (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on')
  WITH CHECK (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on');
CREATE INDEX account_status_history_account_idx ON account_status_history (account_id, changed_at DESC);

CREATE TABLE membership_status_history (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  membership_id  uuid        NOT NULL,
  from_status    text,
  to_status      text        NOT NULL,
  action         text        NOT NULL,
  reason         text,
  correlation_id text        NOT NULL,
  changed_by     uuid,
  changed_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_status_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT membership_status_history_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT membership_status_history_membership_fkey FOREIGN KEY (tenant_id, membership_id)
    REFERENCES tenant_memberships (tenant_id, id),
  CONSTRAINT membership_status_history_from_ck CHECK (from_status IS NOT NULL OR action = 'create')
);

ALTER TABLE membership_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON membership_status_history
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX membership_status_history_membership_idx
  ON membership_status_history (tenant_id, membership_id, changed_at DESC);
