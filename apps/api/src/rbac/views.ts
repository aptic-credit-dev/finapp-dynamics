import type { AssignmentRow, RoleRow, SodRuleRow } from '@finapp/m02-rbac';

/**
 * Response shapes for the RBAC API. The persistence rows are snake_case and carry columns the wire has no
 * business seeing shaped as-is; these map to the camelCase views the API contracts. Nothing here exposes a
 * permission-set dump or an internal grant graph — a role's concrete permissions are a separate, explicitly
 * permissioned endpoint, never inlined into a list.
 */

export function roleView(row: RoleRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description,
    kind: row.kind,
    isImmutable: row.is_immutable,
    status: row.status,
    risk: row.risk,
    version: row.version,
  };
}

export function assignmentView(row: AssignmentRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    identityId: row.identity_id,
    roleId: row.role_id,
    scopeLevel: row.scope_level,
    scopeRef: row.scope_ref,
    effectiveFrom: row.effective_from,
    expiresAt: row.expires_at,
    status: row.status,
    version: row.version,
  };
}

export function sodRuleView(row: SodRuleRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ruleType: row.rule_type,
    codeA: row.code_a,
    codeB: row.code_b,
    description: row.description,
    severity: row.severity,
    status: row.status,
    version: row.version,
  };
}

export function permissionView(row: {
  code: string;
  module: string;
  resource_type: string;
  risk: string;
  privileged: boolean;
  tenant_assignable: boolean;
  deprecated: boolean;
}) {
  return {
    code: row.code,
    module: row.module,
    resourceType: row.resource_type,
    risk: row.risk,
    privileged: row.privileged,
    tenantAssignable: row.tenant_assignable,
    deprecated: row.deprecated,
  };
}
