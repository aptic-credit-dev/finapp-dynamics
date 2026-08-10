/**
 * M32 permission catalogue — the `analytics.*` namespace. Three-segment `analytics.<area>.<action>` (the kernel
 * @Endpoint rule); enforced server-side in every service (default deny); registered in manifests/permission-registry.yaml
 * + seeded (migration 0001). `analytics.control.administer` is the cross-tenant CONTROL-PLANE permission a tenant admin
 * never holds by default. PUBLISH (metric/report) and EXPORT are privileged CONTROLLED actions; schedule/dataset manage
 * are privileged. There is NO `analytics.admin` / wildcard bypass; a request-supplied identifier creates no authority; a
 * feature flag can never substitute a permission (RBAC m02 stays authoritative). Aggregation grants no access.
 */
export const M32_PERMISSIONS = {
  datasetRead: 'analytics.dataset.read',
  datasetManage: 'analytics.dataset.manage',
  metricRead: 'analytics.metric.read',
  metricAuthor: 'analytics.metric.author',
  metricPublish: 'analytics.metric.publish',
  reportRead: 'analytics.report.read',
  reportAuthor: 'analytics.report.author',
  reportPublish: 'analytics.report.publish',
  queryRun: 'analytics.query.run',
  exportCreate: 'analytics.export.create',
  scheduleManage: 'analytics.schedule.manage',
  administer: 'analytics.control.administer',
} as const;

export type M32Permission = (typeof M32_PERMISSIONS)[keyof typeof M32_PERMISSIONS];
export const ALL_M32_PERMISSIONS: readonly M32Permission[] = Object.values(M32_PERMISSIONS);

/** The CONTROL-PLANE permission — a tenant admin never holds it by default; platform-scoped analytics rows require it. */
export const M32_PLATFORM_PERMISSIONS: readonly M32Permission[] = [M32_PERMISSIONS.administer];

/** The privileged subset — controlled publish/export, dataset/schedule management + the control-plane permission. */
export const M32_PRIVILEGED_PERMISSIONS: readonly M32Permission[] = [
  M32_PERMISSIONS.datasetManage,
  M32_PERMISSIONS.metricPublish,
  M32_PERMISSIONS.reportPublish,
  M32_PERMISSIONS.exportCreate,
  M32_PERMISSIONS.scheduleManage,
  M32_PERMISSIONS.administer,
];

export function isPlatformPermission(p: string): boolean {
  return (M32_PLATFORM_PERMISSIONS as readonly string[]).includes(p);
}
