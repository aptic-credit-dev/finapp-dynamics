import type { Tx } from '@finapp/kernel';
import { firstRow } from '@finapp/m02-identity';

/**
 * Persistence for m02-rbac. Reads/writes run inside caller-supplied transactions whose context (system or
 * a specific tenant) the SERVICE chooses so the RLS policy admits exactly the right rows:
 *   - platform_role_assignments + roles/role_permissions/sod system rows → system context.
 *   - role_assignments (tenant) → the tenant's own context (no escape) — the resolver reads them there, so
 *     RLS proves isolation, not application code.
 */

export interface RoleRow {
  readonly id: string;
  readonly tenant_id: string | null;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly kind: string;
  readonly is_immutable: boolean;
  readonly status: string;
  readonly risk: string;
  readonly version: number;
}

export interface AssignmentRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly membership_id: string;
  readonly identity_id: string;
  readonly role_id: string;
  readonly scope_level: string;
  readonly scope_ref: string | null;
  readonly effective_from: Date | null;
  readonly expires_at: Date | null;
  readonly status: string;
  readonly version: number;
}

export interface SodRuleRow {
  readonly id: string;
  readonly tenant_id: string | null;
  readonly rule_type: string;
  readonly code_a: string;
  readonly code_b: string;
  readonly description: string | null;
  readonly severity: string;
  readonly status: string;
  readonly version: number;
}

export class RbacRepository {
  // --- permission catalogue -----------------------------------------------------------------------
  async allPermissionCodes(tx: Tx): Promise<string[]> {
    const r = await tx.query<{ code: string }>(`SELECT code FROM permissions ORDER BY code`);
    return r.rows.map((x) => x.code);
  }
  async listPermissions(tx: Tx): Promise<{ code: string; module: string; resource_type: string; risk: string; privileged: boolean; tenant_assignable: boolean; deprecated: boolean }[]> {
    const r = await tx.query<{ code: string; module: string; resource_type: string; risk: string; privileged: boolean; tenant_assignable: boolean; deprecated: boolean }>(
      `SELECT code, module, resource_type, risk, privileged, tenant_assignable, deprecated FROM permissions ORDER BY code`,
    );
    return r.rows;
  }
  async permissionExists(tx: Tx, code: string, tenantAssignable?: boolean): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM permissions WHERE code = $1 AND deprecated = false ${tenantAssignable ? 'AND tenant_assignable = true' : ''}`,
      [code],
    );
    return r.rows.length > 0;
  }

  // --- permission RESOLUTION (the authorization hot path) -----------------------------------------

  /** Platform-role permissions for an identity (read in SYSTEM context). Active roles + effective assignments. */
  async resolvePlatformPermissions(tx: Tx, identityId: string, now: Date): Promise<string[]> {
    const r = await tx.query<{ permission_code: string }>(
      `SELECT DISTINCT rp.permission_code
       FROM platform_role_assignments a
       JOIN roles r ON r.id = a.role_id AND r.status = 'active'
       JOIN role_permissions rp ON rp.role_id = r.id
       WHERE a.identity_id = $1 AND a.status = 'active'
         AND (a.effective_from IS NULL OR a.effective_from <= $2)
         AND (a.expires_at IS NULL OR a.expires_at > $2)`,
      [identityId, now],
    );
    return r.rows.map((x) => x.permission_code);
  }

  /** Tenant-role permissions for an identity IN THE CURRENT TENANT context (RLS-scoped). */
  async resolveTenantPermissions(tx: Tx, identityId: string, now: Date): Promise<string[]> {
    const r = await tx.query<{ permission_code: string }>(
      `SELECT DISTINCT rp.permission_code
       FROM role_assignments a
       JOIN roles r ON r.id = a.role_id AND r.status = 'active'
       JOIN role_permissions rp ON rp.role_id = r.id
       WHERE a.identity_id = $1 AND a.status = 'active'
         AND (a.effective_from IS NULL OR a.effective_from <= $2)
         AND (a.expires_at IS NULL OR a.expires_at > $2)`,
      [identityId, now],
    );
    return r.rows.map((x) => x.permission_code);
  }

  /** The permission codes a membership would hold from a specific role (for SoD checks at grant time). */
  async permissionsOfRole(tx: Tx, roleId: string): Promise<string[]> {
    const r = await tx.query<{ permission_code: string }>(
      `SELECT permission_code FROM role_permissions WHERE role_id = $1`,
      [roleId],
    );
    return r.rows.map((x) => x.permission_code);
  }

  /** All permission codes a membership currently holds via its live tenant assignments (SoD runtime/grant). */
  async currentMembershipPermissions(tx: Tx, membershipId: string): Promise<string[]> {
    const r = await tx.query<{ permission_code: string }>(
      `SELECT DISTINCT rp.permission_code
       FROM role_assignments a
       JOIN roles r ON r.id = a.role_id AND r.status = 'active'
       JOIN role_permissions rp ON rp.role_id = r.id
       WHERE a.membership_id = $1 AND a.status IN ('active','suspended')`,
      [membershipId],
    );
    return r.rows.map((x) => x.permission_code);
  }

  // --- roles --------------------------------------------------------------------------------------
  async insertRole(
    tx: Tx,
    input: { tenantId: string; code: string; name: string; description: string | null; risk: string; createdBy: string | null },
  ): Promise<RoleRow> {
    const r = await tx.query<RoleRow>(
      `INSERT INTO roles (tenant_id, code, name, description, kind, is_immutable, status, risk, created_by)
       VALUES ($1, $2, $3, $4, 'tenant_custom', false, 'draft', $5, $6)
       RETURNING id, tenant_id, code, name, description, kind, is_immutable, status, risk, version`,
      [input.tenantId, input.code, input.name, input.description, input.risk, input.createdBy],
    );
    return firstRow(r.rows, 'insert role');
  }
  async findRole(tx: Tx, id: string): Promise<RoleRow | null> {
    const r = await tx.query<RoleRow>(
      `SELECT id, tenant_id, code, name, description, kind, is_immutable, status, risk, version FROM roles WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async listRoles(tx: Tx, opts: { limit: number; offset: number; status?: string }): Promise<RoleRow[]> {
    const r = await tx.query<RoleRow>(
      `SELECT id, tenant_id, code, name, description, kind, is_immutable, status, risk, version FROM roles
       ${opts.status === undefined ? '' : 'WHERE status = $3'}
       ORDER BY tenant_id NULLS FIRST, code LIMIT $1 OFFSET $2`,
      opts.status === undefined ? [opts.limit, opts.offset] : [opts.limit, opts.offset, opts.status],
    );
    return r.rows;
  }
  async updateRoleMeta(
    tx: Tx,
    input: { id: string; expectedVersion: number; name?: string; description?: string | null; updatedBy: string | null },
  ): Promise<RoleRow | null> {
    const r = await tx.query<RoleRow>(
      `UPDATE roles SET
         name = COALESCE($3, name),
         description = CASE WHEN $4::boolean THEN $5 ELSE description END,
         version = version + 1, updated_by = $6, updated_at = now()
       WHERE id = $1 AND version = $2 AND is_immutable = false
       RETURNING id, tenant_id, code, name, description, kind, is_immutable, status, risk, version`,
      [input.id, input.expectedVersion, input.name ?? null, input.description !== undefined, input.description ?? null, input.updatedBy],
    );
    return r.rows[0] ?? null;
  }
  async applyRoleStatus(
    tx: Tx,
    input: { id: string; expectedVersion: number; toStatus: string; updatedBy: string | null },
  ): Promise<RoleRow | null> {
    const r = await tx.query<RoleRow>(
      `UPDATE roles SET status = $3, version = version + 1, updated_by = $4, updated_at = now()
       WHERE id = $1 AND version = $2 AND is_immutable = false
       RETURNING id, tenant_id, code, name, description, kind, is_immutable, status, risk, version`,
      [input.id, input.expectedVersion, input.toStatus, input.updatedBy],
    );
    return r.rows[0] ?? null;
  }
  async addRolePermission(tx: Tx, input: { roleId: string; tenantId: string; code: string; grantedBy: string | null }): Promise<boolean> {
    const r = await tx.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_code, granted_by)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [input.roleId, input.tenantId, input.code, input.grantedBy],
    );
    return (r.rowCount ?? 0) === 1;
  }
  async removeRolePermission(tx: Tx, roleId: string, code: string): Promise<boolean> {
    const r = await tx.query(`DELETE FROM role_permissions WHERE role_id = $1 AND permission_code = $2`, [roleId, code]);
    return (r.rowCount ?? 0) === 1;
  }
  async listRolePermissions(tx: Tx, roleId: string): Promise<string[]> {
    const r = await tx.query<{ permission_code: string }>(`SELECT permission_code FROM role_permissions WHERE role_id = $1 ORDER BY permission_code`, [roleId]);
    return r.rows.map((x) => x.permission_code);
  }
  async appendRoleHistory(
    tx: Tx,
    input: { tenantId: string | null; roleId: string; fromStatus: string | null; toStatus: string; action: string; reason: string | null; correlationId: string; changedBy: string | null },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO role_status_history (tenant_id, role_id, from_status, to_status, action, reason, correlation_id, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [input.tenantId, input.roleId, input.fromStatus, input.toStatus, input.action, input.reason, input.correlationId, input.changedBy],
    );
  }

  /** The distinct codes of the roles a membership currently holds live (for role_pair SoD). */
  async currentMembershipRoleCodes(tx: Tx, membershipId: string): Promise<string[]> {
    const r = await tx.query<{ code: string }>(
      `SELECT DISTINCT r.code FROM role_assignments a JOIN roles r ON r.id = a.role_id
       WHERE a.membership_id = $1 AND a.status IN ('active','suspended')`,
      [membershipId],
    );
    return r.rows.map((x) => x.code);
  }

  /** Does an org node (entity/branch/department) with `ref` exist IN THIS tenant? (scope validation). */
  async orgNodeExists(tx: Tx, level: string, ref: string): Promise<boolean> {
    const table = level === 'entity' ? 'tenant_entities' : level === 'branch' ? 'tenant_branches' : 'tenant_departments';
    const r = await tx.query(`SELECT 1 FROM ${table} WHERE id = $1`, [ref]);
    return r.rows.length > 0;
  }

  // --- tenant membership (for assignment target validation) ---------------------------------------
  async findMembership(tx: Tx, id: string): Promise<{ id: string; identity_id: string; status: string } | null> {
    const r = await tx.query<{ id: string; identity_id: string; status: string }>(
      `SELECT id, identity_id, status FROM tenant_memberships WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  // --- tenant assignments -------------------------------------------------------------------------
  async insertAssignment(
    tx: Tx,
    input: {
      tenantId: string; membershipId: string; identityId: string; roleId: string;
      scopeLevel: string; scopeRef: string | null; effectiveFrom: Date | null; expiresAt: Date | null;
      justification: string | null; grantedBy: string | null;
    },
  ): Promise<AssignmentRow> {
    const r = await tx.query<AssignmentRow>(
      `INSERT INTO role_assignments
         (tenant_id, membership_id, identity_id, role_id, scope_level, scope_ref, effective_from, expires_at, justification, granted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING tenant_id, id, membership_id, identity_id, role_id, scope_level, scope_ref, effective_from, expires_at, status, version`,
      [input.tenantId, input.membershipId, input.identityId, input.roleId, input.scopeLevel, input.scopeRef, input.effectiveFrom, input.expiresAt, input.justification, input.grantedBy],
    );
    return firstRow(r.rows, 'insert assignment');
  }
  async findAssignment(tx: Tx, id: string): Promise<AssignmentRow | null> {
    const r = await tx.query<AssignmentRow>(
      `SELECT tenant_id, id, membership_id, identity_id, role_id, scope_level, scope_ref, effective_from, expires_at, status, version
       FROM role_assignments WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async listAssignments(tx: Tx, opts: { limit: number; offset: number; membershipId?: string; status?: string }): Promise<AssignmentRow[]> {
    const clauses: string[] = [];
    const params: unknown[] = [opts.limit, opts.offset];
    if (opts.membershipId !== undefined) { params.push(opts.membershipId); clauses.push(`membership_id = $${params.length}`); }
    if (opts.status !== undefined) { params.push(opts.status); clauses.push(`status = $${params.length}`); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const r = await tx.query<AssignmentRow>(
      `SELECT tenant_id, id, membership_id, identity_id, role_id, scope_level, scope_ref, effective_from, expires_at, status, version
       FROM role_assignments ${where} ORDER BY granted_at DESC LIMIT $1 OFFSET $2`,
      params,
    );
    return r.rows;
  }
  async applyAssignmentStatus(
    tx: Tx,
    input: { id: string; expectedVersion: number; toStatus: string; reason: string | null; actor: string | null },
  ): Promise<AssignmentRow | null> {
    const r = await tx.query<AssignmentRow>(
      `UPDATE role_assignments SET status = $3, version = version + 1,
         revoked_at = CASE WHEN $3 = 'revoked' THEN now() ELSE revoked_at END,
         revoked_by = CASE WHEN $3 = 'revoked' THEN $5 ELSE revoked_by END,
         revoked_reason = CASE WHEN $3 = 'revoked' THEN $4 ELSE revoked_reason END
       WHERE id = $1 AND version = $2
       RETURNING tenant_id, id, membership_id, identity_id, role_id, scope_level, scope_ref, effective_from, expires_at, status, version`,
      [input.id, input.expectedVersion, input.toStatus, input.reason, input.actor],
    );
    return r.rows[0] ?? null;
  }
  async appendAssignmentHistory(
    tx: Tx,
    input: { tenantId: string | null; assignmentId: string; kind: 'tenant' | 'platform'; fromStatus: string | null; toStatus: string; action: string; reason: string | null; correlationId: string; changedBy: string | null },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO assignment_status_history (tenant_id, assignment_id, assignment_kind, from_status, to_status, action, reason, correlation_id, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [input.tenantId, input.assignmentId, input.kind, input.fromStatus, input.toStatus, input.action, input.reason, input.correlationId, input.changedBy],
    );
  }

  // --- platform assignments (bootstrap + platform admins) -----------------------------------------
  async insertPlatformAssignment(
    tx: Tx,
    input: { identityId: string; roleId: string; grantedBy: string | null; justification: string | null },
  ): Promise<{ id: string }> {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO platform_role_assignments (identity_id, role_id, granted_by, justification)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.identityId, input.roleId, input.grantedBy, input.justification],
    );
    return firstRow(r.rows, 'insert platform assignment');
  }
  async platformAssignmentExists(tx: Tx, identityId: string, roleId: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM platform_role_assignments WHERE identity_id = $1 AND role_id = $2 AND status IN ('active','suspended')`,
      [identityId, roleId],
    );
    return r.rows.length > 0;
  }
  /** Resolves a bootstrap account reference to its identity + statuses (within-module read of the m02 plane). */
  async findAccountForBootstrap(tx: Tx, accountId: string): Promise<{ identity_id: string; account_status: string; identity_status: string } | null> {
    const r = await tx.query<{ identity_id: string; account_status: string; identity_status: string }>(
      `SELECT a.identity_id, a.status AS account_status, i.status AS identity_status
       FROM user_accounts a JOIN identities i ON i.id = a.identity_id WHERE a.id = $1`,
      [accountId],
    );
    return r.rows[0] ?? null;
  }

  async findSystemRoleByCode(tx: Tx, code: string): Promise<RoleRow | null> {
    const r = await tx.query<RoleRow>(
      `SELECT id, tenant_id, code, name, description, kind, is_immutable, status, risk, version FROM roles WHERE tenant_id IS NULL AND code = $1`,
      [code],
    );
    return r.rows[0] ?? null;
  }

  // --- SoD ----------------------------------------------------------------------------------------
  async sodRulesFor(tx: Tx, ruleType: string): Promise<SodRuleRow[]> {
    const r = await tx.query<SodRuleRow>(
      `SELECT id, tenant_id, rule_type, code_a, code_b, description, severity, status, version
       FROM sod_rules WHERE rule_type = $1 AND status = 'active'`,
      [ruleType],
    );
    return r.rows;
  }
  async listSodRules(tx: Tx): Promise<SodRuleRow[]> {
    const r = await tx.query<SodRuleRow>(
      `SELECT id, tenant_id, rule_type, code_a, code_b, description, severity, status, version FROM sod_rules ORDER BY tenant_id NULLS FIRST, code_a, code_b`,
    );
    return r.rows;
  }
  async insertSodRule(
    tx: Tx,
    input: { tenantId: string; ruleType: string; codeA: string; codeB: string; description: string | null; severity: string; createdBy: string | null },
  ): Promise<SodRuleRow> {
    const r = await tx.query<SodRuleRow>(
      `INSERT INTO sod_rules (tenant_id, rule_type, code_a, code_b, description, severity, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, tenant_id, rule_type, code_a, code_b, description, severity, status, version`,
      [input.tenantId, input.ruleType, input.codeA, input.codeB, input.description, input.severity, input.createdBy],
    );
    return firstRow(r.rows, 'insert sod rule');
  }
  async findSodRule(tx: Tx, id: string): Promise<SodRuleRow | null> {
    const r = await tx.query<SodRuleRow>(
      `SELECT id, tenant_id, rule_type, code_a, code_b, description, severity, status, version FROM sod_rules WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async updateSodRuleStatus(tx: Tx, input: { id: string; expectedVersion: number; status: string }): Promise<SodRuleRow | null> {
    const r = await tx.query<SodRuleRow>(
      `UPDATE sod_rules SET status = $3, version = version + 1 WHERE id = $1 AND version = $2
       RETURNING id, tenant_id, rule_type, code_a, code_b, description, severity, status, version`,
      [input.id, input.expectedVersion, input.status],
    );
    return r.rows[0] ?? null;
  }
}
