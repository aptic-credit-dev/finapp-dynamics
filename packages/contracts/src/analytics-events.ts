import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The analytics event family — owned by m32-analytics (Stage 6C). One family: `analytics.lifecycle`. Registered in
 * manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox that m06
 * owns (ADR-004) — m32 owns no outbox. These are ANALYTICS design/lifecycle transitions ONLY (a dataset defined, a
 * metric/report published or superseded, a materialization or export completed, a schedule changed) — they must NEVER
 * impersonate a transactional source-domain event, and they carry IDENTIFIERS, KEYS, VERSIONS, COUNTS, SCOPES, STATES
 * and REASON CODES ONLY — never a metric VALUE, a report body, source business data, a secret or personal data (ADR-119).
 */
export const ANALYTICS_LIFECYCLE_FAMILY = 'analytics.lifecycle';
export const ANALYTICS_LIFECYCLE_VERSION = 1;
export type AnalyticsLifecycleEventType =
  | 'DatasetDefined'
  | 'MetricPublished'
  | 'MetricSuperseded'
  | 'ReportPublished'
  | 'MaterializationCompleted'
  | 'ExportCompleted'
  | 'ScheduleChanged';
export const ANALYTICS_LIFECYCLE_EVENT_TYPES: readonly AnalyticsLifecycleEventType[] = [
  'DatasetDefined',
  'MetricPublished',
  'MetricSuperseded',
  'ReportPublished',
  'MaterializationCompleted',
  'ExportCompleted',
  'ScheduleChanged',
];

/**
 * An analytics lifecycle transition. Ids, a bounded key/kind, source module, version, scope, a ROW COUNT (never a
 * value), states and reason codes ONLY — never a metric value, a report body, source data, a secret or personal data.
 */
export interface AnalyticsLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly sourceModule?: string;
  readonly key?: string;
  readonly kind?: string;
  readonly scope?: string;
  readonly version?: number;
  readonly rowCount?: number;
  readonly reasonCode?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type AnalyticsLifecycleEvent = DomainEventEnvelope<
  typeof ANALYTICS_LIFECYCLE_FAMILY,
  AnalyticsLifecycleEventType,
  AnalyticsLifecyclePayload
>;
