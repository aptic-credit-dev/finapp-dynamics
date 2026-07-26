/**
 * Retry policy — a PURE, deterministic calculator (prompt §E7). Given a policy, the attempt just made, and the
 * safe error category of that attempt, it decides whether to retry and after what delay. Bounded by
 * `maxAttempts` and `maxDelayMs`; no unbounded retries, no tight loops. Determinism (no jitter by default) is
 * what makes retry behaviour replayable and testable; jitter, if ever wanted, must be supplied externally.
 */
import { NOTIFY_LIMITS, NotifyError } from './limits.ts';

/** Safe, normalized outcome categories. A provider adapter maps its raw response onto one of these. */
export const ERROR_CATEGORIES = [
  'transient',
  'throttled',
  'provider_error',
  'invalid_recipient',
  'rejected',
  'permanent',
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const BACKOFF_STRATEGIES = ['fixed', 'exponential'] as const;
export type BackoffStrategy = (typeof BACKOFF_STRATEGIES)[number];

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly backoff: BackoffStrategy;
  readonly factor: number;
  readonly maxDelayMs: number;
  readonly retryableCategories: readonly ErrorCategory[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  initialDelayMs: 30_000,
  backoff: 'exponential',
  factor: 2,
  maxDelayMs: 3_600_000,
  retryableCategories: ['transient', 'throttled', 'provider_error'],
};

export interface RetryDecision {
  readonly retry: boolean;
  readonly delayMs: number;
  readonly reason: 'retry' | 'non_retryable' | 'exhausted';
}

/** Validate a retry policy fail-closed (a policy is stored on the request for replay/evidence). */
export function validateRetryPolicy(policy: RetryPolicy): void {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new NotifyError('INVALID_RETRY_POLICY', 'maxAttempts must be a positive integer');
  }
  if (policy.maxAttempts > NOTIFY_LIMITS.maxAttempts) {
    throw new NotifyError('INVALID_RETRY_POLICY', 'maxAttempts exceeds the hard limit');
  }
  if (policy.initialDelayMs < 0 || policy.maxDelayMs < policy.initialDelayMs) {
    throw new NotifyError('INVALID_RETRY_POLICY', 'delay bounds are invalid');
  }
  if (policy.factor < 1) {
    throw new NotifyError('INVALID_RETRY_POLICY', 'backoff factor must be >= 1');
  }
}

/**
 * Decide whether to retry after `attemptNumber` (1-based: the attempt that just completed). The next attempt's
 * delay is `initialDelay * factor^(attemptNumber-1)` for exponential (capped at `maxDelayMs`), else the fixed
 * `initialDelay`. A non-retryable category or reaching `maxAttempts` stops with a clear reason.
 */
export function retryDecision(
  policy: RetryPolicy,
  attemptNumber: number,
  category: ErrorCategory,
): RetryDecision {
  if (!policy.retryableCategories.includes(category)) {
    return { retry: false, delayMs: 0, reason: 'non_retryable' };
  }
  if (attemptNumber >= policy.maxAttempts) {
    return { retry: false, delayMs: 0, reason: 'exhausted' };
  }
  const raw =
    policy.backoff === 'exponential'
      ? policy.initialDelayMs * Math.pow(policy.factor, attemptNumber - 1)
      : policy.initialDelayMs;
  const delayMs = Math.min(policy.maxDelayMs, Math.round(raw));
  return { retry: true, delayMs, reason: 'retry' };
}
