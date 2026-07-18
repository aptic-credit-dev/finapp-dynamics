/**
 * Authentication transport configuration and the PRODUCTION FAIL-CLOSED gate (ADR-015 §18).
 *
 * The API refuses to boot in production when the cookie/origin configuration is unsafe — an unauthenticated
 * or CSRF-open deployment must fail loudly at startup, never serve. In development/test the defaults are
 * permissive so the app runs locally and under the DB lane.
 */
export interface AuthConfig {
  readonly cookieSecure: boolean;
  readonly sameSite: 'Lax' | 'Strict' | 'None';
  readonly allowedOrigins: readonly string[];
  readonly isProduction: boolean;
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const isProduction = env['NODE_ENV'] === 'production';
  // Secure cookies are on by default; only an explicit opt-out disables them, and never in production.
  const cookieSecure = isProduction ? true : env['FINAPP_COOKIE_SECURE'] !== 'false';
  const sameSiteRaw = env['FINAPP_COOKIE_SAMESITE'] ?? 'Lax';
  const sameSite: AuthConfig['sameSite'] =
    sameSiteRaw === 'Strict' ? 'Strict' : sameSiteRaw === 'None' ? 'None' : 'Lax';
  const allowedOrigins = (env['FINAPP_ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '');

  if (isProduction) {
    // Fail closed: a production deployment MUST name its browser origins (no wildcard credentialed CORS),
    // must keep Secure cookies, and SameSite=None (cross-site cookies) is only safe with Secure.
    if (allowedOrigins.length === 0) {
      throw new Error(
        'FINAPP_ALLOWED_ORIGINS is required in production — credentialed CORS may not use a wildcard.',
      );
    }
    if (!cookieSecure) {
      throw new Error('Secure cookies cannot be disabled in production.');
    }
    if (sameSite === 'None' && !cookieSecure) {
      throw new Error('SameSite=None requires Secure cookies.');
    }
  }

  return { cookieSecure, sameSite, allowedOrigins, isProduction };
}
