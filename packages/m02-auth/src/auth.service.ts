import { randomUUID } from 'node:crypto';
import { ProblemError, type Db, type SystemContext } from '@finapp/kernel';
import {
  accountCanResolve,
  identityCanResolve,
  isAccountStatus,
  isIdentityStatus,
  normalizeUsername,
} from '@finapp/m02-identity';
import { AuthRepository } from './repository.ts';
import { type AuthEmitter } from './emit.ts';
import { type CredentialService } from './credential.service.ts';
import { AttemptService } from './attempt.service.ts';
import { type SessionService, type IssuedSession } from './session.service.ts';
import { AUTH_AUDIT_CODES } from './audit-codes.ts';
import { newCsrfToken } from './csrf.ts';
import { hashLoginRef } from './hashing.ts';
import { AUTH_FAILURE, GENERIC_AUTH_FAILURE_MESSAGE, type AuthFailureCategory } from './domain/policy.ts';

/**
 * Login orchestration (Part H's core) — the one transaction that ties throttling, credential verification,
 * rehash and session issuance together.
 *
 * WHY THE FAILURE PATH DOES NOT THROW INSIDE THE TRANSACTION: a failed `login_attempts` row MUST commit,
 * or lockout could never accumulate — every failure would roll back its own evidence. So the withSystem
 * callback returns a result; the generic 401 is thrown AFTER it commits. Every external failure is byte-
 * identical (`Invalid credentials.`); the specific category is recorded internally only.
 */
export interface LoginInput {
  readonly loginIdentifier: string;
  readonly password: string;
  readonly clientIp: string | null;
  readonly userAgent: string | null;
}

export interface LoginSuccess {
  readonly issued: IssuedSession;
  readonly csrfToken: string;
  readonly identityId: string;
  readonly accountId: string;
}

export class AuthService {
  private readonly db: Db;
  private readonly emitter: AuthEmitter;
  private readonly repo: AuthRepository;
  private readonly credentials: CredentialService;
  private readonly attempts: AttemptService;
  private readonly sessions: SessionService;

  constructor(
    db: Db,
    emitter: AuthEmitter,
    credentials: CredentialService,
    sessions: SessionService,
    repo: AuthRepository = new AuthRepository(),
    attempts: AttemptService = new AttemptService(repo),
  ) {
    this.db = db;
    this.emitter = emitter;
    this.repo = repo;
    this.credentials = credentials;
    this.attempts = attempts;
    this.sessions = sessions;
  }

  async login(input: LoginInput): Promise<LoginSuccess> {
    const correlationId = randomUUID();
    const loginNorm = normalizeUsername(input.loginIdentifier);
    const loginRefHash = hashLoginRef(loginNorm);
    const sys: SystemContext = { reason: 'login (m02-auth)', correlationId };

    const result = await this.db.withSystem(
      sys,
      async (
        tx,
      ): Promise<{ ok: true; success: LoginSuccess } | { ok: false; category: AuthFailureCategory }> => {
        const fail = async (category: AuthFailureCategory, accountId: string | null) => {
          await this.attempts.record(tx, {
            loginRefHash,
            accountId,
            outcome: 'failed',
            failureReason: category,
            clientIp: input.clientIp,
            userAgent: input.userAgent,
            correlationId,
          });
          await this.emitter.recordAudit(tx, sys, {
            code: AUTH_AUDIT_CODES.loginFailed,
            entityType: 'account',
            entityId: accountId ?? '00000000-0000-0000-0000-000000000000',
            detail: { reasonCategory: category },
          });
          await this.emitter.publish(tx, 'AuthenticationFailed', correlationId, null, {
            ...(accountId === null ? {} : { accountId }),
            reasonCategory: category,
          });
          return { ok: false as const, category };
        };

        const now = new Date();
        // Fail closed on throttle/lockout BEFORE touching credentials — a locked identifier or a stuffing
        // source is refused without even a hash comparison.
        if (await this.attempts.isThrottled(tx, input.clientIp, now))
          return fail(AUTH_FAILURE.throttled, null);
        if (await this.attempts.isLockedOut(tx, loginRefHash, now)) return fail(AUTH_FAILURE.lockedOut, null);

        const account = await this.repo.findLoginAccount(tx, loginNorm);
        if (account === null) return fail(AUTH_FAILURE.noSuchAccount, null);

        // The person and the login must both be in a resolvable state — a suspended identity/account can
        // never obtain a session (and the same generic failure hides which).
        const acctResolvable =
          isAccountStatus(account.account_status) && accountCanResolve(account.account_status);
        const idResolvable =
          isIdentityStatus(account.identity_status) && identityCanResolve(account.identity_status);
        if (!acctResolvable || !idResolvable) {
          return fail(AUTH_FAILURE.accountNotResolvable, account.account_id);
        }

        const verify = await this.credentials.verifyInTx(tx, account.account_id, input.password);
        if (!verify.verified) {
          return fail(verify.category ?? AUTH_FAILURE.invalidCredential, account.account_id);
        }
        if (verify.needsRehash && verify.credential !== null) {
          await this.credentials.rehashInTx(tx, sys, verify.credential, input.password, account.identity_id);
        }

        const issued = await this.sessions.issueInTx(tx, sys, {
          accountId: account.account_id,
          identityId: account.identity_id,
          assurance: 'password',
          clientIp: input.clientIp,
          userAgent: input.userAgent,
          selectedTenantId: null,
        });

        await this.attempts.record(tx, {
          loginRefHash,
          accountId: account.account_id,
          outcome: 'succeeded',
          failureReason: null,
          clientIp: input.clientIp,
          userAgent: input.userAgent,
          correlationId,
        });
        await this.emitter.recordAudit(tx, sys, {
          code: AUTH_AUDIT_CODES.loginSucceeded,
          entityType: 'account',
          entityId: account.account_id,
        });
        await this.emitter.publish(tx, 'AuthenticationSucceeded', correlationId, account.identity_id, {
          accountId: account.account_id,
          assurance: 'password',
        });

        return {
          ok: true,
          success: {
            issued,
            csrfToken: newCsrfToken(),
            identityId: account.identity_id,
            accountId: account.account_id,
          },
        };
      },
    );

    if (!result.ok) throw ProblemError.unauthorized(GENERIC_AUTH_FAILURE_MESSAGE, correlationId);
    return result.success;
  }

  /** Logout — revoke the caller's current session. */
  async logout(
    ctx: { correlationId: string },
    input: { sessionId: string; accountId: string; actor: string | null },
  ): Promise<void> {
    await this.sessions.revokeOwn(ctx, {
      sessionId: input.sessionId,
      accountId: input.accountId,
      actor: input.actor,
      reason: 'logout',
    });
  }

  /** Changes a password and revokes every existing session for the account, atomically. */
  async changePassword(
    ctx: { correlationId: string },
    input: { accountId: string; newPassword: string; actor: string | null },
  ): Promise<void> {
    const sys: SystemContext = { reason: 'change password (m02-auth)', correlationId: ctx.correlationId };
    await this.db.withSystem(sys, async (tx) => {
      await this.credentials.changePasswordInTx(tx, sys, {
        accountId: input.accountId,
        newPassword: input.newPassword,
        actor: input.actor,
      });
      await this.sessions.revokeAllForAccountInTx(tx, sys, input.accountId, 'password_change', input.actor);
    });
  }
}
