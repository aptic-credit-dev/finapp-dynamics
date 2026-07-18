import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * CSRF protection for cookie-authenticated, state-changing requests (ADR-015 / §18).
 *
 * Double-submit: a random CSRF token is set in a NON-HttpOnly cookie at login and must be echoed in the
 * `x-csrf-token` header on every state-changing authenticated request. A cross-site attacker can cause the
 * browser to SEND the ambient session cookie but cannot READ the CSRF cookie to echo it, so the two never
 * match. `SameSite=Lax` is the first line of defence; this is the second.
 */

export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_COOKIE = 'finapp_csrf';

/** A fresh CSRF token. Not a secret in the credential sense — it need only be unguessable per session. */
export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time match of the cookie value against the echoed header value. Empty either side → false. */
export function csrfMatches(cookieValue: string | undefined, headerValue: string | undefined): boolean {
  if (cookieValue === undefined || headerValue === undefined) return false;
  if (cookieValue === '' || headerValue === '') return false;
  const a = Buffer.from(cookieValue, 'utf8');
  const b = Buffer.from(headerValue, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
