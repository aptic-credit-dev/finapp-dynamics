/**
 * M02-auth audit codes. Prefix `AUTH_` (registered in manifests/audit-code-registry.yaml); three segments
 * `<PREFIX>_<ENTITY>_<ACTION>`, per the registry format.
 *
 * NEVER record a secret in an audit `detail`: no password, no hash, no session/refresh token, no token
 * hash, no raw login identifier. The audit spine is append-only, so anything written is written forever.
 */
export const AUTH_AUDIT_CODES = {
  loginSucceeded: 'AUTH_LOGIN_SUCCEEDED',
  loginFailed: 'AUTH_LOGIN_FAILED',
  sessionIssued: 'AUTH_SESSION_ISSUED',
  sessionRefreshed: 'AUTH_SESSION_REFRESHED',
  sessionRevoked: 'AUTH_SESSION_REVOKED',
  sessionExpired: 'AUTH_SESSION_EXPIRED',
  credentialCreated: 'AUTH_CREDENTIAL_CREATED',
  credentialChanged: 'AUTH_CREDENTIAL_CHANGED',
  credentialDisabled: 'AUTH_CREDENTIAL_DISABLED',
  lockoutInitiated: 'AUTH_LOCKOUT_INITIATED',
  lockoutCleared: 'AUTH_LOCKOUT_CLEARED',
} as const;

export type AuthAuditCode = (typeof AUTH_AUDIT_CODES)[keyof typeof AUTH_AUDIT_CODES];
export const ALL_AUTH_AUDIT_CODES: readonly string[] = Object.values(AUTH_AUDIT_CODES);
export const AUTH_AUDIT_PREFIX = 'AUTH_';
