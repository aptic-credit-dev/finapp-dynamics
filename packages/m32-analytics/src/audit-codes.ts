/**
 * M32 audit codes — the `ANALYTICS_` prefix. Every controlled definition/publish/query/export/schedule action is audited
 * through the kernel AUDIT port in the SAME transaction. SCREAMING_SNAKE `ANALYTICS_<ENTITY>_<ACTION>` (>= 3 segments),
 * registered in manifests/audit-code-registry.yaml (unregistered codes fail CI). Payloads carry safe ids, keys, kinds,
 * scopes, states, ROW COUNTS and reason codes ONLY — never a metric value, a report body, source business data, a secret
 * or personal data.
 */
export const M32_AUDIT_CODES = {
  datasetDefined: 'ANALYTICS_DATASET_DEFINED',
  datasetUpdated: 'ANALYTICS_DATASET_UPDATED',
  metricDefined: 'ANALYTICS_METRIC_DEFINED',
  metricValidated: 'ANALYTICS_METRIC_VALIDATED',
  metricPublished: 'ANALYTICS_METRIC_PUBLISHED',
  metricSuperseded: 'ANALYTICS_METRIC_SUPERSEDED',
  reportDefined: 'ANALYTICS_REPORT_DEFINED',
  reportPublished: 'ANALYTICS_REPORT_PUBLISHED',
  reviewRequested: 'ANALYTICS_REVIEW_REQUESTED',
  reviewRejected: 'ANALYTICS_REVIEW_REJECTED',
  queryExecuted: 'ANALYTICS_QUERY_EXECUTED',
  materialized: 'ANALYTICS_MATERIALIZATION_COMPLETED',
  exported: 'ANALYTICS_EXPORT_COMPLETED',
  scheduleChanged: 'ANALYTICS_SCHEDULE_CHANGED',
  publishBlocked: 'ANALYTICS_PUBLISH_BLOCKED',
  accessBlocked: 'ANALYTICS_ACCESS_BLOCKED',
  sodBlocked: 'ANALYTICS_SOD_BLOCKED',
} as const;

export type M32AuditCode = (typeof M32_AUDIT_CODES)[keyof typeof M32_AUDIT_CODES];
export const ALL_M32_AUDIT_CODES: readonly M32AuditCode[] = Object.values(M32_AUDIT_CODES);
export const ANALYTICS_AUDIT_PREFIX = 'ANALYTICS_';
