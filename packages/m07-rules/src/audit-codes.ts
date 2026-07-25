/**
 * M07 audit codes — the authoritative constant map. Every controlled rule-set mutation and governed evaluation
 * records one of these through the kernel `AUDIT` port (m03 AuditService) in the SAME transaction as the state
 * change. Codes are SCREAMING_SNAKE `RULES_<ENTITY>_<ACTION>` and MUST be registered in
 * manifests/audit-code-registry.yaml (unregistered codes fail CI, ADR-005).
 */
export const M07_AUDIT_CODES = {
  setCreated: 'RULES_SET_CREATED',
  setUpdated: 'RULES_SET_UPDATED',
  setValidated: 'RULES_SET_VALIDATED',
  setValidationFailed: 'RULES_SET_VALIDATION_FAILED',
  versionCreated: 'RULES_VERSION_CREATED',
  versionPublished: 'RULES_VERSION_PUBLISHED',
  versionActivated: 'RULES_VERSION_ACTIVATED',
  versionRetired: 'RULES_VERSION_RETIRED',
  evaluationExecuted: 'RULES_EVALUATION_EXECUTED',
  evaluationFailed: 'RULES_EVALUATION_FAILED',
  evaluationReplayed: 'RULES_EVALUATION_REPLAYED',
  simulationExecuted: 'RULES_SIMULATION_EXECUTED',
  testCreated: 'RULES_TEST_CREATED',
  testExecuted: 'RULES_TEST_EXECUTED',
  testFailed: 'RULES_TEST_FAILED',
  exportRequested: 'RULES_EXPORT_REQUESTED',
  platformConfigured: 'RULES_PLATFORM_CONFIGURED',
} as const;

export type M07AuditCode = (typeof M07_AUDIT_CODES)[keyof typeof M07_AUDIT_CODES];

export const ALL_M07_AUDIT_CODES: readonly M07AuditCode[] = Object.values(M07_AUDIT_CODES);

export const RULES_AUDIT_PREFIX = 'RULES_';
