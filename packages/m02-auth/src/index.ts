// Domain — pure, deterministic, no I/O.
export {
  SESSION_STATUSES,
  SESSION_TRANSITIONS,
  SESSION_TERMINAL,
  isSessionStatus,
  checkSessionTransition,
  sessionIsUsable,
  CREDENTIAL_STATUSES,
  isCredentialStatus,
  credentialIsUsable,
} from './domain/session-lifecycle.ts';
export type { SessionStatus, SessionAction, CredentialStatus } from './domain/session-lifecycle.ts';

export {
  SESSION_IDLE_TTL_MS,
  SESSION_ABSOLUTE_TTL_MS,
  REFRESH_TTL_MS,
  LAST_USED_WRITE_GRANULARITY_MS,
  LOCKOUT_MAX_FAILURES,
  LOCKOUT_WINDOW_MS,
  LOCKOUT_DURATION_MS,
  SOURCE_THROTTLE_MAX_FAILURES,
  SOURCE_THROTTLE_WINDOW_MS,
  ARGON2_POLICY,
  needsRehash,
  AUTH_FAILURE,
  GENERIC_AUTH_FAILURE_MESSAGE,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from './domain/policy.ts';
export type { Argon2Params, AuthFailureCategory } from './domain/policy.ts';

// Registered names.
export { AUTH_PERMISSIONS, ALL_AUTH_PERMISSIONS, AUTH_PERMISSION_NAMESPACE } from './permissions.ts';
export type { AuthPermission } from './permissions.ts';
export { AUTH_AUDIT_CODES, ALL_AUTH_AUDIT_CODES, AUTH_AUDIT_PREFIX } from './audit-codes.ts';
export type { AuthAuditCode } from './audit-codes.ts';

// Cryptography — the single place credential/token material is produced or checked.
export {
  argon2idHasher,
  scryptHasher,
  selectPasswordHasher,
  verifyPassword,
  newSecret,
  hashToken,
  hashLoginRef,
} from './hashing.ts';
export type { PasswordHasher, HashedCredential } from './hashing.ts';

// CSRF (cookie transport).
export { CSRF_HEADER, CSRF_COOKIE, newCsrfToken, csrfMatches } from './csrf.ts';

// Persistence + services.
export { AuthRepository } from './repository.ts';
export type { CredentialRow, LoginAccountRow, SessionRow } from './repository.ts';
export { AuthEmitter } from './emit.ts';
export { CredentialService, isUniqueViolation } from './credential.service.ts';
export type { VerifyResult } from './credential.service.ts';
export { AttemptService } from './attempt.service.ts';
export { SessionService } from './session.service.ts';
export type { ResolvedSession, IssuedSession, RefreshOutcome, SessionView } from './session.service.ts';
export { AuthService } from './auth.service.ts';
export type { LoginInput, LoginSuccess } from './auth.service.ts';

// The session-backed actor source — the seam that retires the Stage 1B dev adapter.
export { SessionActorAdapter } from './session-actor-adapter.ts';
