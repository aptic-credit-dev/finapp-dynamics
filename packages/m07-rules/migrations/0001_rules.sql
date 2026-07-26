-- ---------------------------------------------------------------------------------------------------
-- M07-rules — the versioned, explainable decision-rules engine (Stage 2.3).
--
-- Tenant-scoped tables follow the proven convention: composite (tenant_id, id) primary keys, UNIQUE
-- (tenant_id, id) so composite foreign keys can reference them, RLS ENABLE + FORCE with the standard
-- `tenant_isolation` policy, and a `version` column for optimistic concurrency on mutable aggregates. No
-- table grants DELETE (records retire by status; ADR-010). Evidence + history are append-only (INSERT +
-- SELECT only, granted in 0002) so the application literally cannot rewrite them (ADR-005).
--
-- A rule_set_version stores its whole validated definition as an immutable `spec` JSON (ADR-032): field
-- schemas, derived fields, decision tables, hit policies, input/output schemas — all inside `spec`, not
-- shredded into rows. Determinism and immutability come from freezing that document at publish (content_hash).
-- Evaluation evidence stores the INPUT HASH and a redacted structured explanation (reason codes, matched
-- ids, outputs) — never the raw, possibly-sensitive input values (ADR-035). m07 publishes its domain events
-- through the ONE outbox m06 owns; it never creates a second outbox.
-- ---------------------------------------------------------------------------------------------------

-- Seed m07's permissions into the global permission catalogue (owned by m02, a global reference table).
-- role_permissions.permission_code FKs to permissions.code, so a rules permission must exist here before any
-- role can be granted it. Adding them with the module (CLAUDE.md). Publish/activate/retire and the platform
-- authority are privileged; there is deliberately no vague `rules.admin` (ADR-037).
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('rules.engine.view', 'm07-rules', 'rule_set', false),
  ('rules.engine.author', 'm07-rules', 'rule_set', false),
  ('rules.engine.validate', 'm07-rules', 'rule_set', false),
  ('rules.engine.publish', 'm07-rules', 'rule_set_version', true),
  ('rules.engine.activate', 'm07-rules', 'rule_set_version', true),
  ('rules.engine.retire', 'm07-rules', 'rule_set_version', true),
  ('rules.engine.evaluate', 'm07-rules', 'rule_evaluation', false),
  ('rules.engine.simulate', 'm07-rules', 'rule_set', false),
  ('rules.engine.test', 'm07-rules', 'rule_test_case', false),
  ('rules.evaluation.view', 'm07-rules', 'rule_evaluation', false),
  ('rules.evaluation.replay', 'm07-rules', 'rule_evaluation', false),
  ('rules.evaluation.export', 'm07-rules', 'rule_evaluation', false),
  ('rules.platform.administer', 'm07-rules', 'rule_engine', true);

-- rule_set — a logical, named decision rule set. The current live revision is tracked by status on the
-- version rows; this row carries identity + the immutable business key. `scope` reserves the platform-vs-tenant
-- distinction (ADR-037); MVP rule sets are tenant-scoped and RLS applies uniformly.
CREATE TABLE rule_set (
  tenant_id   uuid        NOT NULL,
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  key         text        NOT NULL,
  name        text        NOT NULL,
  description text,
  scope       text        NOT NULL DEFAULT 'tenant',
  status      text        NOT NULL DEFAULT 'active',
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  CONSTRAINT rule_set_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT rule_set_id_key UNIQUE (tenant_id, id),
  CONSTRAINT rule_set_key_key UNIQUE (tenant_id, key),
  CONSTRAINT rule_set_scope_ck CHECK (scope IN ('tenant', 'platform')),
  CONSTRAINT rule_set_status_ck CHECK (status IN ('active', 'retired')),
  CONSTRAINT rule_set_version_ck CHECK (version >= 1)
);
ALTER TABLE rule_set ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_set FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rule_set
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- rule_set_version — an immutable-once-published revision. `spec` is the validated definition document
-- (fields, derived fields, decision tables, hit policies, input/output schemas). `content_hash` is the
-- canonical hash frozen at publish, making immutability verifiable. Exactly one version per rule set may be
-- ACTIVE (partial unique index), so evaluation is deterministic about which revision governs (ADR-032).
CREATE TABLE rule_set_version (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  rule_set_id    uuid        NOT NULL,
  version_number integer     NOT NULL,
  status         text        NOT NULL DEFAULT 'DRAFT',
  spec           jsonb       NOT NULL,
  content_hash   text,
  notes          text,
  version        integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  published_at   timestamptz,
  published_by   uuid,
  CONSTRAINT rule_set_version_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT rule_set_version_id_key UNIQUE (tenant_id, id),
  CONSTRAINT rule_set_version_num_key UNIQUE (tenant_id, rule_set_id, version_number),
  CONSTRAINT rule_set_version_ruleset_fkey
    FOREIGN KEY (tenant_id, rule_set_id) REFERENCES rule_set (tenant_id, id),
  CONSTRAINT rule_set_version_status_ck
    CHECK (status IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'ACTIVE', 'RETIRED', 'ARCHIVED')),
  -- A PUBLISHED-or-later version must carry the frozen content hash (immutability evidence, ADR-032).
  CONSTRAINT rule_set_version_hash_ck
    CHECK (status IN ('DRAFT', 'VALIDATED') OR content_hash IS NOT NULL),
  CONSTRAINT rule_set_version_optlock_ck CHECK (version >= 1)
);
ALTER TABLE rule_set_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_set_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rule_set_version
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- At most one ACTIVE version per rule set governs evaluation (ADR-032).
CREATE UNIQUE INDEX rule_set_version_one_active
  ON rule_set_version (tenant_id, rule_set_id) WHERE status = 'ACTIVE';

-- rule_evaluation — append-only decision evidence (ADR-035). Stores the INPUT HASH (canonical SHA-256), the
-- version evaluated, and a REDACTED explanation (outputs, machine reason codes, matched rule/table ids) — it
-- deliberately does NOT persist the raw input field values, which may be sensitive. `idempotency_key` makes a
-- governed evaluation safe to retry: the partial unique index returns the stored decision on replay rather
-- than recomputing/duplicating. Append-only: the app role gets INSERT + SELECT only (0002), never UPDATE/DELETE.
CREATE TABLE rule_evaluation (
  tenant_id       uuid        NOT NULL,
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  rule_set_id     uuid        NOT NULL,
  version_id      uuid        NOT NULL,
  version_number  integer     NOT NULL,
  idempotency_key text,
  input_hash      text        NOT NULL,
  engine_version  text        NOT NULL,
  status          text        NOT NULL DEFAULT 'completed',
  outcome         jsonb       NOT NULL,
  reason_codes    text[]      NOT NULL DEFAULT '{}',
  mode            text        NOT NULL DEFAULT 'evaluate',
  correlation_id  uuid        NOT NULL,
  evaluated_at    timestamptz NOT NULL DEFAULT now(),
  evaluated_by    uuid,
  CONSTRAINT rule_evaluation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT rule_evaluation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT rule_evaluation_ruleset_fkey
    FOREIGN KEY (tenant_id, rule_set_id) REFERENCES rule_set (tenant_id, id),
  CONSTRAINT rule_evaluation_version_fkey
    FOREIGN KEY (tenant_id, version_id) REFERENCES rule_set_version (tenant_id, id),
  CONSTRAINT rule_evaluation_status_ck CHECK (status IN ('completed', 'failed')),
  CONSTRAINT rule_evaluation_mode_ck CHECK (mode IN ('evaluate', 'simulate', 'test', 'replay'))
);
ALTER TABLE rule_evaluation ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_evaluation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rule_evaluation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- Idempotency: one committed evaluation per (rule_set, key) for governed 'evaluate' calls (ADR high-risk retry).
CREATE UNIQUE INDEX rule_evaluation_idem_key
  ON rule_evaluation (tenant_id, rule_set_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND mode = 'evaluate';
CREATE INDEX rule_evaluation_ruleset_idx ON rule_evaluation (tenant_id, rule_set_id, evaluated_at);

-- rule_test_case — stored, replayable test cases pinned to a rule set. `input`/`expected` are SYNTHETIC test
-- fixtures (not production data), stored raw for reproducibility. Mutable aggregate (optimistic-locked).
CREATE TABLE rule_test_case (
  tenant_id   uuid        NOT NULL,
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  rule_set_id uuid        NOT NULL,
  name        text        NOT NULL,
  description text,
  input       jsonb       NOT NULL,
  expected    jsonb       NOT NULL,
  enabled     boolean     NOT NULL DEFAULT true,
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  CONSTRAINT rule_test_case_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT rule_test_case_id_key UNIQUE (tenant_id, id),
  CONSTRAINT rule_test_case_name_key UNIQUE (tenant_id, rule_set_id, name),
  CONSTRAINT rule_test_case_ruleset_fkey
    FOREIGN KEY (tenant_id, rule_set_id) REFERENCES rule_set (tenant_id, id),
  CONSTRAINT rule_test_case_optlock_ck CHECK (version >= 1)
);
ALTER TABLE rule_test_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_test_case FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rule_test_case
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- rule_set_history — append-only record of every rule-set/version lifecycle change (evidence). INSERT + SELECT
-- only (0002); the application cannot rewrite the lifecycle trail (ADR-005).
CREATE TABLE rule_set_history (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  rule_set_id    uuid        NOT NULL,
  version_id     uuid,
  from_status    text,
  to_status      text        NOT NULL,
  action         text        NOT NULL,
  reason         text,
  correlation_id uuid        NOT NULL,
  changed_by     uuid,
  at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rule_set_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT rule_set_history_ruleset_fkey
    FOREIGN KEY (tenant_id, rule_set_id) REFERENCES rule_set (tenant_id, id),
  CONSTRAINT rule_set_history_from_ck CHECK (from_status IS NOT NULL OR action = 'create')
);
ALTER TABLE rule_set_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_set_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rule_set_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX rule_set_history_idx ON rule_set_history (tenant_id, rule_set_id, at);
