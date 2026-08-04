-- ---------------------------------------------------------------------------------------------------
-- M04-admin — the ADMIN CONSOLE (Stage 1, ORCHESTRATION ONLY). A tenant + platform administration surface OVER the
-- existing platform services (m01 tenancy, m02 identity/auth/RBAC, m03 audit, m06 workflow, m07 rules, m08
-- notifications). It OWNS no tenant/identity/account/role/assignment/SoD/audit/workflow/rules/notification data — it
-- CALLS those modules' PUBLIC services through their contracts and records only its OWN admin state: saved views,
-- preferences, and a governed admin-operation request/history ledger. It creates NO event family, NO second outbox and
-- NO duplicate engine. Every controlled admin action is audited with ADMIN_ codes through m03 in the SAME transaction
-- where M04 owns state. All four tables are TENANT-scoped (a platform admin acts within a control-plane tenant
-- context; the `scope` column records whether an operation is tenant- or platform-natured, and platform effects are
-- executed + audited by m01/m03, not mirrored here). Composite (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE +
-- tenant_isolation, composite FKs, `version` on mutable aggregates. No DELETE grant (ADR-010). admin_operation_history
-- is append-only. Idempotency-keyed operations (no duplicate admin action). PostgreSQL 16 compatible. Forward-only.
-- ---------------------------------------------------------------------------------------------------

-- admin.* permission catalogue (30) — tenant-scoped admin, platform admin (privileged), and privileged mutations/reads.
-- No vague admin bypass; platform_audit/administer are the only cross-tenant/control-plane permissions.
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('admin.tenant.read', 'm04-admin', 'admin_tenant', false),
  ('admin.tenant.manage', 'm04-admin', 'admin_tenant', true),
  ('admin.tenant.suspend', 'm04-admin', 'admin_tenant', true),
  ('admin.tenant.reactivate', 'm04-admin', 'admin_tenant', true),
  ('admin.identity.read', 'm04-admin', 'admin_identity', false),
  ('admin.identity.manage', 'm04-admin', 'admin_identity', true),
  ('admin.account.activate', 'm04-admin', 'admin_account', true),
  ('admin.account.deactivate', 'm04-admin', 'admin_account', true),
  ('admin.role.read', 'm04-admin', 'admin_role', false),
  ('admin.role.manage', 'm04-admin', 'admin_role', true),
  ('admin.role.assign', 'm04-admin', 'admin_role', true),
  ('admin.role.revoke', 'm04-admin', 'admin_role', true),
  ('admin.permission.read', 'm04-admin', 'admin_permission', false),
  ('admin.sod.read', 'm04-admin', 'admin_sod', false),
  ('admin.sod.manage', 'm04-admin', 'admin_sod', true),
  ('admin.workflow.read', 'm04-admin', 'admin_workflow', false),
  ('admin.workflow.manage', 'm04-admin', 'admin_workflow', true),
  ('admin.rules.read', 'm04-admin', 'admin_rules', false),
  ('admin.rules.manage', 'm04-admin', 'admin_rules', true),
  ('admin.notification.read', 'm04-admin', 'admin_notification', false),
  ('admin.notification.manage', 'm04-admin', 'admin_notification', true),
  ('admin.audit.read', 'm04-admin', 'admin_audit', false),
  ('admin.audit.export', 'm04-admin', 'admin_audit', true),
  ('admin.audit.verify', 'm04-admin', 'admin_audit', true),
  ('admin.dashboard.read', 'm04-admin', 'admin_dashboard', false),
  ('admin.operations.read', 'm04-admin', 'admin_operation', false),
  ('admin.savedview.manage', 'm04-admin', 'admin_saved_view', false),
  ('admin.preference.manage', 'm04-admin', 'admin_preference', false),
  ('admin.platform_audit.read', 'm04-admin', 'admin_platform', true),
  ('admin.platform.administer', 'm04-admin', 'admin_platform', true);

-- admin_saved_view — a per-admin saved filter/view for an admin console area. Owns no business data — just a filter.
CREATE TABLE admin_saved_view (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_ref uuid NOT NULL, area text NOT NULL, name text NOT NULL, filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT admin_saved_view_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT admin_saved_view_id_key UNIQUE (tenant_id, id),
  CONSTRAINT admin_saved_view_name_key UNIQUE (tenant_id, owner_ref, area, name),
  CONSTRAINT admin_saved_view_area_ck CHECK (area IN ('tenants','identities','roles','sod','workflow','rules','notifications','audit','dashboard')),
  CONSTRAINT admin_saved_view_optlock_ck CHECK (version >= 1));
ALTER TABLE admin_saved_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_saved_view FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admin_saved_view
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX admin_saved_view_by_owner ON admin_saved_view (tenant_id, owner_ref, area);
COMMENT ON TABLE admin_saved_view IS 'class=tenant_aggregate; m04 admin saved view (filter only; owns no business data)';

-- admin_preference — a per-admin UI preference (key/value). Owns no identity/account data.
CREATE TABLE admin_preference (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_ref uuid NOT NULL, pref_key text NOT NULL, pref_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT admin_preference_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT admin_preference_id_key UNIQUE (tenant_id, id),
  CONSTRAINT admin_preference_key_uk UNIQUE (tenant_id, owner_ref, pref_key),
  CONSTRAINT admin_preference_optlock_ck CHECK (version >= 1));
ALTER TABLE admin_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_preference FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admin_preference
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE admin_preference IS 'class=tenant_aggregate; m04 admin preference (key/value)';

-- admin_operation_request — the ONE M04-owned orchestration aggregate: a governed admin operation that delegates its
-- EFFECT to another module's public service (target_ref is an OPAQUE id in that module; no FK). scope records whether
-- the operation is tenant- or platform-natured; a platform-natured operation requires a platform permission (enforced
-- in-service). Idempotency-keyed (no duplicate admin action). Lifecycle: requested -> executing -> completed | failed,
-- or requested -> cancelled.
CREATE TABLE admin_operation_request (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  operation_type text NOT NULL, scope text NOT NULL DEFAULT 'tenant', target_type text, target_ref uuid,
  summary text, status text NOT NULL DEFAULT 'requested', requested_by uuid, reason_code text, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT admin_operation_request_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT admin_operation_request_id_key UNIQUE (tenant_id, id),
  CONSTRAINT admin_operation_request_type_ck CHECK (operation_type IN ('tenant_suspend','tenant_reactivate','tenant_update','account_activate','account_deactivate','role_assign','role_revoke','permission_grant','permission_revoke','sod_update','workflow_publish','rule_publish','notification_configure','audit_export','audit_integrity_verify')),
  CONSTRAINT admin_operation_request_scope_ck CHECK (scope IN ('tenant','platform')),
  CONSTRAINT admin_operation_request_status_ck CHECK (status IN ('requested','executing','completed','failed','cancelled')),
  CONSTRAINT admin_operation_request_optlock_ck CHECK (version >= 1));
ALTER TABLE admin_operation_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_operation_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admin_operation_request
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX admin_operation_request_idem ON admin_operation_request (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX admin_operation_request_by_status ON admin_operation_request (tenant_id, status);
COMMENT ON TABLE admin_operation_request IS 'class=tenant_aggregate; m04 governed admin operation (orchestration; opaque target refs)';

-- admin_operation_history — append-only admin-operation lifecycle evidence.
CREATE TABLE admin_operation_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), operation_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_operation_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT admin_operation_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT admin_operation_history_op_fkey FOREIGN KEY (tenant_id, operation_id) REFERENCES admin_operation_request (tenant_id, id));
ALTER TABLE admin_operation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_operation_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admin_operation_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX admin_operation_history_by_op ON admin_operation_history (tenant_id, operation_id);
COMMENT ON TABLE admin_operation_history IS 'class=tenant_ledger_append_only; m04 admin operation history';
