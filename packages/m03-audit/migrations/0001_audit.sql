-- ===================================================================================================
-- M03-audit — the enterprise audit spine. Append-only, tenant-aware, tamper-evident.
--
--   * audit_events           — the immutable evidentiary record. Mixed scope: tenant events (tenant_id set,
--                              written/read in tenant context) and PLATFORM events (tenant_id NULL, written/
--                              read only under the system escape). Append-only is enforced two ways: the app
--                              role is granted INSERT + SELECT only (0002), AND update/delete/truncate are
--                              blocked by triggers that bind every role, owner included (defence in depth).
--                              Each row is hash-chained to the previous event in its scope (integrity.ts).
--   * audit_retention_policy — the retention POLICY model (per tenant / per category). The enforcement worker
--                              is a documented deferral; the policy it will read lives here now.
--   * audit_legal_hold       — legal/regulatory holds that suspend retention deletion for a scope.
--
-- Exceptional retention deletion, where a regulator legally compels it, is NOT an application capability: it
-- is a separately governed administrative process run by a privileged operator who must first (a) confirm no
-- legal hold applies, (b) export the affected evidence, and (c) record the deletion itself as an audit event.
-- The triggers below deliberately make ordinary deletion impossible so that such an act cannot be casual.
-- ===================================================================================================

-- --------------------------------------------------------------------------------------------------
-- audit_events — the append-only spine.
-- --------------------------------------------------------------------------------------------------
CREATE TABLE audit_events (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            uuid,
  -- Chain grouping: a tenant's id as text, or 'PLATFORM' for tenant-less events. One hash chain per scope.
  scope_key            text        NOT NULL,
  seq                  bigint      NOT NULL,

  -- Actor (from TRUSTED context, never a client claim).
  actor_type           text        NOT NULL,
  actor_id             uuid,
  actor_account_id     uuid,
  actor_role_snapshot  jsonb,
  impersonator_id      uuid,

  -- What happened.
  module               text        NOT NULL,
  action               text        NOT NULL,   -- the registered audit code
  category             text        NOT NULL,
  resource_type        text,
  resource_id          text,
  outcome              text        NOT NULL,
  reason_code          text,
  summary              text,

  -- What changed (redacted before persistence).
  before_snapshot      jsonb,
  after_snapshot       jsonb,
  changed_fields       text[],
  metadata             jsonb,

  -- Where / correlation.
  request_id           uuid,
  correlation_id       uuid        NOT NULL,
  causation_id         uuid,
  session_id           uuid,
  authentication_method text,
  source_system        text,
  source_ip            inet,
  user_agent           text,

  -- When (server-generated only).
  occurred_at          timestamptz NOT NULL,
  recorded_at          timestamptz NOT NULL DEFAULT now(),

  -- Tamper evidence.
  integrity_version    integer     NOT NULL,
  previous_event_hash  text        NOT NULL,
  event_hash           text        NOT NULL,

  CONSTRAINT audit_events_pkey PRIMARY KEY (id),
  CONSTRAINT audit_events_scope_seq_uniq UNIQUE (scope_key, seq),
  CONSTRAINT audit_events_hash_uniq UNIQUE (event_hash),
  CONSTRAINT audit_events_seq_ck CHECK (seq >= 1),
  CONSTRAINT audit_events_scope_ck CHECK (scope_key <> ''),
  CONSTRAINT audit_events_scope_tenant_ck CHECK (
    (tenant_id IS NULL AND scope_key = 'PLATFORM') OR
    (tenant_id IS NOT NULL AND scope_key = tenant_id::text)
  ),
  CONSTRAINT audit_events_actor_type_ck CHECK (actor_type IN (
    'user','platform_admin','tenant_admin','service_account','system_process',
    'integration','scheduled_job','migration','anonymous','impersonated')),
  CONSTRAINT audit_events_outcome_ck CHECK (outcome IN ('success','failure','denied','error','indeterminate'))
);

-- Investigation indexes: tenant + the common filter axes, plus correlation and a global time index.
CREATE INDEX audit_events_tenant_time_idx      ON audit_events (tenant_id, occurred_at DESC);
CREATE INDEX audit_events_tenant_actor_idx     ON audit_events (tenant_id, actor_id, occurred_at DESC);
CREATE INDEX audit_events_tenant_resource_idx  ON audit_events (tenant_id, resource_type, resource_id);
CREATE INDEX audit_events_tenant_action_idx    ON audit_events (tenant_id, action);
CREATE INDEX audit_events_tenant_module_idx    ON audit_events (tenant_id, module);
CREATE INDEX audit_events_tenant_outcome_idx   ON audit_events (tenant_id, outcome, occurred_at DESC);
CREATE INDEX audit_events_correlation_idx      ON audit_events (correlation_id);
CREATE INDEX audit_events_occurred_idx         ON audit_events (occurred_at DESC);

-- Partitioning is a DOCUMENTED DEFERRAL: at Aptic's volumes audit_events will want monthly RANGE partitions
-- on occurred_at for retention-friendly detach/archive. The schema is partition-ready (occurred_at is NOT
-- NULL and on every hot index); introducing partitions is a follow-on migration, not a rewrite.

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE  ROW LEVEL SECURITY;
-- Mixed scope: a tenant sees ONLY its own events; PLATFORM events (tenant_id NULL) are visible ONLY under
-- the system escape. A tenant administrator therefore can never read platform-wide evidence.
CREATE POLICY tenant_isolation ON audit_events
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  );

-- Append-only, enforced for EVERY role (binds the owner too, unlike a mere absence of grants). Update,
-- delete and truncate all raise. This is what makes "audit is evidence, not an editable feed" a database
-- fact rather than an application convention.
CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not permitted (ADR-005)', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_events_no_update   BEFORE UPDATE   ON audit_events FOR EACH ROW       EXECUTE FUNCTION audit_events_immutable();
CREATE TRIGGER audit_events_no_delete   BEFORE DELETE   ON audit_events FOR EACH ROW       EXECUTE FUNCTION audit_events_immutable();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION audit_events_immutable();

-- --------------------------------------------------------------------------------------------------
-- audit_retention_policy — the policy model (enforcement worker deferred). Mixed scope: platform defaults
-- (tenant_id NULL) + tenant overrides. A NULL category is the tenant/platform default for all categories.
-- --------------------------------------------------------------------------------------------------
CREATE TABLE audit_retention_policy (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid,
  category      text,
  retain_days   integer     NOT NULL,
  min_retain_days integer   NOT NULL DEFAULT 365,  -- platform floor; a tenant may retain longer, never less
  description   text,
  version       integer     NOT NULL DEFAULT 1,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_retention_policy_pkey PRIMARY KEY (id),
  CONSTRAINT audit_retention_policy_days_ck CHECK (retain_days >= min_retain_days),
  CONSTRAINT audit_retention_policy_scope_uniq UNIQUE (tenant_id, category)
);
ALTER TABLE audit_retention_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_retention_policy FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_retention_policy
  USING (
    tenant_id IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  );

-- Platform minimum retention default (all categories): keep for at least ~7 years.
INSERT INTO audit_retention_policy (tenant_id, category, retain_days, min_retain_days, description)
  VALUES (NULL, NULL, 2555, 365, 'Platform default minimum audit retention (~7 years).');

-- --------------------------------------------------------------------------------------------------
-- audit_legal_hold — suspends retention deletion for a scope while an investigation/regulation requires it.
-- --------------------------------------------------------------------------------------------------
CREATE TABLE audit_legal_hold (
  tenant_id     uuid        NOT NULL,
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  reason        text        NOT NULL,
  hold_scope    text        NOT NULL DEFAULT 'tenant',  -- 'tenant' | 'resource'
  resource_type text,
  resource_id   text,
  status        text        NOT NULL DEFAULT 'active',   -- 'active' | 'released'
  applied_by    uuid,
  applied_at    timestamptz NOT NULL DEFAULT now(),
  released_by   uuid,
  released_at   timestamptz,
  version       integer     NOT NULL DEFAULT 1,
  CONSTRAINT audit_legal_hold_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT audit_legal_hold_status_ck CHECK (status IN ('active','released')),
  CONSTRAINT audit_legal_hold_released_ck CHECK (status <> 'released' OR released_at IS NOT NULL)
);
ALTER TABLE audit_legal_hold ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_legal_hold FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_legal_hold
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  );
