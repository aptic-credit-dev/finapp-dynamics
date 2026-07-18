import { randomUUID } from 'node:crypto';
import { ProblemError, type Db, type SystemContext, type Tx } from '@finapp/kernel';
import { AuthRepository, type SessionRow } from './repository.ts';
import { type AuthEmitter } from './emit.ts';
import { AUTH_AUDIT_CODES } from './audit-codes.ts';
import { hashToken, newSecret } from './hashing.ts';
import {
  LAST_USED_WRITE_GRANULARITY_MS,
  REFRESH_TTL_MS,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
} from './domain/policy.ts';
import { sessionIsUsable, type SessionStatus } from './domain/session-lifecycle.ts';

/** A proven session, as the actor adapter needs it. Carries NO secret. */
export interface ResolvedSession {
  readonly sessionId: string;
  readonly accountId: string;
  readonly identityId: string;
  readonly assurance: 'password' | 'mfa' | 'federated';
}

/** What login/refresh hand back — the raw secrets exist ONLY here and in the response, never stored. */
export interface IssuedSession {
  readonly session: SessionRow;
  readonly rawToken: string;
  readonly rawRefresh: string;
}

export type RefreshOutcome =
  | { readonly outcome: 'rotated'; readonly issued: IssuedSession }
  | { readonly outcome: 'invalid' }
  | { readonly outcome: 'reuse' };

/** A session as safe to return over the API — no token hashes, no secrets. */
export interface SessionView {
  readonly id: string;
  readonly status: string;
  readonly assurance: string;
  readonly authenticatedAt: Date;
  readonly issuedAt: Date;
  readonly lastUsedAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly clientIp: string | null;
  readonly userAgent: string | null;
  readonly current: boolean;
}

export class SessionService {
  private readonly db: Db;
  private readonly emitter: AuthEmitter;
  private readonly repo: AuthRepository;

  constructor(db: Db, emitter: AuthEmitter, repo: AuthRepository = new AuthRepository()) {
    this.db = db;
    this.emitter = emitter;
    this.repo = repo;
  }

  /** Issues a fresh session (session fixation prevented: every login mints a new id + family). In-tx. */
  async issueInTx(
    tx: Tx,
    sys: SystemContext,
    input: {
      accountId: string;
      identityId: string;
      assurance: 'password' | 'mfa' | 'federated';
      clientIp: string | null;
      userAgent: string | null;
      selectedTenantId: string | null;
    },
  ): Promise<IssuedSession> {
    const now = Date.now();
    const rawToken = newSecret();
    const rawRefresh = newSecret();
    const rotationFamily = randomUUID();
    const absoluteExpiresAt = new Date(now + SESSION_ABSOLUTE_TTL_MS);
    const idleExpiresAt = new Date(Math.min(now + SESSION_IDLE_TTL_MS, absoluteExpiresAt.getTime()));

    const session = await this.repo.insertSession(tx, {
      accountId: input.accountId,
      identityId: input.identityId,
      tokenHash: hashToken(rawToken),
      rotationFamily,
      assurance: input.assurance,
      idleExpiresAt,
      absoluteExpiresAt,
      clientIp: input.clientIp,
      userAgent: input.userAgent,
      selectedTenantId: input.selectedTenantId,
    });
    await this.repo.insertRefreshToken(tx, {
      refreshTokenHash: hashToken(rawRefresh),
      sessionId: session.id,
      accountId: input.accountId,
      rotationFamily,
      tokenVersion: session.token_version,
      expiresAt: new Date(now + REFRESH_TTL_MS),
    });
    await this.repo.appendHistory(tx, {
      sessionId: session.id,
      accountId: input.accountId,
      fromStatus: null,
      toStatus: 'active',
      action: 'issue',
      reason: null,
      tokenVersion: session.token_version,
      correlationId: sys.correlationId,
      changedBy: input.identityId,
    });
    await this.emitter.recordAudit(tx, sys, {
      code: AUTH_AUDIT_CODES.sessionIssued,
      entityType: 'session',
      entityId: session.id,
    });
    await this.emitter.publish(tx, 'SessionIssued', sys.correlationId, input.identityId, {
      sessionId: session.id,
      accountId: input.accountId,
      rotationFamily,
      toStatus: 'active',
    });
    return { session, rawToken, rawRefresh };
  }

  /**
   * Resolves the access token to a usable session, sliding the idle window. A session past its idle or
   * absolute bound is expired in place (history + event) and treated as absent. Opens its own withSystem.
   */
  async resolveToken(rawToken: string | undefined): Promise<ResolvedSession | null> {
    if (rawToken === undefined || rawToken === '') return null;
    const correlationId = randomUUID();
    const sys: SystemContext = { reason: 'resolve session (m02-auth)', correlationId };
    return this.db.withSystem(sys, async (tx) => {
      const session = await this.repo.findByTokenHash(tx, hashToken(rawToken));
      if (session === null) return null;
      const now = Date.now();
      if (
        !sessionIsUsable(
          session.status as SessionStatus,
          now,
          session.idle_expires_at.getTime(),
          session.absolute_expires_at.getTime(),
        )
      ) {
        if (session.status === 'active') await this.expire(tx, sys, session);
        return null;
      }
      // Slide the idle window, but only write when it has actually moved — protects the hot row.
      if (now - session.last_used_at.getTime() >= LAST_USED_WRITE_GRANULARITY_MS) {
        const idleExpiresAt = new Date(
          Math.min(now + SESSION_IDLE_TTL_MS, session.absolute_expires_at.getTime()),
        );
        await this.repo.touchLastUsed(tx, { id: session.id, lastUsedAt: new Date(now), idleExpiresAt });
      }
      return {
        sessionId: session.id,
        accountId: session.account_id,
        identityId: session.identity_id,
        assurance: session.assurance as 'password' | 'mfa' | 'federated',
      };
    });
  }

  /** Rotates a refresh token. Reuse of a consumed token revokes the whole family. Opens its own withSystem. */
  async refresh(rawRefresh: string | undefined): Promise<RefreshOutcome> {
    if (rawRefresh === undefined || rawRefresh === '') return { outcome: 'invalid' };
    const correlationId = randomUUID();
    const sys: SystemContext = { reason: 'refresh session (m02-auth)', correlationId };
    return this.db.withSystem(sys, async (tx): Promise<RefreshOutcome> => {
      const ledger = await this.repo.findRefreshToken(tx, hashToken(rawRefresh));
      if (ledger === null) return { outcome: 'invalid' };

      // THE THEFT SIGNAL: a refresh token presented after it was already consumed. Revoke the family.
      if (ledger.consumed_at !== null) {
        await this.revokeFamilyInTx(tx, sys, ledger.rotation_family, ledger.account_id, 'refresh_reuse');
        return { outcome: 'reuse' };
      }
      if (Date.now() >= ledger.expires_at.getTime()) return { outcome: 'invalid' };

      // Consume exactly once. Losing this race (a concurrent use of the same token) is itself reuse.
      if (!(await this.repo.consumeRefreshToken(tx, ledger.refresh_token_hash))) {
        await this.revokeFamilyInTx(tx, sys, ledger.rotation_family, ledger.account_id, 'refresh_reuse');
        return { outcome: 'reuse' };
      }

      const session = await this.repo.findSessionById(tx, ledger.session_id);
      if (session?.status !== 'active') return { outcome: 'invalid' };
      const now = Date.now();
      if (now >= session.absolute_expires_at.getTime()) {
        await this.expire(tx, sys, session);
        return { outcome: 'invalid' };
      }

      const rawToken = newSecret();
      const idleExpiresAt = new Date(
        Math.min(now + SESSION_IDLE_TTL_MS, session.absolute_expires_at.getTime()),
      );
      const rotated = await this.repo.rotate(tx, {
        id: session.id,
        newTokenHash: hashToken(rawToken),
        idleExpiresAt,
        lastUsedAt: new Date(now),
      });
      if (rotated === null) return { outcome: 'invalid' };

      const rawRefreshNext = newSecret();
      await this.repo.insertRefreshToken(tx, {
        refreshTokenHash: hashToken(rawRefreshNext),
        sessionId: session.id,
        accountId: session.account_id,
        rotationFamily: session.rotation_family,
        tokenVersion: rotated.token_version,
        expiresAt: new Date(now + REFRESH_TTL_MS),
      });
      await this.repo.appendHistory(tx, {
        sessionId: session.id,
        accountId: session.account_id,
        fromStatus: 'active',
        toStatus: 'active',
        action: 'refresh',
        reason: null,
        tokenVersion: rotated.token_version,
        correlationId: sys.correlationId,
        changedBy: session.identity_id,
      });
      await this.emitter.recordAudit(tx, sys, {
        code: AUTH_AUDIT_CODES.sessionRefreshed,
        entityType: 'session',
        entityId: session.id,
      });
      await this.emitter.publish(tx, 'SessionRefreshed', sys.correlationId, session.identity_id, {
        sessionId: session.id,
        accountId: session.account_id,
        rotationFamily: session.rotation_family,
        toStatus: 'active',
      });
      return { outcome: 'rotated', issued: { session: rotated, rawToken, rawRefresh: rawRefreshNext } };
    });
  }

  /** Revokes one session for `accountId` (self logout, self-revoke). Cross-account → notFound (§13). */
  async revokeOwn(
    ctx: { correlationId: string },
    input: { sessionId: string; accountId: string; actor: string | null; reason: string },
  ): Promise<void> {
    await this.revokeGuarded(ctx, { ...input, requireAccount: input.accountId });
  }

  /** Administrative revocation of any session (behind auth.session.revoke). */
  async revokeAdmin(
    ctx: { correlationId: string },
    input: { sessionId: string; actor: string | null; reason: string },
  ): Promise<void> {
    await this.revokeGuarded(ctx, { ...input, requireAccount: null });
  }

  private async revokeGuarded(
    ctx: { correlationId: string },
    input: { sessionId: string; requireAccount: string | null; actor: string | null; reason: string },
  ): Promise<void> {
    const sys: SystemContext = { reason: 'revoke session (m02-auth)', correlationId: ctx.correlationId };
    await this.db.withSystem(sys, async (tx) => {
      const session = await this.repo.findSessionById(tx, input.sessionId);
      // Non-disclosing: a session that is not yours reads exactly like one that never existed.
      if (
        session === null ||
        (input.requireAccount !== null && session.account_id !== input.requireAccount)
      ) {
        throw ProblemError.notFound('Session not found.', ctx.correlationId);
      }
      if (session.status !== 'active') return; // already gone — idempotent
      await this.transition(tx, sys, session, 'revoked', 'revoke', input.reason, input.actor);
    });
  }

  /** Revokes every active session for an account. Used on password change and account/identity suspension. */
  async revokeAllForAccountInTx(
    tx: Tx,
    sys: SystemContext,
    accountId: string,
    reason: string,
    actor: string | null,
  ): Promise<number> {
    const ids = await this.repo.revokeAllForAccount(tx, accountId, reason);
    for (const id of ids) {
      await this.repo.appendHistory(tx, {
        sessionId: id,
        accountId,
        fromStatus: 'active',
        toStatus: 'revoked',
        action: 'revoke',
        reason,
        tokenVersion: 0,
        correlationId: sys.correlationId,
        changedBy: actor,
      });
      await this.emitter.publish(tx, 'SessionRevoked', sys.correlationId, actor, {
        sessionId: id,
        accountId,
        rotationFamily: id,
        fromStatus: 'active',
        toStatus: 'revoked',
        reason,
      });
    }
    if (ids.length > 0) {
      await this.emitter.recordAudit(tx, sys, {
        code: AUTH_AUDIT_CODES.sessionRevoked,
        entityType: 'account',
        entityId: accountId,
        reason,
        detail: { revokedCount: ids.length },
      });
    }
    return ids.length;
  }

  async list(
    ctx: { correlationId: string },
    accountId: string,
    currentSessionId: string | null,
  ): Promise<SessionView[]> {
    const sys: SystemContext = { reason: 'list sessions (m02-auth)', correlationId: ctx.correlationId };
    const rows = await this.db.withSystem(sys, (tx) => this.repo.listByAccount(tx, accountId, false));
    return rows.map((s) => ({
      id: s.id,
      status: s.status,
      assurance: s.assurance,
      authenticatedAt: s.authenticated_at,
      issuedAt: s.issued_at,
      lastUsedAt: s.last_used_at,
      idleExpiresAt: s.idle_expires_at,
      absoluteExpiresAt: s.absolute_expires_at,
      clientIp: s.client_ip,
      userAgent: s.user_agent,
      current: currentSessionId !== null && s.id === currentSessionId,
    }));
  }

  // --- internal transitions -----------------------------------------------------------------------

  private async revokeFamilyInTx(
    tx: Tx,
    sys: SystemContext,
    rotationFamily: string,
    accountId: string,
    reason: string,
  ): Promise<void> {
    const ids = await this.repo.revokeFamily(tx, rotationFamily, reason);
    for (const id of ids) {
      await this.repo.appendHistory(tx, {
        sessionId: id,
        accountId,
        fromStatus: 'active',
        toStatus: 'revoked',
        action: 'revoke',
        reason,
        tokenVersion: 0,
        correlationId: sys.correlationId,
        changedBy: null,
      });
      await this.emitter.publish(tx, 'SessionRevoked', sys.correlationId, null, {
        sessionId: id,
        accountId,
        rotationFamily,
        fromStatus: 'active',
        toStatus: 'revoked',
        reason,
      });
    }
    await this.emitter.recordAudit(tx, sys, {
      code: AUTH_AUDIT_CODES.sessionRevoked,
      entityType: 'session_family',
      entityId: rotationFamily,
      reason,
      detail: { revokedCount: ids.length },
    });
  }

  private async expire(tx: Tx, sys: SystemContext, session: SessionRow): Promise<void> {
    const updated = await this.repo.setStatus(tx, { id: session.id, toStatus: 'expired', reason: null });
    if (updated === null) return;
    await this.repo.appendHistory(tx, {
      sessionId: session.id,
      accountId: session.account_id,
      fromStatus: 'active',
      toStatus: 'expired',
      action: 'expire',
      reason: null,
      tokenVersion: session.token_version,
      correlationId: sys.correlationId,
      changedBy: null,
    });
    await this.emitter.recordAudit(tx, sys, {
      code: AUTH_AUDIT_CODES.sessionExpired,
      entityType: 'session',
      entityId: session.id,
    });
    await this.emitter.publish(tx, 'SessionExpired', sys.correlationId, null, {
      sessionId: session.id,
      accountId: session.account_id,
      rotationFamily: session.rotation_family,
      fromStatus: 'active',
      toStatus: 'expired',
    });
  }

  private async transition(
    tx: Tx,
    sys: SystemContext,
    session: SessionRow,
    toStatus: 'revoked',
    action: 'revoke',
    reason: string,
    actor: string | null,
  ): Promise<void> {
    const updated = await this.repo.setStatus(tx, { id: session.id, toStatus, reason });
    if (updated === null) return;
    await this.repo.appendHistory(tx, {
      sessionId: session.id,
      accountId: session.account_id,
      fromStatus: session.status,
      toStatus,
      action,
      reason,
      tokenVersion: session.token_version,
      correlationId: sys.correlationId,
      changedBy: actor,
    });
    await this.emitter.recordAudit(tx, sys, {
      code: AUTH_AUDIT_CODES.sessionRevoked,
      entityType: 'session',
      entityId: session.id,
      reason,
    });
    await this.emitter.publish(tx, 'SessionRevoked', sys.correlationId, actor, {
      sessionId: session.id,
      accountId: session.account_id,
      rotationFamily: session.rotation_family,
      fromStatus: session.status,
      toStatus,
      reason,
    });
  }
}
