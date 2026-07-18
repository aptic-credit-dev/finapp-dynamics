/**
 * Authentication policy — pure constants and small deciders. No I/O, no clock beyond values passed in.
 *
 * Every knob an operator might tune lives here so the services read policy rather than scatter magic
 * numbers. Times are milliseconds; the DB stores absolute timestamps computed from `now + ttl`.
 */

// --- session lifetimes (ADR-015) ------------------------------------------------------------------
/** Sliding idle window: a session unused for this long is expired. */
export const SESSION_IDLE_TTL_MS = 30 * 60 * 1000; // 30 min
/** Hard cap regardless of activity: a session older than this is expired even if actively used. */
export const SESSION_ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000; // 12 h
/** Rotating refresh window. */
export const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 d
/**
 * `last_used_at`/idle slide is only written when it has moved by at least this much, so a burst of
 * requests does not become a burst of UPDATEs on the hot session row.
 */
export const LAST_USED_WRITE_GRANULARITY_MS = 60 * 1000; // 1 min

// --- lockout / throttling -------------------------------------------------------------------------
/** Failures within the window that trigger a temporary account lockout. */
export const LOCKOUT_MAX_FAILURES = 10;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 min
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 min
/** Per-source (IP) failures within the window that trigger throttling — credential-stuffing defence. */
export const SOURCE_THROTTLE_MAX_FAILURES = 50;
export const SOURCE_THROTTLE_WINDOW_MS = 15 * 60 * 1000;

// --- Argon2id parameters (ADR-016) ----------------------------------------------------------------
/**
 * Policy FLOOR. A stored credential whose parameters are below any of these is rehashed on the next
 * successful login (transparent upgrade). Tuned to ~250 ms on target hardware; raise over time.
 */
export interface Argon2Params {
  readonly memoryCost: number; // KiB
  readonly timeCost: number; // iterations
  readonly parallelism: number;
}
export const ARGON2_POLICY: Argon2Params = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

/** A stored hash needs rehashing if its algorithm changed or any parameter fell below policy. */
export function needsRehash(algorithm: string, params: Partial<Argon2Params> | null): boolean {
  if (algorithm !== 'argon2id') return true;
  if (params === null) return true;
  return (
    (params.memoryCost ?? 0) < ARGON2_POLICY.memoryCost ||
    (params.timeCost ?? 0) < ARGON2_POLICY.timeCost ||
    (params.parallelism ?? 0) < ARGON2_POLICY.parallelism
  );
}

// --- generic failure categories (INTERNAL only) ---------------------------------------------------
/**
 * Recorded in `login_attempts` and used to choose behaviour. NEVER returned to the caller — every login
 * failure looks identical from outside (§18 enumeration resistance). "which field was wrong" is exactly
 * the oracle worth withholding.
 */
export const AUTH_FAILURE = {
  noSuchAccount: 'no_such_account',
  invalidCredential: 'invalid_credential',
  credentialDisabled: 'credential_disabled',
  accountNotResolvable: 'account_not_resolvable', // suspended identity/account, etc.
  lockedOut: 'locked_out',
  throttled: 'throttled',
} as const;
export type AuthFailureCategory = (typeof AUTH_FAILURE)[keyof typeof AUTH_FAILURE];

/** The single external message for ALL authentication failures. */
export const GENERIC_AUTH_FAILURE_MESSAGE = 'Invalid credentials.';

// --- password input policy ------------------------------------------------------------------------
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 1024; // bound the hasher's input; long enough for passphrases
