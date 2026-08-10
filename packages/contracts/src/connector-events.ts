import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The connector event family — owned by m33-integration (Stage 6D-1). One family: `connector.lifecycle`. Registered in
 * manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox that m06
 * owns (ADR-004) — m33 owns no outbox. These are CONNECTOR/CONNECTION/RUN lifecycle transitions ONLY (a connector
 * published/deprecated, a connection configured, a connector run started/completed/blocked). Payloads carry IDENTIFIERS,
 * a bounded KEY, category, status, a ROW COUNT and REASON CODES ONLY — never a connection config value, a SECRET value or
 * resolved reference, external payload/data, or personal data (ADR-120).
 */
export const CONNECTOR_LIFECYCLE_FAMILY = 'connector.lifecycle';
export const CONNECTOR_LIFECYCLE_VERSION = 1;
export type ConnectorLifecycleEventType =
  | 'ConnectorPublished'
  | 'ConnectorDeprecated'
  | 'ConnectionConfigured'
  | 'RunStarted'
  | 'RunCompleted'
  | 'RunBlocked';
export const CONNECTOR_LIFECYCLE_EVENT_TYPES: readonly ConnectorLifecycleEventType[] = [
  'ConnectorPublished',
  'ConnectorDeprecated',
  'ConnectionConfigured',
  'RunStarted',
  'RunCompleted',
  'RunBlocked',
];

/**
 * A connector-foundation lifecycle transition. Ids, a bounded key/category, direction, a ROW COUNT (never data), status
 * and reason codes ONLY — never a connection config value, a secret value/reference content, or an external payload.
 */
export interface ConnectorLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly connectorKey?: string;
  readonly category?: string;
  readonly capabilityKey?: string;
  readonly direction?: string;
  readonly scope?: string;
  readonly rowCount?: number;
  readonly reasonCode?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type ConnectorLifecycleEvent = DomainEventEnvelope<
  typeof CONNECTOR_LIFECYCLE_FAMILY,
  ConnectorLifecycleEventType,
  ConnectorLifecyclePayload
>;
