/**
 * M04 audit codes — the `ADMIN_` prefix. Every controlled admin action records one through the kernel `AUDIT` port.
 * SCREAMING_SNAKE `ADMIN_<AREA>_<ACTION>` (>= 3 segments), registered in manifests/audit-code-registry.yaml
 * (unregistered codes fail CI, ADR-005). Payloads carry SAFE identifiers, states, reason codes and timestamps ONLY —
 * never passwords, tokens, secret references, raw contact data, confidential narratives, full audit-payload copies or
 * document content. Where M04 owns state (operations / saved views / preferences) the audit is written in the SAME
 * transaction. Delegated mutations in other modules are audited by THOSE modules; M04 records an ADMIN_ orchestration
 * event for the admin-facing action. Sensitive reads (audit search, platform audit access) are audited too — no
 * controlled admin action disappears silently.
 */
export const M04_AUDIT_CODES = {
  tenantUpdated: 'ADMIN_TENANT_UPDATED',
  tenantSuspended: 'ADMIN_TENANT_SUSPENDED',
  tenantReactivated: 'ADMIN_TENANT_REACTIVATED',
  adminAssigned: 'ADMIN_TENANT_ADMIN_ASSIGNED',
  accountActivated: 'ADMIN_ACCOUNT_ACTIVATED',
  accountDeactivated: 'ADMIN_ACCOUNT_DEACTIVATED',
  roleCreated: 'ADMIN_ROLE_CREATED',
  roleUpdated: 'ADMIN_ROLE_UPDATED',
  rolePublished: 'ADMIN_ROLE_PUBLISHED',
  roleAssigned: 'ADMIN_ROLE_ASSIGNED',
  roleRevoked: 'ADMIN_ROLE_REVOKED',
  permissionGranted: 'ADMIN_PERMISSION_GRANTED',
  permissionRevoked: 'ADMIN_PERMISSION_REVOKED',
  sodCreated: 'ADMIN_SOD_CREATED',
  sodUpdated: 'ADMIN_SOD_UPDATED',
  workflowPublished: 'ADMIN_WORKFLOW_PUBLISHED',
  workflowActivated: 'ADMIN_WORKFLOW_ACTIVATED',
  rulePublished: 'ADMIN_RULE_PUBLISHED',
  ruleActivated: 'ADMIN_RULE_ACTIVATED',
  notificationConfigured: 'ADMIN_NOTIFICATION_CONFIGURED',
  auditSearched: 'ADMIN_AUDIT_SEARCHED',
  platformAuditAccessed: 'ADMIN_PLATFORM_AUDIT_ACCESSED',
  auditExported: 'ADMIN_AUDIT_EXPORTED',
  auditIntegrityVerified: 'ADMIN_AUDIT_INTEGRITY_VERIFIED',
  operationRequested: 'ADMIN_OPERATION_REQUESTED',
  operationExecuted: 'ADMIN_OPERATION_EXECUTED',
  operationFailed: 'ADMIN_OPERATION_FAILED',
  savedViewSaved: 'ADMIN_SAVED_VIEW_SAVED',
  preferenceUpdated: 'ADMIN_PREFERENCE_UPDATED',
} as const;

export type M04AuditCode = (typeof M04_AUDIT_CODES)[keyof typeof M04_AUDIT_CODES];
export const ALL_M04_AUDIT_CODES: readonly M04AuditCode[] = Object.values(M04_AUDIT_CODES);
export const ADMIN_AUDIT_PREFIX = 'ADMIN_';
