/**
 * M03-audit permissions. Namespace `audit.*` (registered, owner m03-audit); three segments per the kernel
 * @Endpoint validator. No wildcards — each capability is a concrete grant.
 *
 * Note the isolation intent: `audit.event.*` are TENANT-scoped reads (an administrator sees their own
 * tenant's evidence); `audit.platform.view` is the SEPARATE, higher grant for cross-tenant/platform events.
 * A normal tenant administrator must never hold `audit.platform.view`.
 */
export const AUDIT_PERMISSIONS = {
  eventView: 'audit.event.view',
  eventSearch: 'audit.event.search',
  eventExport: 'audit.event.export',
  platformView: 'audit.platform.view',
  retentionManage: 'audit.retention.manage',
  integrityVerify: 'audit.integrity.verify',
  configurationManage: 'audit.configuration.manage',
} as const;

export type AuditPermission = (typeof AUDIT_PERMISSIONS)[keyof typeof AUDIT_PERMISSIONS];
export const ALL_AUDIT_PERMISSIONS: readonly string[] = Object.values(AUDIT_PERMISSIONS);
export const AUDIT_PERMISSION_NAMESPACE = 'audit.';
