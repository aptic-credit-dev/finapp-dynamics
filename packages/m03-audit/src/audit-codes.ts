/**
 * M03-audit's OWN audit codes. Prefix `AUDIT_` (registered, owner m03-audit); `<PREFIX>_<ENTITY>_<ACTION>`.
 *
 * The audit service records everyone else's actions; these are the codes for its OWN controlled actions —
 * accessing and exporting evidence, verifying integrity, and executing retention/legal-hold. "Audit access
 * and audit exports must themselves be audited" (the watchers are watched). The security-significant ones
 * are severity: critical in the registry and must never be suppressible.
 */
export const AUDIT_AUDIT_CODES = {
  accessSearched: 'AUDIT_ACCESS_SEARCHED',
  eventExported: 'AUDIT_EVENT_EXPORTED',
  integrityVerified: 'AUDIT_INTEGRITY_VERIFIED',
  integrityFailed: 'AUDIT_INTEGRITY_FAILED',
  persistenceFailed: 'AUDIT_PERSISTENCE_FAILED',
  retentionExecuted: 'AUDIT_RETENTION_EXECUTED',
  legalHoldApplied: 'AUDIT_LEGAL_HOLD_APPLIED',
  legalHoldReleased: 'AUDIT_LEGAL_HOLD_RELEASED',
} as const;

export type AuditAuditCode = (typeof AUDIT_AUDIT_CODES)[keyof typeof AUDIT_AUDIT_CODES];
export const ALL_AUDIT_AUDIT_CODES: readonly string[] = Object.values(AUDIT_AUDIT_CODES);
export const AUDIT_AUDIT_PREFIX = 'AUDIT_';
