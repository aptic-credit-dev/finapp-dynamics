-- ---------------------------------------------------------------------------------------------------
-- M32-analytics — REPORTING & ANALYTICS BUILDER (Stage 6C, mvp:false): a GOVERNED, DERIVED/READ analytics layer over the
-- operational modules. IT IS NOT A SOURCE OF TRUTH — every business record stays owned by its source module; m32 stores
-- only DERIVED, read-only, REBUILDABLE projections (analytics_materialization) with mandatory LINEAGE, and performs NO
-- business mutation. NO ARBITRARY SQL: the governed semantic query layer compiles predefined metrics + bounded dimensions
-- + whitelisted operators + parameterized filters (enforced in-service); an unsupported query fails closed. RLS +
-- ENTITLEMENT survive aggregation: every tenant table is FORCE-RLS; a caller must hold ALL required entitlements
-- (analytics_access_policy) at sufficient scope/sensitivity to see a metric — aggregation never grants access. MONEY is
-- bigint MINOR units / exact numeric decimal / integer basis points with explicit currency — there is NO float column
-- anywhere. Metric/report PUBLICATION is a controlled action (maker-checker/SoD: analytics_review decided_by <>
-- requested_by; a published metric/report is IMMUTABLE via trigger). m32 owns NO scheduler/timer/notify/outbox engine —
-- it holds opaque m06 timer + m08 notify references and emits analytics.lifecycle through the ONE m06 outbox. Every
-- tenant-scoped table: composite (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite FKs (within
-- m32), version on mutable aggregates. No DELETE grant (ADR-010). Review/materialization/lineage/history + the
-- idempotency ledger are append-only (INSERT+SELECT, 0002). PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

-- The analytics.* permission namespace. Three-segment analytics.<area>.<action>; every controlled definition/publish/
-- query/export/schedule operation authorizes one (default deny). analytics.control.administer is the cross-tenant
-- CONTROL-PLANE permission a tenant admin never holds by default; publish/export/schedule/manage codes are privileged
-- (publication + export are controlled actions). There is NO analytics.admin / wildcard bypass.
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('analytics.dataset.read', 'm32-analytics', 'analytics_dataset', false),
  ('analytics.dataset.manage', 'm32-analytics', 'analytics_dataset', true),
  ('analytics.metric.read', 'm32-analytics', 'analytics_metric', false),
  ('analytics.metric.author', 'm32-analytics', 'analytics_metric', false),
  ('analytics.metric.publish', 'm32-analytics', 'analytics_metric', true),
  ('analytics.report.read', 'm32-analytics', 'analytics_report', false),
  ('analytics.report.author', 'm32-analytics', 'analytics_report', false),
  ('analytics.report.publish', 'm32-analytics', 'analytics_report', true),
  ('analytics.query.run', 'm32-analytics', 'analytics_query', false),
  ('analytics.export.create', 'm32-analytics', 'analytics_export', true),
  ('analytics.schedule.manage', 'm32-analytics', 'analytics_schedule', true),
  ('analytics.control.administer', 'm32-analytics', 'analytics', true);

-- analytics_dataset — a GOVERNED SEMANTIC dataset over a source module: it declares the WHITELISTED dimensions + measures
-- (jsonb schema of bounded keys) the semantic query layer may reference. It is a DEFINITION, not a copy of source data.
CREATE TABLE analytics_dataset (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', source_module text NOT NULL, dataset_key text NOT NULL, name text NOT NULL,
  description text, classification text NOT NULL DEFAULT 'internal',
  dimensions jsonb NOT NULL DEFAULT '[]'::jsonb, measures jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT analytics_dataset_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT analytics_dataset_id_key UNIQUE (tenant_id, id),
  CONSTRAINT analytics_dataset_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT analytics_dataset_class_ck CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT analytics_dataset_status_ck CHECK (status IN ('active','retired')),
  CONSTRAINT analytics_dataset_optlock_ck CHECK (version >= 1));
ALTER TABLE analytics_dataset ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_dataset FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_dataset
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX analytics_dataset_one_active ON analytics_dataset (tenant_id, scope, dataset_key) WHERE status = 'active';
CREATE UNIQUE INDEX analytics_dataset_idem ON analytics_dataset (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE analytics_dataset IS 'class=tenant_aggregate; m32 governed semantic dataset (whitelisted dims/measures over a source module)';

-- analytics_metric — a GOVERNED metric/KPI definition. aggregation + measure_key are whitelisted; value_kind + currency
-- carry money/numeric safety (count | minor_amount bigint | decimal | bps — never a float). Lifecycle draft -> validated
-- -> review_pending -> published (maker-checker); a published metric is IMMUTABLE (trigger). One published per key.
CREATE TABLE analytics_metric (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), dataset_id uuid NOT NULL,
  scope text NOT NULL DEFAULT 'tenant', metric_key text NOT NULL, name text NOT NULL, description text,
  aggregation text NOT NULL, measure_key text NOT NULL, value_kind text NOT NULL DEFAULT 'count', currency text,
  dimensions jsonb NOT NULL DEFAULT '[]'::jsonb, filters jsonb NOT NULL DEFAULT '[]'::jsonb, time_grain text,
  classification text NOT NULL DEFAULT 'internal', state text NOT NULL DEFAULT 'draft', validation_passed boolean NOT NULL DEFAULT false,
  content_hash text NOT NULL, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT analytics_metric_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT analytics_metric_id_key UNIQUE (tenant_id, id),
  CONSTRAINT analytics_metric_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT analytics_metric_agg_ck CHECK (aggregation IN ('count','count_distinct','sum','avg','min','max')),
  CONSTRAINT analytics_metric_kind_ck CHECK (value_kind IN ('count','minor_amount','decimal','bps')),
  CONSTRAINT analytics_metric_class_ck CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT analytics_metric_state_ck CHECK (state IN ('draft','validated','review_pending','published','superseded','rejected')),
  -- a metric cannot reach validated/review/published without a passing validation (validation blocks publication).
  CONSTRAINT analytics_metric_evidence_ck CHECK (state NOT IN ('validated','review_pending','published') OR validation_passed = true),
  -- a money metric (minor_amount) MUST declare an explicit currency (no silent cross-currency aggregation).
  CONSTRAINT analytics_metric_currency_ck CHECK (value_kind <> 'minor_amount' OR currency IS NOT NULL),
  CONSTRAINT analytics_metric_optlock_ck CHECK (version >= 1),
  CONSTRAINT analytics_metric_dataset_fkey FOREIGN KEY (tenant_id, dataset_id) REFERENCES analytics_dataset (tenant_id, id));
ALTER TABLE analytics_metric ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_metric FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_metric
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX analytics_metric_one_published ON analytics_metric (tenant_id, scope, metric_key) WHERE state = 'published';
CREATE UNIQUE INDEX analytics_metric_idem ON analytics_metric (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX analytics_metric_by_dataset ON analytics_metric (tenant_id, dataset_id);
COMMENT ON TABLE analytics_metric IS 'class=tenant_aggregate; m32 governed metric/KPI (whitelisted aggregation; money-safe value_kind; published-immutable)';

-- analytics_report — a report | dashboard DEFINITION composing published metrics + bounded dimensions + declarative
-- visualization layout (spec jsonb, never executable code). Lifecycle + maker-checker + published-immutable, as metrics.
CREATE TABLE analytics_report (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', report_key text NOT NULL, name text NOT NULL, description text,
  kind text NOT NULL DEFAULT 'report', spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  classification text NOT NULL DEFAULT 'internal', state text NOT NULL DEFAULT 'draft', validation_passed boolean NOT NULL DEFAULT false,
  content_hash text NOT NULL, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT analytics_report_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT analytics_report_id_key UNIQUE (tenant_id, id),
  CONSTRAINT analytics_report_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT analytics_report_kind_ck CHECK (kind IN ('report','dashboard')),
  CONSTRAINT analytics_report_class_ck CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT analytics_report_state_ck CHECK (state IN ('draft','validated','review_pending','published','superseded','rejected')),
  CONSTRAINT analytics_report_evidence_ck CHECK (state NOT IN ('validated','review_pending','published') OR validation_passed = true),
  CONSTRAINT analytics_report_optlock_ck CHECK (version >= 1));
ALTER TABLE analytics_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_report FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_report
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX analytics_report_one_published ON analytics_report (tenant_id, scope, report_key) WHERE state = 'published';
CREATE UNIQUE INDEX analytics_report_idem ON analytics_report (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE analytics_report IS 'class=tenant_aggregate; m32 report/dashboard definition (declarative; published-immutable)';

-- PUBLISHED-IMMUTABILITY for metrics + reports: once published, the DEFINITION is frozen (only a published->superseded
-- lifecycle move is allowed; superseded/rejected are fully terminal). A change requires a NEW definition version.
CREATE OR REPLACE FUNCTION analytics_metric_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('superseded','rejected') THEN
    RAISE EXCEPTION 'analytics_metric % is immutable in state %', OLD.id, OLD.state USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.dataset_id <> OLD.dataset_id OR NEW.metric_key <> OLD.metric_key OR NEW.aggregation <> OLD.aggregation
     OR NEW.measure_key <> OLD.measure_key OR NEW.value_kind <> OLD.value_kind OR NEW.content_hash <> OLD.content_hash THEN
    RAISE EXCEPTION 'a published/validated analytics_metric definition is immutable (dataset/key/aggregation/measure/kind/hash)'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF OLD.state = 'published' AND NEW.state NOT IN ('published','superseded') THEN
    RAISE EXCEPTION 'a published analytics_metric may only move to superseded' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER analytics_metric_immutable_trg BEFORE UPDATE ON analytics_metric
  FOR EACH ROW EXECUTE FUNCTION analytics_metric_immutable();

CREATE OR REPLACE FUNCTION analytics_report_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('superseded','rejected') THEN
    RAISE EXCEPTION 'analytics_report % is immutable in state %', OLD.id, OLD.state USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.report_key <> OLD.report_key OR NEW.kind <> OLD.kind OR NEW.content_hash <> OLD.content_hash THEN
    RAISE EXCEPTION 'a published/validated analytics_report definition is immutable (key/kind/hash)'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF OLD.state = 'published' AND NEW.state NOT IN ('published','superseded') THEN
    RAISE EXCEPTION 'a published analytics_report may only move to superseded' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER analytics_report_immutable_trg BEFORE UPDATE ON analytics_report
  FOR EACH ROW EXECUTE FUNCTION analytics_report_immutable();

-- analytics_review — APPEND-ONLY maker-checker ledger for metric/report publication. A decision needs a decider and the
-- decider can never be the requester (SoD). AI never approves (isHumanActor in-service).
CREATE TABLE analytics_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, kind text NOT NULL,
  requested_by uuid NOT NULL, decided_by uuid, reason text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analytics_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT analytics_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT analytics_review_target_ck CHECK (target_type IN ('metric','report')),
  CONSTRAINT analytics_review_kind_ck CHECK (kind IN ('requested','approved','rejected')),
  CONSTRAINT analytics_review_decider_ck CHECK (kind = 'requested' OR decided_by IS NOT NULL),
  CONSTRAINT analytics_review_sod_ck CHECK (decided_by IS NULL OR decided_by <> requested_by));
ALTER TABLE analytics_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX analytics_review_by_target ON analytics_review (tenant_id, target_type, target_id);
COMMENT ON TABLE analytics_review IS 'class=tenant_ledger_append_only; m32 maker-checker metric/report publication decisions';

-- analytics_lineage — APPEND-ONLY mandatory lineage for every materialization/export/query result: the authoritative
-- source (module, dataset, metric version), the extraction window + filters + classification. Never fabricated.
CREATE TABLE analytics_lineage (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid, source_module text NOT NULL, source_dataset_id uuid, metric_id uuid,
  metric_version integer, extraction_ts timestamptz NOT NULL DEFAULT now(),
  window_start timestamptz, window_end timestamptz, filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  classification text NOT NULL DEFAULT 'internal',
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT analytics_lineage_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT analytics_lineage_id_key UNIQUE (tenant_id, id),
  CONSTRAINT analytics_lineage_target_ck CHECK (target_type IN ('materialization','export','query')),
  CONSTRAINT analytics_lineage_class_ck CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT analytics_lineage_dataset_fkey FOREIGN KEY (tenant_id, source_dataset_id) REFERENCES analytics_dataset (tenant_id, id),
  CONSTRAINT analytics_lineage_metric_fkey FOREIGN KEY (tenant_id, metric_id) REFERENCES analytics_metric (tenant_id, id));
ALTER TABLE analytics_lineage ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_lineage FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_lineage
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX analytics_lineage_by_target ON analytics_lineage (tenant_id, target_type, target_id);
COMMENT ON TABLE analytics_lineage IS 'class=tenant_ledger_append_only; m32 mandatory analytics lineage (authoritative source, window, filters)';

-- analytics_materialization — APPEND-ONLY derived aggregate snapshots (a rebuild is a NEW generation; nothing mutates).
-- SOURCE OF TRUTH stays the source module; this is a rebuildable copy. MONEY-SAFE: measure_value_minor is bigint minor
-- units, measure_value_numeric is exact numeric (ratios/decimals), measure_count is bigint — there is NO float column.
CREATE TABLE analytics_materialization (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), metric_id uuid NOT NULL, lineage_id uuid NOT NULL,
  generation integer NOT NULL DEFAULT 1, dimension_key text, dimension_value text,
  measure_value_minor bigint, measure_value_numeric numeric(38,10), measure_count bigint, currency text, value_kind text NOT NULL,
  window_start timestamptz, window_end timestamptz, computed_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT analytics_materialization_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT analytics_materialization_id_key UNIQUE (tenant_id, id),
  CONSTRAINT analytics_materialization_kind_ck CHECK (value_kind IN ('count','minor_amount','decimal','bps')),
  CONSTRAINT analytics_materialization_gen_ck CHECK (generation >= 1),
  -- at least one money-safe measure column is present; a money value declares its currency.
  CONSTRAINT analytics_materialization_measure_ck CHECK (measure_value_minor IS NOT NULL OR measure_value_numeric IS NOT NULL OR measure_count IS NOT NULL),
  CONSTRAINT analytics_materialization_currency_ck CHECK (measure_value_minor IS NULL OR currency IS NOT NULL),
  CONSTRAINT analytics_materialization_metric_fkey FOREIGN KEY (tenant_id, metric_id) REFERENCES analytics_metric (tenant_id, id),
  CONSTRAINT analytics_materialization_lineage_fkey FOREIGN KEY (tenant_id, lineage_id) REFERENCES analytics_lineage (tenant_id, id));
ALTER TABLE analytics_materialization ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_materialization FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_materialization
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX analytics_materialization_latest ON analytics_materialization (tenant_id, metric_id, generation DESC);
COMMENT ON TABLE analytics_materialization IS 'class=tenant_ledger_append_only; m32 derived aggregate snapshots (rebuildable; money-safe; no float)';

-- analytics_export — a GOVERNED export request. filter-before-export + entitlement snapshot + bounded size are enforced
-- in-service; the bytes live behind an opaque m09 document reference (never in m32); every export is audited + has lineage.
CREATE TABLE analytics_export (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, format text NOT NULL, status text NOT NULL DEFAULT 'requested',
  classification text NOT NULL DEFAULT 'internal', row_count integer, byte_size bigint,
  entitlement_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb, storage_ref text, lineage_id uuid, reason_code text,
  idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT analytics_export_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT analytics_export_id_key UNIQUE (tenant_id, id),
  CONSTRAINT analytics_export_target_ck CHECK (target_type IN ('metric','report')),
  CONSTRAINT analytics_export_format_ck CHECK (format IN ('csv','xlsx','pdf','json')),
  CONSTRAINT analytics_export_status_ck CHECK (status IN ('requested','filtered','completed','failed')),
  CONSTRAINT analytics_export_class_ck CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT analytics_export_rows_ck CHECK (row_count IS NULL OR row_count >= 0),
  CONSTRAINT analytics_export_optlock_ck CHECK (version >= 1),
  CONSTRAINT analytics_export_lineage_fkey FOREIGN KEY (tenant_id, lineage_id) REFERENCES analytics_lineage (tenant_id, id));
ALTER TABLE analytics_export ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_export FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_export
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX analytics_export_idem ON analytics_export (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE analytics_export IS 'class=tenant_aggregate; m32 governed export (filter-before-export; opaque m09 storage ref; audited)';

-- analytics_schedule — scheduled-report METADATA ONLY. m32 owns NO scheduler/timer/notify engine: timer_ref is an opaque
-- m06 timer reference and notify_ref an opaque m08 reference. m32 stores the binding + status only.
CREATE TABLE analytics_schedule (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), report_id uuid NOT NULL,
  scope text NOT NULL DEFAULT 'tenant', schedule_kind text NOT NULL DEFAULT 'interval', schedule_spec text NOT NULL,
  timer_ref text, notify_ref text, status text NOT NULL DEFAULT 'active', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT analytics_schedule_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT analytics_schedule_id_key UNIQUE (tenant_id, id),
  CONSTRAINT analytics_schedule_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT analytics_schedule_kind_ck CHECK (schedule_kind IN ('interval','cron')),
  CONSTRAINT analytics_schedule_status_ck CHECK (status IN ('active','paused','retired')),
  CONSTRAINT analytics_schedule_optlock_ck CHECK (version >= 1),
  CONSTRAINT analytics_schedule_report_fkey FOREIGN KEY (tenant_id, report_id) REFERENCES analytics_report (tenant_id, id));
ALTER TABLE analytics_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_schedule FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_schedule
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX analytics_schedule_idem ON analytics_schedule (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE analytics_schedule IS 'class=tenant_aggregate; m32 scheduled-report metadata (opaque m06 timer + m08 notify refs; no engine)';

-- analytics_access_policy — the entitlement policy the query/export gate intersects against the caller's authority: which
-- entitlements a caller must ALL hold, at which minimum scope + sensitivity, to see a dataset/metric. Aggregation never
-- grants access the caller lacks. One active per target.
CREATE TABLE analytics_access_policy (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, required_entitlements text[] NOT NULL DEFAULT '{}',
  min_scope text NOT NULL DEFAULT 'tenant', sensitivity_floor text NOT NULL DEFAULT 'internal',
  status text NOT NULL DEFAULT 'active', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT analytics_access_policy_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT analytics_access_policy_id_key UNIQUE (tenant_id, id),
  CONSTRAINT analytics_access_policy_target_ck CHECK (target_type IN ('dataset','metric')),
  CONSTRAINT analytics_access_policy_sens_ck CHECK (sensitivity_floor IN ('public','internal','confidential','restricted')),
  CONSTRAINT analytics_access_policy_status_ck CHECK (status IN ('active','retired')),
  CONSTRAINT analytics_access_policy_optlock_ck CHECK (version >= 1));
ALTER TABLE analytics_access_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_access_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_access_policy
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX analytics_access_policy_one_active ON analytics_access_policy (tenant_id, target_type, target_id) WHERE status = 'active';
CREATE UNIQUE INDEX analytics_access_policy_idem ON analytics_access_policy (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE analytics_access_policy IS 'class=tenant_aggregate; m32 analytics entitlement policy (aggregation grants no access)';

-- analytics_definition_history — APPEND-ONLY status/transition evidence (dataset|metric|report|export|schedule).
CREATE TABLE analytics_definition_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, from_status text, to_status text NOT NULL,
  reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analytics_definition_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT analytics_definition_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT analytics_definition_history_target_ck CHECK (target_type IN ('dataset','metric','report','export','schedule')));
ALTER TABLE analytics_definition_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_definition_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_definition_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX analytics_definition_history_by_target ON analytics_definition_history (tenant_id, target_type, target_id);
COMMENT ON TABLE analytics_definition_history IS 'class=tenant_ledger_append_only; m32 analytics definition status/transition history';

-- analytics_idempotency — APPEND-ONLY idempotency ledger (no duplicate publish/export/materialization/schedule).
CREATE TABLE analytics_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, target_type text, target_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT analytics_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT analytics_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT analytics_idempotency_key_uk UNIQUE (tenant_id, idempotency_key));
ALTER TABLE analytics_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE analytics_idempotency IS 'class=tenant_ledger_append_only; m32 idempotency ledger (no duplicate analytics mutation)';
