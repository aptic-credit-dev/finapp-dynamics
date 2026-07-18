import { CSRF_COOKIE } from '@finapp/m02-auth';
import type { AuthConfig } from './config.ts';

/**
 * Cookie transport for sessions (ADR-015 §18). Hand-rolled rather than pulling in a cookie library — the
 * repo's ethos is node-builtins-only, and the parsing we need is a few lines.
 *
 * THREE cookies:
 *   finapp_session — the access token. HttpOnly, so JavaScript (and thus XSS) cannot read it.
 *   finapp_refresh — the refresh token. HttpOnly AND path-scoped to the refresh route, so it is only ever
 *                    sent where it is used.
 *   finapp_csrf    — the CSRF token. NOT HttpOnly (the double-submit token must be readable by the app to
 *                    echo it in the x-csrf-token header).
 */
export const SESSION_COOKIE = 'finapp_session';
export const REFRESH_COOKIE = 'finapp_refresh';
export const REFRESH_PATH = '/api/v1/auth/session/refresh';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name !== '') out[name] = decodeURIComponent(value);
  }
  return out;
}

/** The token extractor injected into ActorContextFactory — reads the session cookie, nothing else. */
export function extractSessionToken(headers: Readonly<Record<string, string>>): string | undefined {
  const cookies = parseCookies(headers['cookie']);
  const value = cookies[SESSION_COOKIE];
  return value === undefined || value === '' ? undefined : value;
}

export function readCookie(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  return parseCookies(headers['cookie'])[name];
}

interface CookieOptions {
  readonly httpOnly: boolean;
  readonly path: string;
  readonly maxAgeSeconds: number;
}

function buildCookie(name: string, value: string, cfg: AuthConfig, opts: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path}`, `SameSite=${cfg.sameSite}`];
  if (opts.httpOnly) parts.push('HttpOnly');
  if (cfg.cookieSecure) parts.push('Secure');
  parts.push(`Max-Age=${opts.maxAgeSeconds}`);
  return parts.join('; ');
}

/** The Set-Cookie headers to establish a session (login / refresh). */
export function sessionCookies(
  cfg: AuthConfig,
  input: { token: string; refresh: string; csrf: string; sessionMaxAge: number; refreshMaxAge: number },
): string[] {
  return [
    buildCookie(SESSION_COOKIE, input.token, cfg, {
      httpOnly: true,
      path: '/',
      maxAgeSeconds: input.sessionMaxAge,
    }),
    buildCookie(REFRESH_COOKIE, input.refresh, cfg, {
      httpOnly: true,
      path: REFRESH_PATH,
      maxAgeSeconds: input.refreshMaxAge,
    }),
    buildCookie(CSRF_COOKIE, input.csrf, cfg, {
      httpOnly: false,
      path: '/',
      maxAgeSeconds: input.sessionMaxAge,
    }),
  ];
}

/** The Set-Cookie headers to clear the session (logout / invalid session). */
export function clearCookies(cfg: AuthConfig): string[] {
  const expire = (name: string, path: string, httpOnly: boolean): string =>
    buildCookie(name, '', cfg, { httpOnly, path, maxAgeSeconds: 0 });
  return [
    expire(SESSION_COOKIE, '/', true),
    expire(REFRESH_COOKIE, REFRESH_PATH, true),
    expire(CSRF_COOKIE, '/', false),
  ];
}
