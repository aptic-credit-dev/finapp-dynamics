/**
 * M23 audit codes — every controlled framework mutation records one through the kernel `AUDIT` port in the SAME
 * transaction as the state change. SCREAMING_SNAKE with the `FIN_` prefix, which is SHARED with m19 (ADR-079): the code
 * sets must NOT collide, so every M23 code carries the `FIN_INTEGRATION_` segment (m19 uses no `INTEGRATION` codes).
 * Registered in manifests/audit-code-registry.yaml (unregistered codes fail CI, ADR-005). Payloads carry ids, states,
 * reason codes and opaque references only — never secrets, credentials, endpoints, raw external responses or amounts.
 */
export const M23_AUDIT_CODES = {
  destinationConfigured: 'FIN_INTEGRATION_DESTINATION_CONFIGURED',
  destinationEnabled: 'FIN_INTEGRATION_DESTINATION_ENABLED',
  destinationDisabled: 'FIN_INTEGRATION_DESTINATION_DISABLED',
  configPublished: 'FIN_INTEGRATION_CONFIG_PUBLISHED',
  executionPrepared: 'FIN_INTEGRATION_EXECUTION_PREPARED',
  executionDispatched: 'FIN_INTEGRATION_EXECUTION_DISPATCHED',
  executionAcknowledged: 'FIN_INTEGRATION_EXECUTION_ACKNOWLEDGED',
  executionFailed: 'FIN_INTEGRATION_EXECUTION_FAILED',
  executionRetried: 'FIN_INTEGRATION_EXECUTION_RETRIED',
  executionExhausted: 'FIN_INTEGRATION_EXECUTION_EXHAUSTED',
  executionCancelled: 'FIN_INTEGRATION_EXECUTION_CANCELLED',
  externalReferenceRecorded: 'FIN_INTEGRATION_EXTERNAL_REFERENCE_RECORDED',
} as const;

export type M23AuditCode = (typeof M23_AUDIT_CODES)[keyof typeof M23_AUDIT_CODES];
export const ALL_M23_AUDIT_CODES: readonly M23AuditCode[] = Object.values(M23_AUDIT_CODES);
export const FININT_AUDIT_PREFIX = 'FIN_INTEGRATION_';
