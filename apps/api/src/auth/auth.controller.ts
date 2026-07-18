import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { AUTHZ, Endpoint, ProblemError } from '@finapp/kernel';
import type { Authz } from '@finapp/kernel';
import { ActorContextFactory, requireUuidParam } from '@finapp/m02-identity';
import {
  AUTH_AUDIT_CODES,
  AUTH_PERMISSIONS,
  AuthService,
  CSRF_COOKIE,
  REFRESH_TTL_MS,
  SESSION_ABSOLUTE_TTL_MS,
  SessionService,
} from '@finapp/m02-auth';
import { AUTH_CONFIG } from '../actor/actor.module.ts';
import type { AuthConfig } from './config.ts';
import { clearCookies, readCookie, REFRESH_COOKIE, sessionCookies } from './cookies.ts';

/**
 * The authentication & session API, under `/api/v1/auth` (auth:mixed — login/refresh are pre-auth).
 *
 * Sessions ride in Secure, HttpOnly, SameSite cookies (ADR-015). State-changing authenticated requests
 * carry a CSRF token (double-submit): the value in the non-HttpOnly `finapp_csrf` cookie must match the
 * `x-csrf-token` header. Login is exempt — there is no session to ride a forged request, and it mints fresh
 * cookies; the login-CSRF risk (logging a victim into an attacker account) is bounded by SameSite=Lax.
 *
 * No response ever carries a password, a hash, a session/refresh secret, or a token hash.
 */

interface HttpRes {
  setHeader(name: string, value: string | string[]): void;
}

@Controller('auth')
export class AuthController {
  private readonly auth: AuthService;
  private readonly sessions: SessionService;
  private readonly actors: ActorContextFactory;
  private readonly authz: Authz;
  private readonly config: AuthConfig;

  constructor(
    auth: AuthService,
    sessions: SessionService,
    actors: ActorContextFactory,
    @Inject(AUTHZ) authz: Authz,
    @Inject(AUTH_CONFIG) config: AuthConfig,
  ) {
    this.auth = auth;
    this.sessions = sessions;
    this.actors = actors;
    this.authz = authz;
    this.config = config;
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { loginIdentifier?: unknown; password?: unknown },
    @Headers() headers: Record<string, string>,
    @Res({ passthrough: true }) res: HttpRes,
  ) {
    const success = await this.auth.login({
      loginIdentifier: requireString(body.loginIdentifier, 'loginIdentifier'),
      password: requireString(body.password, 'password'),
      clientIp: clientIpOf(headers),
      userAgent: headers['user-agent'] ?? null,
    });
    res.setHeader(
      'Set-Cookie',
      sessionCookies(this.config, {
        token: success.issued.rawToken,
        refresh: success.issued.rawRefresh,
        csrf: success.csrfToken,
        sessionMaxAge: Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000),
        refreshMaxAge: Math.floor(REFRESH_TTL_MS / 1000),
      }),
    );
    return { authenticated: true, csrfToken: success.csrfToken };
  }

  @Post('session/refresh')
  @HttpCode(200)
  async refresh(@Headers() headers: Record<string, string>, @Res({ passthrough: true }) res: HttpRes) {
    const raw = readCookie(headers, REFRESH_COOKIE);
    const outcome = await this.sessions.refresh(raw);
    if (outcome.outcome !== 'rotated') {
      // Both an invalid token and a detected REUSE clear the cookies. Reuse has already revoked the family.
      res.setHeader('Set-Cookie', clearCookies(this.config));
      throw ProblemError.unauthorized('Session could not be refreshed.');
    }
    const csrf = readCookie(headers, CSRF_COOKIE) ?? '';
    res.setHeader(
      'Set-Cookie',
      sessionCookies(this.config, {
        token: outcome.issued.rawToken,
        refresh: outcome.issued.rawRefresh,
        csrf,
        sessionMaxAge: Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000),
        refreshMaxAge: Math.floor(REFRESH_TTL_MS / 1000),
      }),
    );
    return { refreshed: true };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Headers() headers: Record<string, string>, @Res({ passthrough: true }) res: HttpRes) {
    const { actor, correlationId } = await this.actors.forPlatformRequest(headers, 'logout (m02-auth)');
    if (actor.sessionRef !== undefined) {
      await this.auth.logout(
        { correlationId },
        { sessionId: actor.sessionRef, accountId: actor.accountId, actor: actor.identityId },
      );
    }
    res.setHeader('Set-Cookie', clearCookies(this.config));
    return { loggedOut: true };
  }

  @Get('session')
  async currentSession(@Headers() headers: Record<string, string>) {
    const { actor, correlationId } = await this.actors.forPlatformRequest(headers, 'read session (m02-auth)');
    const views = await this.sessions.list({ correlationId }, actor.accountId, actor.sessionRef ?? null);
    const current = views.find((v) => v.current);
    if (current === undefined) throw ProblemError.unauthorized('No active session.', correlationId);
    return current;
  }

  @Get('sessions')
  async listSessions(@Headers() headers: Record<string, string>) {
    const { actor, correlationId } = await this.actors.forPlatformRequest(
      headers,
      'list sessions (m02-auth)',
    );
    return this.sessions.list({ correlationId }, actor.accountId, actor.sessionRef ?? null);
  }

  @Post('sessions/:sessionId/revoke')
  @HttpCode(200)
  async revokeOwn(@Param('sessionId') sessionId: string, @Headers() headers: Record<string, string>) {
    const { actor, correlationId } = await this.actors.forPlatformRequest(
      headers,
      'revoke own session (m02-auth)',
    );
    await this.sessions.revokeOwn(
      { correlationId },
      {
        sessionId: requireUuidParam(sessionId, 'sessionId', correlationId),
        accountId: actor.accountId,
        actor: actor.identityId,
        reason: 'self_revoke',
      },
    );
    return { revoked: true };
  }

  // --- administrative (cross-account) — separately authorized -------------------------------------

  @Get('admin/sessions')
  async adminList(@Query('accountId') accountId: string, @Headers() headers: Record<string, string>) {
    const { ctx, correlationId } = await this.actors.forPlatformRequest(
      headers,
      'admin list sessions (m02-auth)',
    );
    await this.authz.require(ctx, AUTH_PERMISSIONS.sessionView);
    return this.sessions.list(
      { correlationId },
      requireUuidParam(accountId, 'accountId', correlationId),
      null,
    );
  }

  @Endpoint({
    permission: AUTH_PERMISSIONS.sessionRevoke,
    auditCode: AUTH_AUDIT_CODES.sessionRevoked,
    description: 'Administratively revoke any session.',
  })
  @Post('admin/sessions/:sessionId/revoke')
  @HttpCode(200)
  async adminRevoke(@Param('sessionId') sessionId: string, @Headers() headers: Record<string, string>) {
    const { ctx, actor, correlationId } = await this.actors.forPlatformRequest(
      headers,
      'admin revoke session (m02-auth)',
    );
    await this.authz.require(ctx, AUTH_PERMISSIONS.sessionRevoke);
    await this.sessions.revokeAdmin(
      { correlationId },
      {
        sessionId: requireUuidParam(sessionId, 'sessionId', correlationId),
        actor: actor.identityId,
        reason: 'admin_revoke',
      },
    );
    return { revoked: true };
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProblemError({
      type: 'https://finapp.dynamics/problems/validation',
      title: 'Bad Request',
      status: 400,
      detail: `${field} is required.`,
    });
  }
  return value;
}

/** First hop of x-forwarded-for, else null. Behind a trusted proxy this is the client; policy-gated. */
function clientIpOf(headers: Record<string, string>): string | null {
  const xff = headers['x-forwarded-for'];
  if (xff === undefined || xff.trim() === '') return null;
  return xff.split(',')[0]?.trim() ?? null;
}
