-- ---------------------------------------------------------------------------------------------------
-- M39-saas — COMMERCIAL SAAS (Stage 6F, mvp:false): the canonical owner of commercial plan/subscription/entitlement/quota/
-- usage/billing state. Plans are VERSIONED; a PUBLISHED plan version is IMMUTABLE (trigger) and a subscription binds an
-- explicit plan/version. THE CONTROL STACK (enforced in-service + proven pure): access = m02 RBAC (WHO) AND m39 ENTITLEMENT
-- (does the plan include the capability) AND m30 FEATURE/ABSOLUTE control (is it enabled); any deny denies; an entitlement is
-- NEVER an authorization substitute and can never override an m30 platform-absolute control. QUOTA is RACE-SAFE: a hard limit
-- lives on saas_quota_period with a CHECK (reserved BETWEEN 0 AND limit) + an atomic conditional increment + version CAS, so
-- concurrent consumers cannot oversubscribe. USAGE is APPEND-ONLY + IDEMPOTENT (a source ref counts once via a UNIQUE
-- idempotency key). Plan publication + subscription lifecycle + commercial overrides are maker-checker (saas_review decided_by
-- <> requested_by, SoD; AI/system/automation never approve — in-service). MONEY is bigint minor units + explicit currency (NO
-- float); m39 owns pricing METADATA only — it does NOT post journals / mutate the GL / create payments / become a ledger
-- (finance is consumed by contract; the real billing PROVIDER is deferred behind a fail-closed port, OPEN_QUESTIONS #2). Uses
-- the saas_ prefix and owns subscription.lifecycle + usage.lifecycle + billing.lifecycle ONLY, through the ONE m06 outbox.
-- Every tenant-scoped table: composite (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite FKs (within
-- m39), version on mutable aggregates. No DELETE grant (ADR-010). Entitlement/quota-policy/usage/assignment/override/review/
-- history + the idempotency ledger are append-only (INSERT+SELECT, 0002). No secret VALUE column. GAP-6: m01 never built any
-- subscription/entitlement/usage table — m39 is the sole owner. PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

-- The saas.* permission namespace (already declared in naming-map; no GAP-4). Three-segment saas.<area>.<action>. Every
-- controlled commercial operation authorizes one (default deny). saas.control.administer is the cross-tenant CONTROL-PLANE
-- permission a tenant admin never holds by default (platform-scope plans + platform overrides); saas.plan.publish,
-- saas.subscription.manage and saas.override.administer are privileged controlled actions. NO saas.admin / wildcard bypass.
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('saas.plan.read', 'm39-saas', 'saas_plan', false),
  ('saas.plan.manage', 'm39-saas', 'saas_plan', false),
  ('saas.plan.publish', 'm39-saas', 'saas_plan_version', true),
  ('saas.subscription.read', 'm39-saas', 'saas_subscription', false),
  ('saas.subscription.manage', 'm39-saas', 'saas_subscription', true),
  ('saas.entitlement.read', 'm39-saas', 'saas_entitlement_assignment', false),
  ('saas.quota.read', 'm39-saas', 'saas_quota_period', false),
  ('saas.quota.manage', 'm39-saas', 'saas_quota_period', false),
  ('saas.usage.read', 'm39-saas', 'saas_usage_event', false),
  ('saas.usage.record', 'm39-saas', 'saas_usage_event', false),
  ('saas.override.administer', 'm39-saas', 'saas_override', true),
  ('saas.control.administer', 'm39-saas', 'saas', true);

-- saas_plan — a commercial plan (catalogue). scope tenant|platform (a platform plan requires the control-plane permission).
-- Lifecycle draft -> active -> retired. current_version_no points at the latest PUBLISHED version. Mutable aggregate (version CAS).
CREATE TABLE saas_plan (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', plan_key text NOT NULL, name text NOT NULL,
  state text NOT NULL DEFAULT 'draft', current_version_no integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT saas_plan_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT saas_plan_id_key UNIQUE (tenant_id, id),
  CONSTRAINT saas_plan_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT saas_plan_state_ck CHECK (state IN ('draft','active','retired')),
  CONSTRAINT saas_plan_ver_ck CHECK (current_version_no >= 0));
ALTER TABLE saas_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_plan FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_plan
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX saas_plan_key_uniq ON saas_plan (tenant_id, plan_key);
COMMENT ON TABLE saas_plan IS 'class=tenant_aggregate; m39 commercial plan (catalogue; platform scope needs the control-plane permission)';

-- saas_plan_version — a versioned pricing/entitlement SNAPSHOT of a plan. Lifecycle draft -> published (immutable) -> retired.
-- Money = base_amount_minor (bigint minor units) + currency (no float). A PUBLISHED version is IMMUTABLE (trigger). Mutable
-- aggregate while draft.
CREATE TABLE saas_plan_version (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), plan_id uuid NOT NULL,
  version_no integer NOT NULL, state text NOT NULL DEFAULT 'draft',
  currency text NOT NULL DEFAULT 'USD', base_amount_minor bigint NOT NULL DEFAULT 0, billing_interval text NOT NULL DEFAULT 'monthly',
  validation_passed boolean NOT NULL DEFAULT false, published_at timestamptz, published_by uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT saas_plan_version_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT saas_plan_version_id_key UNIQUE (tenant_id, id),
  CONSTRAINT saas_plan_version_state_ck CHECK (state IN ('draft','published','retired')),
  CONSTRAINT saas_plan_version_no_ck CHECK (version_no >= 1),
  CONSTRAINT saas_plan_version_currency_ck CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT saas_plan_version_amount_ck CHECK (base_amount_minor >= 0),
  CONSTRAINT saas_plan_version_interval_ck CHECK (billing_interval IN ('monthly','annual','none')),
  CONSTRAINT saas_plan_version_pub_ck CHECK (state <> 'published' OR (published_at IS NOT NULL AND validation_passed)),
  CONSTRAINT saas_plan_version_plan_fkey FOREIGN KEY (tenant_id, plan_id) REFERENCES saas_plan (tenant_id, id));
ALTER TABLE saas_plan_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_plan_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_plan_version
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX saas_plan_version_uniq ON saas_plan_version (tenant_id, plan_id, version_no);
COMMENT ON TABLE saas_plan_version IS 'class=tenant_aggregate; m39 plan version (published-immutable pricing/entitlement snapshot; money=bigint minor units)';

-- A PUBLISHED plan version is IMMUTABLE (pricing/entitlements never mutate retroactively); a retired version is terminal; a
-- new version_no is the only way to change commercial terms (G-g).
CREATE OR REPLACE FUNCTION saas_plan_version_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state = 'published' AND NEW.state NOT IN ('published','retired') THEN
    RAISE EXCEPTION 'a published plan version is immutable (issue a new version)' USING ERRCODE = 'raise_exception';
  END IF;
  IF OLD.state = 'published' AND (NEW.currency <> OLD.currency OR NEW.base_amount_minor <> OLD.base_amount_minor
      OR NEW.billing_interval <> OLD.billing_interval OR NEW.version_no <> OLD.version_no OR NEW.plan_id <> OLD.plan_id) THEN
    RAISE EXCEPTION 'a published plan version''s pricing/entitlement is frozen (issue a new version)' USING ERRCODE = 'raise_exception';
  END IF;
  IF OLD.state = 'retired' AND NEW.state <> 'retired' THEN
    RAISE EXCEPTION 'a retired plan version is terminal' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER saas_plan_version_immutable_trg BEFORE UPDATE ON saas_plan_version
  FOR EACH ROW EXECUTE FUNCTION saas_plan_version_immutable();

-- saas_plan_entitlement — APPEND-ONLY: which capability a plan version INCLUDES + its allowance. Defined while the version is
-- draft; frozen when the version publishes (the version's immutability + append-only grants).
CREATE TABLE saas_plan_entitlement (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), plan_version_id uuid NOT NULL,
  capability_key text NOT NULL, allowance text NOT NULL DEFAULT 'included',
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT saas_plan_entitlement_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT saas_plan_entitlement_id_key UNIQUE (tenant_id, id),
  CONSTRAINT saas_plan_entitlement_cap_ck CHECK (capability_key <> ''),
  CONSTRAINT saas_plan_entitlement_allow_ck CHECK (allowance IN ('included','excluded','metered')),
  CONSTRAINT saas_plan_entitlement_pv_fkey FOREIGN KEY (tenant_id, plan_version_id) REFERENCES saas_plan_version (tenant_id, id));
ALTER TABLE saas_plan_entitlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_plan_entitlement FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_plan_entitlement
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX saas_plan_entitlement_uniq ON saas_plan_entitlement (tenant_id, plan_version_id, capability_key);

-- saas_quota_policy — APPEND-ONLY: the hard limit a plan version sets for a (capability, meter, period). limit_hard/threshold
-- are bigint quantities (no float). Bound to a plan version.
CREATE TABLE saas_quota_policy (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), plan_version_id uuid NOT NULL,
  capability_key text NOT NULL, meter_key text NOT NULL, period text NOT NULL DEFAULT 'monthly',
  limit_hard bigint NOT NULL, threshold_soft bigint,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT saas_quota_policy_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT saas_quota_policy_id_key UNIQUE (tenant_id, id),
  CONSTRAINT saas_quota_policy_cap_ck CHECK (capability_key <> '' AND meter_key <> ''),
  CONSTRAINT saas_quota_policy_period_ck CHECK (period IN ('daily','monthly','annual','total')),
  CONSTRAINT saas_quota_policy_limit_ck CHECK (limit_hard >= 0),
  CONSTRAINT saas_quota_policy_soft_ck CHECK (threshold_soft IS NULL OR (threshold_soft >= 0 AND threshold_soft <= limit_hard)),
  CONSTRAINT saas_quota_policy_pv_fkey FOREIGN KEY (tenant_id, plan_version_id) REFERENCES saas_plan_version (tenant_id, id));
ALTER TABLE saas_quota_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_quota_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_quota_policy
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX saas_quota_policy_uniq ON saas_quota_policy (tenant_id, plan_version_id, capability_key, meter_key, period);

-- saas_subscription — a tenant's subscription bound to an EXPLICIT plan/version. Lifecycle draft -> trial -> active -> grace
-- -> suspended -> cancelled/expired. Mutable aggregate (version CAS); ONE active/trial/grace subscription per tenant (partial
-- unique index). Money is inherited from the bound plan version (never duplicated).
CREATE TABLE saas_subscription (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  subscription_key text NOT NULL, plan_id uuid NOT NULL, plan_version_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'draft', started_at timestamptz, trial_end timestamptz,
  current_period_key text, version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT saas_subscription_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT saas_subscription_id_key UNIQUE (tenant_id, id),
  CONSTRAINT saas_subscription_state_ck CHECK (state IN ('draft','trial','active','grace','suspended','cancelled','expired')),
  CONSTRAINT saas_subscription_plan_fkey FOREIGN KEY (tenant_id, plan_id) REFERENCES saas_plan (tenant_id, id),
  CONSTRAINT saas_subscription_pv_fkey FOREIGN KEY (tenant_id, plan_version_id) REFERENCES saas_plan_version (tenant_id, id));
ALTER TABLE saas_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_subscription FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_subscription
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX saas_subscription_key_uniq ON saas_subscription (tenant_id, subscription_key);
CREATE UNIQUE INDEX saas_subscription_one_active ON saas_subscription (tenant_id)
  WHERE state IN ('trial','active','grace');
COMMENT ON TABLE saas_subscription IS 'class=tenant_aggregate; m39 subscription (one active per tenant; binds an explicit plan/version)';

-- saas_entitlement_assignment — APPEND-ONLY LEDGER: a tenant's effective entitlement to a capability, derived from the bound
-- plan version XOR a governed override. Append-only history (no retroactive mutation).
CREATE TABLE saas_entitlement_assignment (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  capability_key text NOT NULL, allowance text NOT NULL DEFAULT 'included',
  source_kind text NOT NULL, source_ref uuid, valid_from timestamptz NOT NULL DEFAULT now(), valid_to timestamptz,
  reason_code text, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT saas_entitlement_assignment_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT saas_entitlement_assignment_id_key UNIQUE (tenant_id, id),
  CONSTRAINT saas_entitlement_assignment_cap_ck CHECK (capability_key <> ''),
  CONSTRAINT saas_entitlement_assignment_allow_ck CHECK (allowance IN ('included','excluded','metered')),
  CONSTRAINT saas_entitlement_assignment_src_ck CHECK (source_kind IN ('plan','override')));
ALTER TABLE saas_entitlement_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_entitlement_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_entitlement_assignment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX saas_entitlement_assignment_cap ON saas_entitlement_assignment (tenant_id, capability_key, created_at);

-- saas_override — APPEND-ONLY: a governed commercial override of an entitlement/quota. PRIVILEGED (saas.override.administer) +
-- maker-checker (requested_by != approved_by, both human — in-service) + bounded validity + reason. No silent permanent override.
CREATE TABLE saas_override (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_kind text NOT NULL, capability_key text NOT NULL, allowance text, quota_delta bigint,
  requested_by uuid NOT NULL, approved_by uuid NOT NULL, reason_code text NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(), valid_to timestamptz,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saas_override_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT saas_override_id_key UNIQUE (tenant_id, id),
  CONSTRAINT saas_override_target_ck CHECK (target_kind IN ('entitlement','quota')),
  CONSTRAINT saas_override_cap_ck CHECK (capability_key <> ''),
  CONSTRAINT saas_override_reason_ck CHECK (reason_code <> ''),
  CONSTRAINT saas_override_sod_ck CHECK (approved_by <> requested_by));
ALTER TABLE saas_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_override FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_override
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- saas_quota_period — the RACE-SAFE per-tenant runtime counter for a (capability, meter, period). reserved_qty is bounded by
-- limit_hard by a CHECK; the service increments atomically (UPDATE ... WHERE reserved + n <= limit_hard) so concurrent
-- consumers can NEVER oversubscribe. Mutable aggregate (version CAS). ONE row per (tenant, capability, meter, period).
CREATE TABLE saas_quota_period (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  capability_key text NOT NULL, meter_key text NOT NULL, period_key text NOT NULL,
  limit_hard bigint NOT NULL, reserved_qty bigint NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT saas_quota_period_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT saas_quota_period_id_key UNIQUE (tenant_id, id),
  CONSTRAINT saas_quota_period_cap_ck CHECK (capability_key <> '' AND meter_key <> '' AND period_key <> ''),
  CONSTRAINT saas_quota_period_limit_ck CHECK (limit_hard >= 0),
  CONSTRAINT saas_quota_period_reserved_ck CHECK (reserved_qty >= 0 AND reserved_qty <= limit_hard));
ALTER TABLE saas_quota_period ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_quota_period FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_quota_period
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX saas_quota_period_uniq ON saas_quota_period (tenant_id, capability_key, meter_key, period_key);
COMMENT ON TABLE saas_quota_period IS 'class=tenant_aggregate; m39 race-safe quota counter (reserved<=limit CHECK + atomic conditional increment)';

-- saas_usage_event — APPEND-ONLY + IDEMPOTENT usage evidence. A source event/ref is counted ONCE (UNIQUE idempotency_key).
-- Minimal privacy-safe evidence: meter/quantity/period/source-ref/idempotency-key only — NO raw payload/document/credential.
CREATE TABLE saas_usage_event (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  capability_key text NOT NULL, meter_key text NOT NULL, quantity bigint NOT NULL,
  period_key text NOT NULL, source_ref text, idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(), correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT saas_usage_event_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT saas_usage_event_id_key UNIQUE (tenant_id, id),
  CONSTRAINT saas_usage_event_meter_ck CHECK (capability_key <> '' AND meter_key <> ''),
  CONSTRAINT saas_usage_event_qty_ck CHECK (quantity > 0),
  CONSTRAINT saas_usage_event_idem_ck CHECK (idempotency_key <> ''));
ALTER TABLE saas_usage_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_usage_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_usage_event
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX saas_usage_event_idem_uniq ON saas_usage_event (tenant_id, idempotency_key);

-- saas_billing_cycle — commercial billing-cycle METADATA (state only; NOT an accounting/payment ledger). provider_ref is an
-- OPAQUE external reference (the real provider is deferred, OPEN_QUESTIONS #2). Mutable aggregate (version CAS).
CREATE TABLE saas_billing_cycle (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), subscription_id uuid NOT NULL,
  cycle_start timestamptz NOT NULL, cycle_end timestamptz NOT NULL, next_renewal timestamptz,
  status text NOT NULL DEFAULT 'open', provider_ref text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT saas_billing_cycle_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT saas_billing_cycle_id_key UNIQUE (tenant_id, id),
  CONSTRAINT saas_billing_cycle_status_ck CHECK (status IN ('open','closed','void')),
  CONSTRAINT saas_billing_cycle_range_ck CHECK (cycle_end > cycle_start),
  CONSTRAINT saas_billing_cycle_sub_fkey FOREIGN KEY (tenant_id, subscription_id) REFERENCES saas_subscription (tenant_id, id));
ALTER TABLE saas_billing_cycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_billing_cycle FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_billing_cycle
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX saas_billing_cycle_uniq ON saas_billing_cycle (tenant_id, subscription_id, cycle_start);

-- saas_review — APPEND-ONLY maker-checker record for a controlled commercial action (plan publish / subscription lifecycle /
-- override). decided_by <> requested_by (SoD); AI/system/automation never approve (in-service isHumanActor).
CREATE TABLE saas_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_kind text NOT NULL, target_id uuid NOT NULL, decision text NOT NULL,
  requested_by uuid NOT NULL, decided_by uuid NOT NULL, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saas_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT saas_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT saas_review_target_ck CHECK (target_kind IN ('plan_version','subscription','override')),
  CONSTRAINT saas_review_decision_ck CHECK (decision IN ('approved','rejected')),
  CONSTRAINT saas_review_sod_ck CHECK (decided_by <> requested_by));
ALTER TABLE saas_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- saas_history — APPEND-ONLY lifecycle evidence for a plan/subscription/billing transition.
CREATE TABLE saas_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_kind text NOT NULL, subject_id uuid NOT NULL, from_state text, to_state text NOT NULL, reason_code text,
  actor uuid, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saas_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT saas_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT saas_history_subject_ck CHECK (subject_kind IN ('plan','plan_version','subscription','billing_cycle')),
  CONSTRAINT saas_history_to_ck CHECK (to_state <> ''));
ALTER TABLE saas_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX saas_history_subject ON saas_history (tenant_id, subject_kind, subject_id, created_at);

-- saas_idempotency — APPEND-ONLY: a commercial command's idempotency key (safe retry). UNIQUE per tenant.
CREATE TABLE saas_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, operation text NOT NULL, result_ref uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT saas_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT saas_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT saas_idempotency_key_ck CHECK (idempotency_key <> ''));
ALTER TABLE saas_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX saas_idempotency_key_uniq ON saas_idempotency (tenant_id, idempotency_key);
