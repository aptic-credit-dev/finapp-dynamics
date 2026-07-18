import { Injectable, type NestMiddleware } from '@nestjs/common';
import { CSRF_COOKIE, CSRF_HEADER, csrfMatches } from '@finapp/m02-auth';
import { parseCookies, SESSION_COOKIE } from './cookies.ts';

/**
 * Global CSRF guard (ADR-015 §18). Every state-changing request that carries a session cookie must echo
 * the double-submit CSRF token (the `finapp_csrf` cookie value in the `x-csrf-token` header). A cross-site
 * attacker can make the browser SEND the session cookie but cannot READ the CSRF cookie to echo it.
 *
 * Login is naturally exempt: it carries no session cookie yet. Safe (GET/HEAD/OPTIONS) methods are exempt.
 * A failure is written directly as RFC-9457 problem+json — middleware runs before the Nest filter pipeline.
 */
interface Req {
  method: string;
  headers: Record<string, string | string[] | undefined>;
}
interface Res {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Req, res: Res, next: () => void): void {
    if (SAFE.has(req.method)) {
      next();
      return;
    }
    const cookieHeader = req.headers['cookie'];
    const cookies = parseCookies(typeof cookieHeader === 'string' ? cookieHeader : undefined);
    // No session cookie → not a cookie-authenticated request (e.g. login). Nothing to protect here.
    if (cookies[SESSION_COOKIE] === undefined) {
      next();
      return;
    }
    const headerToken = req.headers[CSRF_HEADER];
    if (csrfMatches(cookies[CSRF_COOKIE], typeof headerToken === 'string' ? headerToken : undefined)) {
      next();
      return;
    }
    res.statusCode = 403;
    res.setHeader('content-type', 'application/problem+json');
    res.end(
      JSON.stringify({
        type: 'https://finapp.dynamics/problems/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: 'CSRF token missing or invalid.',
      }),
    );
  }
}
