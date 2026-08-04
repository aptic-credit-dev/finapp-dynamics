/**
 * The M23 finance-integration vocabulary + reason-code registry — the small, closed sets the FRAMEWORK-ONLY foundation
 * agrees on. Everything here is PURE (no I/O), exhaustively unit-tested, and shared by the services, the DB CHECKs
 * (mirrored) and the repository. M23 records the GOVERNED integration execution of already-approved posting intents;
 * it never approves, never posts (no production connector exists — dispatch is Framework Only, ADR-096), and never
 * transforms money.
 */

export class IntegrationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'IntegrationError';
    this.code = code;
  }
}

/** Engine bounds. Retry is bounded so a mis-configured destination cannot dispatch forever. */
export const M23_LIMITS = {
  maxAttempts: 10,
  maxDestinationsPerScope: 50,
  maxReasonLength: 2000,
} as const;

// --- destination (a configured external system profile; holds a SECRET REFERENCE, never a secret) -----
export const DESTINATION_TYPES = ['erp', 'core_banking', 'accounting', 'ledger', 'generic'] as const;
export type DestinationType = (typeof DESTINATION_TYPES)[number];
export function isDestinationType(s: string): s is DestinationType {
  return (DESTINATION_TYPES as readonly string[]).includes(s);
}

export const DESTINATION_STATUSES = ['draft', 'enabled', 'disabled', 'retired'] as const;
export type DestinationStatus = (typeof DESTINATION_STATUSES)[number];
export function isDestinationStatus(s: string): s is DestinationStatus {
  return (DESTINATION_STATUSES as readonly string[]).includes(s);
}

// --- execution (the governed integration execution of an approved posting intent) ---------------------
export const EXECUTION_STATUSES = [
  'prepared',
  'ready',
  'dispatched',
  'acknowledged',
  'failed',
  'retryable',
  'exhausted',
  'cancelled',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export function isExecutionStatus(s: string): s is ExecutionStatus {
  return (EXECUTION_STATUSES as readonly string[]).includes(s);
}

// --- attempt result (append-only per-attempt evidence) ------------------------------------------------
export const ATTEMPT_RESULTS = ['prepared', 'dispatched', 'acknowledged', 'failed'] as const;
export type AttemptResult = (typeof ATTEMPT_RESULTS)[number];
export function isAttemptResult(s: string): s is AttemptResult {
  return (ATTEMPT_RESULTS as readonly string[]).includes(s);
}

// --- versioned spec (destination / config; immutable-after-publish) -----------------------------------
export const SPEC_STATUSES = ['draft', 'active', 'superseded', 'retired'] as const;
export type SpecStatus = (typeof SPEC_STATUSES)[number];

// --- deterministic + explainable reason codes ---------------------------------------------------------
export const REASON_CATEGORIES = ['lifecycle', 'retry', 'destination', 'idempotency', 'governance'] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];
export const REASON_SEVERITIES = ['error', 'warning', 'info'] as const;
export type ReasonSeverity = (typeof REASON_SEVERITIES)[number];

export interface ReasonCode {
  readonly code: string;
  readonly category: ReasonCategory;
  readonly severity: ReasonSeverity;
}
export const REASON_CODES = {
  prepared: { code: 'prepared', category: 'lifecycle', severity: 'info' },
  // Framework Only: a dispatch records intent but performs NO external call (ADR-096).
  dispatchedFrameworkOnly: { code: 'dispatched_framework_only', category: 'lifecycle', severity: 'info' },
  acknowledged: { code: 'acknowledged', category: 'lifecycle', severity: 'info' },
  failedTransient: { code: 'failed_transient', category: 'retry', severity: 'warning' },
  failedPermanent: { code: 'failed_permanent', category: 'lifecycle', severity: 'error' },
  retryScheduled: { code: 'retry_scheduled', category: 'retry', severity: 'info' },
  retryExhausted: { code: 'retry_exhausted', category: 'retry', severity: 'error' },
  cancelled: { code: 'cancelled', category: 'lifecycle', severity: 'info' },
  duplicateSuppressed: { code: 'duplicate_suppressed', category: 'idempotency', severity: 'info' },
  destinationDisabled: { code: 'destination_disabled', category: 'destination', severity: 'error' },
  notAllowlisted: { code: 'destination_not_allowlisted', category: 'governance', severity: 'error' },
  missingApproval: { code: 'missing_approval_reference', category: 'governance', severity: 'error' },
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES).map((r) => r.code);
export function reasonCodeOf(key: ReasonCodeKey): string {
  return REASON_CODES[key].code;
}

// --- secret-reference format (a POINTER to a secret, NEVER a secret) ----------------------------------
/**
 * A secret reference is an OPAQUE pointer into the platform secret store (m41/vault) — e.g. `secretref:...`. M23 stores
 * ONLY the reference, never the credential/secret value (ADR-102). This mirrors the DB `secret_reference` format CHECK.
 */
export const SECRET_REFERENCE_PATTERN = /^secretref:[A-Za-z0-9_.:/-]{3,200}$/;
export function isSecretReference(s: string): boolean {
  return SECRET_REFERENCE_PATTERN.test(s);
}
