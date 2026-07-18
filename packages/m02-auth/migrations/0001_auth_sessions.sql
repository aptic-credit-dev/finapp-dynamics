-- ==================================================================================================
-- M02-auth (Stage 1C) — authentication credentials, login attempts, and revocable sessions.
--
-- ALL account-plane, GLOBAL, RLS FORCE + system escape (ADR-014 pattern, identical to the identity plane
-- in m02-identity/0001). There is no tenant that OWNS a credential or a session: authentication is a
-- global account act, and tenant reach stays a membership question (tenant_memberships, no escape). A
-- tenant context can therefore never see another account's credentials or sessions — it never enters this
-- plane at all. Reads/writes happen only inside Db.withSystem (a stated reason).
--
-- NO PLAINTEXT ANYWHERE (ADR-009, no raw key storage):
--   * passwords      -> `secret_hash` (Argon2id PHC string; salt embedded)
--   * session tokens -> `token_hash` / `refresh_token_hash` (SHA-256 of a 256-bit random secret)
--   * login ids      -> `login_ref_hash` (SHA-256; the identifier itself is never stored here)
-- Column NAMES deliberately avoid `password`/`token`/`secret` (unsuffixed) so a conformance check can
-- assert by name that no plaintext credential column exists.
--
-- NO DELETE privilege is granted (0002): credentials, sessions and attempts are retired by status or aged
-- out by a privileged maintenance job — never removed by the application (ADR-010).
-- ==================================================================================================

-- --------------------------------------------------------------------------------------------------
-- authentication_credentials — one ACTIVE password credential per account (partial unique index).
-- --------------------------------------------------------------------------------------------------
CREATE TABLE authentication_credentials (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  account_id      uuid        NOT NULL,
  credential_type text        NOT NULL DEFAULT 'password',
  algorithm       text        NOT NULL,
  params          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  secret_hash     text        NOT NULL,
  status          text        NOT NULL DEFAULT 'active',
  version         integer     NOT NULL DEFAULT 1,

  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_changed_at timestamptz NOT NULL DEFAULT now(),
  disabled_at     timestamptz,
  disabled_reason text,

  CONSTRAINT authentication_credentials_pkey PRIMARY KEY (id),
  CONSTRAINT authentication_credentials_account_fkey FOREIGN KEY (account_id) REFERENCES user_accounts (id),
  CONSTRAINT authentication_credentials_type_ck CHECK (credential_type IN ('password')),
  CONSTRAINT authentication_credentials_status_ck CHECK (status IN ('active', 'disabled')),
  CONSTRAINT authentication_credentials_version_ck CHECK (version >= 1),
  CONSTRAINT authentication_credentials_disabled_ck CHECK (status <> 'disabled' OR disabled_at IS NOT NULL)
);

-- At most one live password credential per account.
CREATE UNIQUE INDEX authentication_credentials_one_active
  ON authentication_credentials (account_id, credential_type) WHERE status = 'active';

ALTER TABLE authentication_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE authentication_credentials FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON authentication_credentials
  USING      (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on')
  WITH CHECK (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on');

-- --------------------------------------------------------------------------------------------------
-- login_attempts — GLOBAL and PRE-AUTHENTICATION (ADR-001 enumerated exception). No actor, no tenant when
-- written. The supplied password is NEVER stored; the identifier is stored only as a one-way ref hash.
-- --------------------------------------------------------------------------------------------------
CREATE TABLE login_attempts (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  login_ref_hash text        NOT NULL,
  account_id     uuid,
  outcome        text        NOT NULL,
  failure_reason text,
  client_ip      text,
  user_agent     text,
  correlation_id uuid        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT login_attempts_pkey PRIMARY KEY (id),
  CONSTRAINT login_attempts_account_fkey FOREIGN KEY (account_id) REFERENCES user_accounts (id),
  CONSTRAINT login_attempts_outcome_ck CHECK (outcome IN ('succeeded', 'failed')),
  CONSTRAINT login_attempts_reason_ck CHECK (outcome <> 'failed' OR failure_reason IS NOT NULL)
);

CREATE INDEX login_attempts_by_ref  ON login_attempts (login_ref_hash, created_at DESC);
CREATE INDEX login_attempts_by_acct ON login_attempts (account_id, created_at DESC);
CREATE INDEX login_attempts_by_ip   ON login_attempts (client_ip, created_at DESC);

ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON login_attempts
  USING      (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on')
  WITH CHECK (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on');

-- --------------------------------------------------------------------------------------------------
-- sessions — opaque, revocable (ADR-015). token_hash/refresh_token_hash are SHA-256 of random secrets.
-- --------------------------------------------------------------------------------------------------
CREATE TABLE sessions (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  account_id          uuid        NOT NULL,
  identity_id         uuid        NOT NULL,
  token_hash          text        NOT NULL,
  rotation_family     uuid        NOT NULL,
  token_version       integer     NOT NULL DEFAULT 1,
  assurance           text        NOT NULL,

  authenticated_at    timestamptz NOT NULL DEFAULT now(),
  issued_at           timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz NOT NULL DEFAULT now(),
  idle_expires_at     timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,

  status              text        NOT NULL DEFAULT 'active',
  revoked_at          timestamptz,
  revoked_reason      text,

  client_ip           text,
  user_agent          text,
  selected_tenant_id  uuid,

  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sessions_pkey PRIMARY KEY (id),
  CONSTRAINT sessions_account_fkey  FOREIGN KEY (account_id)  REFERENCES user_accounts (id),
  CONSTRAINT sessions_identity_fkey FOREIGN KEY (identity_id) REFERENCES identities (id),
  CONSTRAINT sessions_assurance_ck  CHECK (assurance IN ('password', 'mfa', 'federated')),
  CONSTRAINT sessions_status_ck     CHECK (status IN ('active', 'revoked', 'expired')),
  CONSTRAINT sessions_version_ck     CHECK (token_version >= 1),
  CONSTRAINT sessions_revoked_ck    CHECK (status <> 'revoked' OR revoked_at IS NOT NULL),
  CONSTRAINT sessions_expiry_ck     CHECK (idle_expires_at <= absolute_expires_at)
);

-- A token maps to at most one session (it is the access credential presented every request).
CREATE UNIQUE INDEX sessions_token_hash ON sessions (token_hash);
CREATE INDEX sessions_by_account ON sessions (account_id, status);
CREATE INDEX sessions_by_family  ON sessions (rotation_family);
CREATE INDEX sessions_expiry     ON sessions (absolute_expires_at) WHERE status = 'active';

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sessions
  USING      (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on')
  WITH CHECK (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on');

-- --------------------------------------------------------------------------------------------------
-- session_refresh_tokens — the rotation ledger. One row per refresh secret ever issued in a family.
-- Reuse detection lives here: a refresh secret is CONSUMED exactly once; presenting a consumed one is
-- theft, and the whole family is revoked. Hash-only (SHA-256 of a 256-bit random secret), never raw.
-- --------------------------------------------------------------------------------------------------
CREATE TABLE session_refresh_tokens (
  refresh_token_hash text        NOT NULL,
  session_id         uuid        NOT NULL,
  account_id         uuid        NOT NULL,
  rotation_family    uuid        NOT NULL,
  token_version      integer     NOT NULL,
  issued_at          timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  consumed_at        timestamptz,

  CONSTRAINT session_refresh_tokens_pkey PRIMARY KEY (refresh_token_hash),
  CONSTRAINT session_refresh_tokens_session_fkey FOREIGN KEY (session_id) REFERENCES sessions (id)
);

CREATE INDEX session_refresh_tokens_by_family ON session_refresh_tokens (rotation_family);

ALTER TABLE session_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_refresh_tokens FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON session_refresh_tokens
  USING      (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on')
  WITH CHECK (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on');

-- --------------------------------------------------------------------------------------------------
-- session_status_history — append-only (INSERT + SELECT only, enforced by privilege in 0002).
-- --------------------------------------------------------------------------------------------------
CREATE TABLE session_status_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  session_id     uuid        NOT NULL,
  account_id     uuid        NOT NULL,
  from_status    text,
  to_status      text        NOT NULL,
  action         text        NOT NULL,
  reason         text,
  token_version  integer     NOT NULL,
  correlation_id uuid        NOT NULL,
  changed_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT session_status_history_pkey PRIMARY KEY (id),
  CONSTRAINT session_status_history_session_fkey FOREIGN KEY (session_id) REFERENCES sessions (id),
  CONSTRAINT session_status_history_from_ck CHECK (from_status IS NOT NULL OR action = 'issue')
);

CREATE INDEX session_status_history_by_session ON session_status_history (session_id, created_at);

ALTER TABLE session_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON session_status_history
  USING      (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on')
  WITH CHECK (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on');
