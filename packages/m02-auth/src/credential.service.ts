import { ProblemError, type Db, type SystemContext, type Tx } from '@finapp/kernel';
import { AuthRepository, type CredentialRow } from './repository.ts';
import { type AuthEmitter } from './emit.ts';
import { AUTH_AUDIT_CODES } from './audit-codes.ts';
import { needsRehash, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './domain/policy.ts';
import { selectPasswordHasher, verifyPassword, type PasswordHasher } from './hashing.ts';

/**
 * Password credentials (Part C, ADR-016). The only code that turns a password into stored material or
 * checks one against it. No plaintext or hash is ever logged, returned, or put in an event/audit detail.
 *
 * Standalone mutations open their own `Db.withSystem` (the credential plane is global). Verification runs
 * INSIDE the login transaction (`verifyInTx`), so a rehash commits with the successful login.
 */
export interface VerifyResult {
  readonly credential: CredentialRow | null;
  readonly verified: boolean;
  /** INTERNAL failure category — never surfaced to the caller. */
  readonly category: 'invalid_credential' | 'credential_disabled' | null;
  readonly needsRehash: boolean;
}

export class CredentialService {
  private readonly db: Db;
  private readonly emitter: AuthEmitter;
  private readonly repo: AuthRepository;
  private readonly hasher: PasswordHasher;

  constructor(
    db: Db,
    emitter: AuthEmitter,
    repo: AuthRepository = new AuthRepository(),
    hasher: PasswordHasher = selectPasswordHasher(),
  ) {
    this.db = db;
    this.emitter = emitter;
    this.repo = repo;
    this.hasher = hasher;
  }

  /** Sets the initial password credential for an account. Fails if the account already has a live one. */
  async createCredential(
    ctx: { correlationId: string },
    input: { accountId: string; password: string; actor: string | null },
  ): Promise<{ credentialId: string }> {
    validatePassword(input.password, ctx.correlationId);
    const hashed = await this.hasher.hash(input.password);
    const sys: SystemContext = {
      reason: 'set password credential (m02-auth)',
      correlationId: ctx.correlationId,
    };

    return this.db.withSystem(sys, async (tx) => {
      if (!(await this.repo.accountExists(tx, input.accountId))) {
        throw ProblemError.notFound('Account not found.', ctx.correlationId);
      }
      let credential: CredentialRow;
      try {
        credential = await this.repo.insertCredential(tx, {
          accountId: input.accountId,
          algorithm: hashed.algorithm,
          params: hashed.params as unknown as Record<string, unknown>,
          secretHash: hashed.encoded,
          createdBy: input.actor,
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          throw ProblemError.conflict('The account already has a password credential.', ctx.correlationId);
        }
        throw error;
      }
      await this.emitter.recordAudit(tx, sys, {
        code: AUTH_AUDIT_CODES.credentialCreated,
        entityType: 'authentication_credential',
        entityId: credential.id,
      });
      await this.emitter.publish(tx, 'CredentialCreated', ctx.correlationId, input.actor, {
        credentialId: credential.id,
        accountId: input.accountId,
        credentialType: 'password',
      });
      return { credentialId: credential.id };
    });
  }

  /** Verifies a password against the account's active credential — inside the login transaction. */
  async verifyInTx(tx: Tx, accountId: string, password: string): Promise<VerifyResult> {
    const credential = await this.repo.findActiveCredential(tx, accountId);
    if (credential === null) {
      return { credential: null, verified: false, category: 'credential_disabled', needsRehash: false };
    }
    const verified = await verifyPassword(credential.algorithm, credential.secret_hash, password);
    return {
      credential,
      verified,
      category: verified ? null : 'invalid_credential',
      needsRehash: verified && needsRehash(credential.algorithm, credential.params),
    };
  }

  /** Transparent upgrade after a successful verify — same transaction as the login. */
  async rehashInTx(
    tx: Tx,
    sys: SystemContext,
    credential: CredentialRow,
    password: string,
    actor: string | null,
  ): Promise<void> {
    const hashed = await this.hasher.hash(password);
    await this.repo.updateCredentialSecret(tx, {
      id: credential.id,
      algorithm: hashed.algorithm,
      params: hashed.params as unknown as Record<string, unknown>,
      secretHash: hashed.encoded,
    });
    await this.emitter.recordAudit(tx, sys, {
      code: AUTH_AUDIT_CODES.credentialChanged,
      entityType: 'authentication_credential',
      entityId: credential.id,
      detail: { reason: 'rehash' },
    });
    await this.emitter.publish(tx, 'CredentialChanged', sys.correlationId, actor, {
      credentialId: credential.id,
      accountId: credential.account_id,
      credentialType: 'password',
      reason: 'rehash',
    });
  }

  /** Changes the account's password IN a caller-supplied transaction (orchestrated with session revoke). */
  async changePasswordInTx(
    tx: Tx,
    sys: SystemContext,
    input: { accountId: string; newPassword: string; actor: string | null },
  ): Promise<string> {
    validatePassword(input.newPassword, sys.correlationId);
    const credential = await this.repo.findActiveCredential(tx, input.accountId);
    if (credential === null) throw ProblemError.notFound('No credential to change.', sys.correlationId);
    const hashed = await this.hasher.hash(input.newPassword);
    await this.repo.updateCredentialSecret(tx, {
      id: credential.id,
      algorithm: hashed.algorithm,
      params: hashed.params as unknown as Record<string, unknown>,
      secretHash: hashed.encoded,
    });
    await this.emitter.recordAudit(tx, sys, {
      code: AUTH_AUDIT_CODES.credentialChanged,
      entityType: 'authentication_credential',
      entityId: credential.id,
    });
    await this.emitter.publish(tx, 'CredentialChanged', sys.correlationId, input.actor, {
      credentialId: credential.id,
      accountId: input.accountId,
      credentialType: 'password',
    });
    return credential.id;
  }

  async disableCredential(
    ctx: { correlationId: string },
    input: { accountId: string; reason: string; actor: string | null },
  ): Promise<void> {
    const sys: SystemContext = { reason: 'disable credential (m02-auth)', correlationId: ctx.correlationId };
    await this.db.withSystem(sys, async (tx) => {
      const credential = await this.repo.findActiveCredential(tx, input.accountId);
      if (credential === null) throw ProblemError.notFound('No credential to disable.', ctx.correlationId);
      await this.repo.disableCredential(tx, { id: credential.id, reason: input.reason });
      await this.emitter.recordAudit(tx, sys, {
        code: AUTH_AUDIT_CODES.credentialDisabled,
        entityType: 'authentication_credential',
        entityId: credential.id,
        reason: input.reason,
      });
      await this.emitter.publish(tx, 'CredentialDisabled', ctx.correlationId, input.actor, {
        credentialId: credential.id,
        accountId: input.accountId,
        credentialType: 'password',
        reason: input.reason,
      });
    });
  }
}

function validatePassword(password: string, correlationId: string): void {
  if (
    typeof password !== 'string' ||
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new ProblemError({
      type: 'https://finapp.dynamics/problems/validation',
      title: 'Bad Request',
      status: 400,
      detail: `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
      correlationId,
    });
  }
}

/** PostgreSQL 23505 — unique_violation. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && (error as { code?: unknown } | null)?.code === '23505';
}
