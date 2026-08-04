/**
 * The PURE finance-integration engine — no I/O, fully deterministic and reproducible, so it is exhaustively unit-tested
 * and shared by the services and (mirrored) by the DB CHECKs. It decides bounded retry, validates that a
 * secret-reference is a POINTER and never an inline secret (ADR-102), and evaluates the FRAMEWORK-ONLY dispatch gate
 * (a destination must be enabled + allow-listed and the intent must carry an approval reference). It NEVER performs an
 * external call, NEVER approves, and NEVER transforms money — amounts pass through as opaque evidence.
 */
import { M23_LIMITS, REASON_CODES, SECRET_REFERENCE_PATTERN, isSecretReference } from './domain/vocab.ts';

export class IntegrationEngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'IntegrationEngineError';
    this.code = code;
  }
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  /** Deterministic multiplier per attempt (e.g. 2 = exponential). No randomness (no jitter) — replayable. */
  readonly backoff: number;
}
export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 5, baseDelayMs: 1000, backoff: 2 };

export interface RetryDecision {
  readonly canRetry: boolean;
  readonly nextAttempt: number;
  readonly delayMs: number;
  readonly reasonCode: string;
}
/** Deterministic bounded retry: how many attempts remain and the next backoff delay. */
export function decideRetry(attemptCount: number, policy: RetryPolicy): RetryDecision {
  if (!Number.isInteger(attemptCount) || attemptCount < 0) {
    throw new IntegrationEngineError('BadRetry', 'attemptCount must be a non-negative integer');
  }
  const maxAttempts = Math.min(policy.maxAttempts, M23_LIMITS.maxAttempts);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new IntegrationEngineError('BadRetry', 'maxAttempts must be a positive integer');
  }
  const canRetry = attemptCount < maxAttempts;
  const nextAttempt = attemptCount + 1;
  // Deterministic backoff: baseDelay * backoff^(attemptCount). Integer ms, no jitter.
  const delayMs = canRetry ? Math.round(policy.baseDelayMs * Math.pow(policy.backoff, attemptCount)) : 0;
  return {
    canRetry,
    nextAttempt,
    delayMs,
    reasonCode: canRetry ? REASON_CODES.retryScheduled.code : REASON_CODES.retryExhausted.code,
  };
}

/**
 * Validate a secret REFERENCE. Fails closed: throws if it is not a well-formed pointer, or if it looks like an inline
 * secret value (contains whitespace, is over-long, or does not carry the `secretref:` scheme). M23 stores references
 * only — never credentials/secrets (ADR-102).
 */
export function assertSecretReference(value: string): void {
  if (!isSecretReference(value)) {
    throw new IntegrationEngineError(
      'BadSecretReference',
      `not a secret reference (must match ${String(SECRET_REFERENCE_PATTERN)}); M23 stores references, never secrets`,
    );
  }
}

export interface DispatchGateInput {
  readonly destinationStatus: string;
  readonly allowlisted: boolean;
  readonly approvalRef: string | null;
}
export interface DispatchGateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}
/**
 * The FRAMEWORK-ONLY dispatch gate. A governed execution may only advance toward dispatch when its destination is
 * enabled, the destination is allow-listed, and the intent carries an m22 approval reference (no posting without
 * approval — the gate m21/m22 already enforced; M23 re-checks, fail closed). This gate authorises RECORDING a dispatch
 * intent; it never authorises an external call (no connector exists).
 */
export function evaluateDispatchGate(input: DispatchGateInput): DispatchGateResult {
  if (input.destinationStatus !== 'enabled') {
    return { allowed: false, reasonCode: REASON_CODES.destinationDisabled.code };
  }
  if (!input.allowlisted) {
    return { allowed: false, reasonCode: REASON_CODES.notAllowlisted.code };
  }
  if (input.approvalRef === null || input.approvalRef.trim() === '') {
    return { allowed: false, reasonCode: REASON_CODES.missingApproval.code };
  }
  return { allowed: true, reasonCode: REASON_CODES.dispatchedFrameworkOnly.code };
}
