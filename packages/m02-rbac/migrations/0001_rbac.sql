-- ==================================================================================================
-- M02-rbac (Stage 1D) — persistent RBAC: permissions, roles, role→permission, assignments, SoD.
--
-- ISOLATION (ADR-014 patterns):
--   * permissions            — GLOBAL reference registry, NO RLS (like tenant_type_catalogue). Seeded.
--   * roles / role_permissions / sod_rules — GLOBAL rows (tenant_id NULL = system/mandatory, readable by
--       all) + TENANT rows (readable only in their tenant OR via system escape). Mixed policy below.
--   * role_assignments       — TENANT-SCOPED, RLS FORCE, tenant_isolation, NO escape (like
--       tenant_memberships). A tenant sees ONLY its own assignments; cross-tenant is impossible.
--   * platform_role_assignments — GLOBAL, RLS FORCE + system escape (cross-tenant platform admins).
--   * *_status_history        — GLOBAL, append-only (INSERT+SELECT by privilege), system escape; no read API.
--
-- NO DELETE grant anywhere: roles and assignments are retired/revoked by status (ADR-010). Client-supplied
-- permissions are gone — grants live only here, keyed to authenticated actors.
-- ==================================================================================================

-- --------------------------------------------------------------------------------------------------
-- permissions — the governed global catalogue. Seeded from the permission registry (parity asserted).
-- --------------------------------------------------------------------------------------------------
CREATE TABLE permissions (
  code             text        NOT NULL,
  module           text        NOT NULL,
  resource_type    text        NOT NULL,
  description      text,
  risk             text        NOT NULL DEFAULT 'normal',
  privileged       boolean     NOT NULL DEFAULT false,
  tenant_assignable boolean    NOT NULL DEFAULT true,
  deprecated       boolean     NOT NULL DEFAULT false,
  replacement_code text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permissions_pkey PRIMARY KEY (code),
  CONSTRAINT permissions_risk_ck CHECK (risk IN ('normal', 'elevated', 'critical')),
  CONSTRAINT permissions_code_ck CHECK (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$')
);

INSERT INTO permissions (code, module, resource_type) VALUES
  ('auth.session.revoke', 'm02-auth', 'session'),
  ('auth.session.view', 'm02-auth', 'session'),
  ('identity.account.activate', 'm02-identity', 'account'),
  ('identity.account.create', 'm02-identity', 'account'),
  ('identity.account.deactivate', 'm02-identity', 'account'),
  ('identity.account.reactivate', 'm02-identity', 'account'),
  ('identity.account.suspend', 'm02-identity', 'account'),
  ('identity.account.view', 'm02-identity', 'account'),
  ('identity.membership.activate', 'm02-identity', 'membership'),
  ('identity.membership.create', 'm02-identity', 'membership'),
  ('identity.membership.end', 'm02-identity', 'membership'),
  ('identity.membership.reactivate', 'm02-identity', 'membership'),
  ('identity.membership.scope', 'm02-identity', 'membership'),
  ('identity.membership.suspend', 'm02-identity', 'membership'),
  ('identity.membership.view', 'm02-identity', 'membership'),
  ('identity.registry.activate', 'm02-identity', 'registry'),
  ('identity.registry.close', 'm02-identity', 'registry'),
  ('identity.registry.create', 'm02-identity', 'registry'),
  ('identity.registry.edit', 'm02-identity', 'registry'),
  ('identity.registry.reactivate', 'm02-identity', 'registry'),
  ('identity.registry.suspend', 'm02-identity', 'registry'),
  ('identity.registry.view', 'm02-identity', 'registry'),
  ('rbac.assignment.grant', 'm02-rbac', 'assignment'),
  ('rbac.assignment.revoke', 'm02-rbac', 'assignment'),
  ('rbac.assignment.view', 'm02-rbac', 'assignment'),
  ('rbac.bootstrap.execute', 'm02-rbac', 'bootstrap'),
  ('rbac.permission.view', 'm02-rbac', 'permission'),
  ('rbac.role.activate', 'm02-rbac', 'role'),
  ('rbac.role.create', 'm02-rbac', 'role'),
  ('rbac.role.edit', 'm02-rbac', 'role'),
  ('rbac.role.retire', 'm02-rbac', 'role'),
  ('rbac.role.suspend', 'm02-rbac', 'role'),
  ('rbac.role.view', 'm02-rbac', 'role'),
  ('rbac.sod.manage', 'm02-rbac', 'sod'),
  ('rbac.sod.view', 'm02-rbac', 'sod'),
  ('tenant.branch.manage', 'm01-tenant', 'branch'),
  ('tenant.branch.view', 'm01-tenant', 'branch'),
  ('tenant.department.manage', 'm01-tenant', 'department'),
  ('tenant.department.view', 'm01-tenant', 'department'),
  ('tenant.entity.manage', 'm01-tenant', 'entity'),
  ('tenant.entity.view', 'm01-tenant', 'entity'),
  ('tenant.environment.manage', 'm01-tenant', 'environment'),
  ('tenant.environment.view', 'm01-tenant', 'environment'),
  ('tenant.registry.activate', 'm01-tenant', 'registry'),
  ('tenant.registry.approve', 'm01-tenant', 'registry'),
  ('tenant.registry.close', 'm01-tenant', 'registry'),
  ('tenant.registry.create', 'm01-tenant', 'registry'),
  ('tenant.registry.edit', 'm01-tenant', 'registry'),
  ('tenant.registry.provision', 'm01-tenant', 'registry'),
  ('tenant.registry.reactivate', 'm01-tenant', 'registry'),
  ('tenant.registry.restrict', 'm01-tenant', 'registry'),
  ('tenant.registry.review', 'm01-tenant', 'registry'),
  ('tenant.registry.suspend', 'm01-tenant', 'registry'),
  ('tenant.registry.view', 'm01-tenant', 'registry');

-- --------------------------------------------------------------------------------------------------
-- roles — system roles (tenant_id NULL, immutable, seeded) + tenant custom roles (tenant-owned).
-- --------------------------------------------------------------------------------------------------
CREATE TABLE roles (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid,
  code         text        NOT NULL,
  name         text        NOT NULL,
  description  text,
  kind         text        NOT NULL,
  is_immutable boolean     NOT NULL DEFAULT false,
  status       text        NOT NULL DEFAULT 'active',
  risk         text        NOT NULL DEFAULT 'normal',
  version      integer     NOT NULL DEFAULT 1,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_pkey PRIMARY KEY (id),
  CONSTRAINT roles_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT roles_kind_ck CHECK (kind IN ('system', 'tenant_custom')),
  CONSTRAINT roles_status_ck CHECK (status IN ('draft', 'active', 'suspended', 'retired')),
  CONSTRAINT roles_risk_ck CHECK (risk IN ('normal', 'elevated', 'critical')),
  CONSTRAINT roles_version_ck CHECK (version >= 1),
  CONSTRAINT roles_kind_scope_ck CHECK (
    (kind = 'system' AND tenant_id IS NULL AND is_immutable) OR
    (kind = 'tenant_custom' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT roles_id_tenant_uniq UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX roles_system_code ON roles (code) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX roles_tenant_code ON roles (tenant_id, code) WHERE tenant_id IS NOT NULL;

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON roles
  USING (
    tenant_id IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  );

-- --------------------------------------------------------------------------------------------------
-- role_permissions — concrete grants (no wildcards). tenant_id mirrors the role for RLS.
-- --------------------------------------------------------------------------------------------------
CREATE TABLE role_permissions (
  role_id         uuid        NOT NULL,
  tenant_id       uuid,
  permission_code text        NOT NULL,
  granted_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_code),
  CONSTRAINT role_permissions_role_fkey FOREIGN KEY (tenant_id, role_id) REFERENCES roles (tenant_id, id),
  CONSTRAINT role_permissions_perm_fkey FOREIGN KEY (permission_code) REFERENCES permissions (code)
);
CREATE INDEX role_permissions_by_perm ON role_permissions (permission_code);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_permissions
  USING (
    tenant_id IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  );

-- --------------------------------------------------------------------------------------------------
-- role_assignments — TENANT roles -> tenant membership. Tenant-scoped, NO escape (like memberships).
-- --------------------------------------------------------------------------------------------------
CREATE TABLE role_assignments (
  tenant_id       uuid        NOT NULL,
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  membership_id   uuid        NOT NULL,
  identity_id     uuid        NOT NULL,
  role_id         uuid        NOT NULL,
  scope_level     text        NOT NULL DEFAULT 'tenant',
  scope_ref       uuid,
  effective_from  timestamptz,
  expires_at      timestamptz,
  status          text        NOT NULL DEFAULT 'active',
  justification   text,
  version         integer     NOT NULL DEFAULT 1,
  granted_by      uuid,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  revoked_by      uuid,
  revoked_at      timestamptz,
  revoked_reason  text,
  CONSTRAINT role_assignments_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT role_assignments_membership_fkey FOREIGN KEY (tenant_id, membership_id)
    REFERENCES tenant_memberships (tenant_id, id),
  CONSTRAINT role_assignments_role_fkey FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT role_assignments_scope_ck CHECK (scope_level IN ('tenant', 'entity', 'branch', 'department')),
  CONSTRAINT role_assignments_scope_ref_ck CHECK ((scope_level = 'tenant') = (scope_ref IS NULL)),
  CONSTRAINT role_assignments_status_ck CHECK (status IN ('active', 'suspended', 'revoked', 'expired')),
  CONSTRAINT role_assignments_version_ck CHECK (version >= 1),
  CONSTRAINT role_assignments_dates_ck CHECK (expires_at IS NULL OR effective_from IS NULL OR expires_at > effective_from),
  CONSTRAINT role_assignments_revoked_ck CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);
CREATE UNIQUE INDEX role_assignments_one_live
  ON role_assignments (tenant_id, membership_id, role_id, scope_level, COALESCE(scope_ref, '00000000-0000-0000-0000-000000000000'))
  WHERE status IN ('active', 'suspended');
CREATE INDEX role_assignments_by_identity ON role_assignments (tenant_id, identity_id, status);
CREATE INDEX role_assignments_expiry ON role_assignments (expires_at) WHERE status = 'active';

ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignments FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_assignments
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- --------------------------------------------------------------------------------------------------
-- platform_role_assignments — PLATFORM roles -> identity. Global, system escape.
-- --------------------------------------------------------------------------------------------------
CREATE TABLE platform_role_assignments (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  identity_id    uuid        NOT NULL,
  role_id        uuid        NOT NULL,
  effective_from timestamptz,
  expires_at     timestamptz,
  status         text        NOT NULL DEFAULT 'active',
  justification  text,
  version        integer     NOT NULL DEFAULT 1,
  granted_by     uuid,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  revoked_by     uuid,
  revoked_at     timestamptz,
  revoked_reason text,
  CONSTRAINT platform_role_assignments_pkey PRIMARY KEY (id),
  CONSTRAINT platform_role_assignments_identity_fkey FOREIGN KEY (identity_id) REFERENCES identities (id),
  CONSTRAINT platform_role_assignments_role_fkey FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT platform_role_assignments_status_ck CHECK (status IN ('active', 'suspended', 'revoked', 'expired')),
  CONSTRAINT platform_role_assignments_version_ck CHECK (version >= 1),
  CONSTRAINT platform_role_assignments_revoked_ck CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);
CREATE UNIQUE INDEX platform_role_assignments_one_live
  ON platform_role_assignments (identity_id, role_id) WHERE status IN ('active', 'suspended');
CREATE INDEX platform_role_assignments_by_identity ON platform_role_assignments (identity_id, status);

ALTER TABLE platform_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_role_assignments FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform_role_assignments
  USING      (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on')
  WITH CHECK (COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on');

-- --------------------------------------------------------------------------------------------------
-- sod_rules — incompatible role/permission pairs. Global mandatory (tenant_id NULL) + tenant rules.
-- --------------------------------------------------------------------------------------------------
CREATE TABLE sod_rules (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid,
  rule_type   text        NOT NULL,
  code_a      text        NOT NULL,
  code_b      text        NOT NULL,
  description text,
  severity    text        NOT NULL DEFAULT 'elevated',
  status      text        NOT NULL DEFAULT 'active',
  version     integer     NOT NULL DEFAULT 1,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sod_rules_pkey PRIMARY KEY (id),
  CONSTRAINT sod_rules_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT sod_rules_type_ck CHECK (rule_type IN ('role_pair', 'permission_pair')),
  CONSTRAINT sod_rules_status_ck CHECK (status IN ('active', 'retired')),
  CONSTRAINT sod_rules_order_ck CHECK (code_a < code_b)
);
CREATE UNIQUE INDEX sod_rules_uniq
  ON sod_rules (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'), rule_type, code_a, code_b);

ALTER TABLE sod_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE sod_rules FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sod_rules
  USING (
    tenant_id IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  );

-- --------------------------------------------------------------------------------------------------
-- Append-only lifecycle histories — global, system escape, no read API. INSERT+SELECT only (0002).
-- --------------------------------------------------------------------------------------------------
-- `tenant_id` mirrors the role: set for a tenant_custom role (whose lifecycle runs in tenant context),
-- NULL for the immutable system roles (whose only writer is the control plane, under system context). The
-- MIXED policy is what lets the history be written in the SAME transaction as the role change — a tenant
-- transition writes under tenant context, a platform one under the system escape.
CREATE TABLE role_status_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid,
  role_id        uuid        NOT NULL,
  from_status    text,
  to_status      text        NOT NULL,
  action         text        NOT NULL,
  reason         text,
  correlation_id uuid        NOT NULL,
  changed_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_status_history_pkey PRIMARY KEY (id),
  CONSTRAINT role_status_history_role_fkey FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT role_status_history_from_ck CHECK (from_status IS NOT NULL OR action = 'create')
);
CREATE INDEX role_status_history_by_role ON role_status_history (role_id, created_at DESC);
ALTER TABLE role_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_status_history
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  );

-- `tenant_id` is set for a tenant assignment (written in tenant context) and NULL for a platform
-- assignment (written under the system escape — bootstrap and platform admins). Same mixed policy as the
-- role history, for the same reason: the history commits in the transaction that made the change.
CREATE TABLE assignment_status_history (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid,
  assignment_id   uuid        NOT NULL,
  assignment_kind text        NOT NULL,
  from_status     text,
  to_status       text        NOT NULL,
  action          text        NOT NULL,
  reason          text,
  correlation_id  uuid        NOT NULL,
  changed_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignment_status_history_pkey PRIMARY KEY (id),
  CONSTRAINT assignment_status_history_kind_ck CHECK (assignment_kind IN ('tenant', 'platform')),
  CONSTRAINT assignment_status_history_kind_tenant_ck CHECK (
    (assignment_kind = 'tenant' AND tenant_id IS NOT NULL) OR
    (assignment_kind = 'platform' AND tenant_id IS NULL)
  ),
  CONSTRAINT assignment_status_history_from_ck CHECK (from_status IS NOT NULL OR action = 'grant')
);
CREATE INDEX assignment_status_history_by_assignment ON assignment_status_history (assignment_id, created_at DESC);
ALTER TABLE assignment_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assignment_status_history
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  );

-- --------------------------------------------------------------------------------------------------
-- Seed: immutable system roles (ADR-020 bootstrap target) and baseline mandatory SoD rules (ADR-019).
-- --------------------------------------------------------------------------------------------------
INSERT INTO roles (id, tenant_id, code, name, description, kind, is_immutable, status, risk) VALUES
  ('00000000-0000-4000-8000-000000000001', NULL, 'platform_admin', 'Platform administrator',
   'Full platform administration. Bootstrap target (ADR-020).', 'system', true, 'active', 'critical'),
  ('00000000-0000-4000-8000-000000000002', NULL, 'tenant_admin', 'Tenant administrator',
   'Administers one tenant within the tenant context.', 'system', true, 'active', 'elevated');

INSERT INTO role_permissions (role_id, tenant_id, permission_code)
  SELECT '00000000-0000-4000-8000-000000000001', NULL, code FROM permissions;

INSERT INTO role_permissions (role_id, tenant_id, permission_code)
  SELECT '00000000-0000-4000-8000-000000000002', NULL, code FROM permissions
  WHERE code <> 'rbac.bootstrap.execute';

INSERT INTO sod_rules (tenant_id, rule_type, code_a, code_b, description, severity) VALUES
  (NULL, 'permission_pair', 'tenant.registry.approve', 'tenant.registry.create',
   'Maker/checker: a tenant creator must not also approve it.', 'critical'),
  (NULL, 'permission_pair', 'rbac.assignment.grant', 'rbac.sod.manage',
   'Whoever grants roles must not also edit the SoD rules constraining grants.', 'critical');
