/**
 * M33 audit codes — the `INTEGRATION_` prefix. Every controlled connector/connection/run action is audited through the
 * kernel AUDIT port in the SAME transaction. SCREAMING_SNAKE `INTEGRATION_<ENTITY>_<ACTION>` (>= 3 segments), registered in
 * manifests/audit-code-registry.yaml (unregistered codes fail CI). Payloads carry safe ids, keys, categories, statuses,
 * ROW COUNTS and reason codes ONLY — never a connection config value, a secret value/reference content, an external payload
 * or personal data.
 */
export const M33_AUDIT_CODES = {
  connectorDefined: 'INTEGRATION_CONNECTOR_DEFINED',
  connectorValidated: 'INTEGRATION_CONNECTOR_VALIDATED',
  connectorPublished: 'INTEGRATION_CONNECTOR_PUBLISHED',
  connectorDeprecated: 'INTEGRATION_CONNECTOR_DEPRECATED',
  capabilityRegistered: 'INTEGRATION_CAPABILITY_REGISTERED',
  connectionCreated: 'INTEGRATION_CONNECTION_CREATED',
  connectionUpdated: 'INTEGRATION_CONNECTION_UPDATED',
  connectionSecretSet: 'INTEGRATION_CONNECTION_SECRET_SET',
  runStarted: 'INTEGRATION_RUN_STARTED',
  runCompleted: 'INTEGRATION_RUN_COMPLETED',
  runBlocked: 'INTEGRATION_RUN_BLOCKED',
  reviewRequested: 'INTEGRATION_REVIEW_REQUESTED',
  reviewRejected: 'INTEGRATION_REVIEW_REJECTED',
  publishBlocked: 'INTEGRATION_PUBLISH_BLOCKED',
  sodBlocked: 'INTEGRATION_SOD_BLOCKED',
} as const;

export type M33AuditCode = (typeof M33_AUDIT_CODES)[keyof typeof M33_AUDIT_CODES];
export const ALL_M33_AUDIT_CODES: readonly M33AuditCode[] = Object.values(M33_AUDIT_CODES);
export const INTEGRATION_AUDIT_PREFIX = 'INTEGRATION_';
