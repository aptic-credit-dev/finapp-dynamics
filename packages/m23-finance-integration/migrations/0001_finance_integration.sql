-- ---------------------------------------------------------------------------------------------------
-- M23-finance-integration — the finance integration FOUNDATION (Stage 3, FRAMEWORK ONLY / POST-MVP). It records the
-- GOVERNED integration EXECUTION of already-approved posting intents (opaque m21 posting-request + m22 approval
-- references) against a configured external DESTINATION, with a Framework-Only lifecycle (prepared -> ready ->
-- dispatched -> acknowledged | failed -> retryable -> exhausted | cancelled), BOUNDED retry, append-only attempt +
-- history evidence, external-reference mappings and an idempotency ledger. Because NO production connector exists,
-- dispatch NEVER calls out — it records intent only (ADR-096, ADR-101). Destinations hold SECRET REFERENCES only
-- (opaque `secretref:` pointers, format-checked) — there is ZERO credential/secret/token/password column anywhere
-- (ADR-102). Money is carried as OPAQUE bigint minor-unit evidence and NEVER transformed (no float; ADR-007). M23 OWNS
-- no journals or posting requests (m21), no approval decisions (m22), no GL/bank reconciliation (m20/m15), no chart of
-- accounts (m19), no payments/AR/AP/treasury, no AI (m27). It has NO API surface, NO permission namespace, NO event
-- family and NO second outbox/workflow/timer/notification engine (naming-map authoritative). Every tenant-scoped
-- table: composite (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite FKs, `version` on
-- mutable aggregates. No DELETE grant (ADR-010); records transition by status. Destination/execution history, attempts,
-- external references and the idempotency ledger are append-only (INSERT+SELECT, 0002). Audit uses FIN_ (FIN_INTEGRATION_
-- codes; prefix shared with m19, ADR-079, non-colliding). PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

-- integration_destination — a configured external system profile (versioned; one ENABLED per system_code+scope).
-- Holds a SECRET REFERENCE (an opaque `secretref:` pointer into the platform secret store), NEVER a secret value. The
-- `allowlisted` flag is the destination allow-list gate; there is no endpoint/URL column (no external call is made).
CREATE TABLE integration_destination (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  system_code text NOT NULL, scope text NOT NULL DEFAULT 'default', version_number integer NOT NULL DEFAULT 1,
  name text, destination_type text NOT NULL DEFAULT 'generic', status text NOT NULL DEFAULT 'draft',
  allowlisted boolean NOT NULL DEFAULT false, secret_reference text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT integration_destination_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT integration_destination_id_key UNIQUE (tenant_id, id),
  CONSTRAINT integration_destination_ver_key UNIQUE (tenant_id, system_code, scope, version_number),
  CONSTRAINT integration_destination_type_ck CHECK (destination_type IN ('erp','core_banking','accounting','ledger','generic')),
  CONSTRAINT integration_destination_status_ck CHECK (status IN ('draft','enabled','disabled','retired')),
  -- SECRET REFERENCE ONLY: a `secretref:` pointer, never an inline secret (ADR-102). Mirrors engine.assertSecretReference.
  CONSTRAINT integration_destination_secretref_ck CHECK (secret_reference IS NULL OR secret_reference ~ '^secretref:[A-Za-z0-9_.:/-]{3,200}$'),
  CONSTRAINT integration_destination_optlock_ck CHECK (version >= 1));
ALTER TABLE integration_destination ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_destination FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integration_destination
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX integration_destination_one_enabled ON integration_destination (tenant_id, system_code, scope) WHERE status = 'enabled';
COMMENT ON TABLE integration_destination IS 'class=tenant_aggregate; m23 external destination profile (secret reference only; Framework Only)';

-- integration_destination_history — append-only destination lifecycle evidence.
CREATE TABLE integration_destination_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), destination_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_destination_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT integration_destination_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT integration_destination_history_dest_fkey FOREIGN KEY (tenant_id, destination_id) REFERENCES integration_destination (tenant_id, id));
ALTER TABLE integration_destination_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_destination_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integration_destination_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX integration_destination_history_by_dest ON integration_destination_history (tenant_id, destination_id);
COMMENT ON TABLE integration_destination_history IS 'class=tenant_ledger_append_only; m23 destination history';

-- integration_config — versioned integration-engine config, immutable-after-publish (one active per scope),
-- idempotency-keyed. Carries the BOUNDED retry defaults (max_attempts <= 10). No secret/endpoint columns.
CREATE TABLE integration_config (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'default', version_number integer NOT NULL DEFAULT 1, name text,
  status text NOT NULL DEFAULT 'draft', max_attempts integer NOT NULL DEFAULT 5, base_delay_ms integer NOT NULL DEFAULT 1000,
  backoff integer NOT NULL DEFAULT 2, enforce_allowlist boolean NOT NULL DEFAULT true, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT integration_config_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT integration_config_id_key UNIQUE (tenant_id, id),
  CONSTRAINT integration_config_ver_key UNIQUE (tenant_id, scope, version_number),
  CONSTRAINT integration_config_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  -- BOUNDED retry: config-level attempt ceiling can never exceed the platform maximum.
  CONSTRAINT integration_config_attempts_ck CHECK (max_attempts BETWEEN 1 AND 10),
  CONSTRAINT integration_config_delay_ck CHECK (base_delay_ms >= 0),
  CONSTRAINT integration_config_backoff_ck CHECK (backoff >= 1),
  -- The allow-list can never be turned off — governed dispatch always checks the destination allow-list.
  CONSTRAINT integration_config_allowlist_ck CHECK (enforce_allowlist = true),
  CONSTRAINT integration_config_optlock_ck CHECK (version >= 1));
ALTER TABLE integration_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integration_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX integration_config_one_active ON integration_config (tenant_id, scope) WHERE status = 'active';
CREATE UNIQUE INDEX integration_config_idem ON integration_config (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE integration_config IS 'class=tenant_aggregate; m23 integration-engine config (versioned, immutable-after-publish)';

-- integration_execution — the GOVERNED integration execution of an approved posting intent. approval_ref (m22) and
-- posting_request_ref (m21) are OPAQUE ids (no FK). amount_minor is OPAQUE bigint minor-unit EVIDENCE — carried, never
-- transformed (no float). THE FRAMEWORK-ONLY GOVERNANCE INVARIANTS are DB-enforced: an execution can only reach a
-- dispatched/acknowledged state with an m22 approval reference (no dispatch without approval), and its attempt count is
-- bounded by max_attempts (bounded retry). Idempotency-keyed (no duplicate execution).
CREATE TABLE integration_execution (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), destination_id uuid,
  posting_request_ref uuid, approval_ref uuid, subject_type text NOT NULL DEFAULT 'journal_posting',
  amount_minor bigint NOT NULL DEFAULT 0, currency_ref uuid,
  status text NOT NULL DEFAULT 'prepared', attempt_count integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5,
  last_reason_code text, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT integration_execution_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT integration_execution_id_key UNIQUE (tenant_id, id),
  CONSTRAINT integration_execution_status_ck CHECK (status IN ('prepared','ready','dispatched','acknowledged','failed','retryable','exhausted','cancelled')),
  CONSTRAINT integration_execution_amount_ck CHECK (amount_minor >= 0),
  -- BOUNDED RETRY: attempts never exceed the execution's max, and the max never exceeds the platform ceiling.
  CONSTRAINT integration_execution_maxattempts_ck CHECK (max_attempts BETWEEN 1 AND 10),
  CONSTRAINT integration_execution_attempts_ck CHECK (attempt_count >= 0 AND attempt_count <= max_attempts),
  -- NO DISPATCH WITHOUT APPROVAL: a governed execution can only be dispatched/acknowledged with an m22 approval_ref.
  CONSTRAINT integration_execution_approval_ck CHECK (status NOT IN ('dispatched','acknowledged') OR approval_ref IS NOT NULL),
  CONSTRAINT integration_execution_optlock_ck CHECK (version >= 1),
  CONSTRAINT integration_execution_dest_fkey FOREIGN KEY (tenant_id, destination_id) REFERENCES integration_destination (tenant_id, id));
ALTER TABLE integration_execution ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_execution FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integration_execution
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX integration_execution_idem ON integration_execution (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX integration_execution_by_status ON integration_execution (tenant_id, status);
CREATE INDEX integration_execution_by_approval ON integration_execution (tenant_id, approval_ref);
COMMENT ON TABLE integration_execution IS 'class=tenant_aggregate; m23 governed integration execution (Framework Only; opaque m21/m22 refs; bigint evidence)';

-- integration_execution_history — append-only execution lifecycle evidence.
CREATE TABLE integration_execution_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), execution_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_execution_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT integration_execution_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT integration_execution_history_exec_fkey FOREIGN KEY (tenant_id, execution_id) REFERENCES integration_execution (tenant_id, id));
ALTER TABLE integration_execution_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_execution_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integration_execution_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX integration_execution_history_by_exec ON integration_execution_history (tenant_id, execution_id);
COMMENT ON TABLE integration_execution_history IS 'class=tenant_ledger_append_only; m23 execution history';

-- integration_attempt — append-only per-attempt evidence (the ack/failure trail). Framework Only: a `dispatched`
-- attempt records intent, NOT the result of an external call. attempt_no is bounded (bounded retry).
CREATE TABLE integration_attempt (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), execution_id uuid NOT NULL,
  attempt_no integer NOT NULL, result text NOT NULL, reason_code text, external_ref text, message text,
  framework_only boolean NOT NULL DEFAULT true, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_attempt_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT integration_attempt_id_key UNIQUE (tenant_id, id),
  CONSTRAINT integration_attempt_no_key UNIQUE (tenant_id, execution_id, attempt_no),
  CONSTRAINT integration_attempt_result_ck CHECK (result IN ('prepared','dispatched','acknowledged','failed')),
  -- BOUNDED RETRY: an attempt number is >= 1 and never exceeds the platform ceiling.
  CONSTRAINT integration_attempt_no_ck CHECK (attempt_no >= 1 AND attempt_no <= 10),
  -- FRAMEWORK ONLY: every attempt in the MVP is framework-only (no external call was made).
  CONSTRAINT integration_attempt_frameworkonly_ck CHECK (framework_only = true),
  CONSTRAINT integration_attempt_exec_fkey FOREIGN KEY (tenant_id, execution_id) REFERENCES integration_execution (tenant_id, id));
ALTER TABLE integration_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_attempt FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integration_attempt
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX integration_attempt_by_exec ON integration_attempt (tenant_id, execution_id, attempt_no);
COMMENT ON TABLE integration_attempt IS 'class=tenant_ledger_append_only; m23 attempt evidence (Framework Only)';

-- external_reference — append-only mapping of an execution to an external system reference id (the reconciliation of
-- request/result references). No secrets; the external_ref is an opaque confirmation id string.
CREATE TABLE external_reference (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), execution_id uuid NOT NULL,
  external_system text, external_ref text NOT NULL, ref_type text NOT NULL DEFAULT 'acknowledgement', by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_reference_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT external_reference_id_key UNIQUE (tenant_id, id),
  CONSTRAINT external_reference_type_ck CHECK (ref_type IN ('acknowledgement','confirmation','correlation','failure')),
  CONSTRAINT external_reference_exec_fkey FOREIGN KEY (tenant_id, execution_id) REFERENCES integration_execution (tenant_id, id));
ALTER TABLE external_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_reference FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON external_reference
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX external_reference_by_exec ON external_reference (tenant_id, execution_id);
COMMENT ON TABLE external_reference IS 'class=tenant_ledger_append_only; m23 external reference mapping';

-- integration_idempotency — append-only idempotency/command ledger. THE "no duplicate execution/dispatch" guarantee:
-- an idempotency key is unique per tenant, so a retried command is a safe no-op, never a duplicate integration action.
CREATE TABLE integration_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, purpose text NOT NULL DEFAULT 'execution', execution_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT integration_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT integration_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT integration_idempotency_key_uk UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT integration_idempotency_purpose_ck CHECK (purpose IN ('execution','dispatch')),
  CONSTRAINT integration_idempotency_exec_fkey FOREIGN KEY (tenant_id, execution_id) REFERENCES integration_execution (tenant_id, id));
ALTER TABLE integration_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integration_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE integration_idempotency IS 'class=tenant_ledger_append_only; m23 idempotency ledger (no duplicate integration action)';
