import type { Tx } from '@finapp/kernel';
import { firstRow } from '@finapp/m02-identity';

/**
 * Persistence for m02-auth. Every method runs inside a caller-supplied `Tx` that is ALWAYS a
 * `Db.withSystem` transaction — the auth plane is global with a system escape, so the RLS policy admits
 * these rows only under system context. The services own that decision; this file just runs the SQL.
 *
 * READING user_accounts / identities here is within-module access: m02-auth is substage 1C of the SAME
 * m02 module that owns those tables (identity plane), not a foreign module reaching across a boundary.
 */

export interface CredentialRow {
  readonly id: string;
  readonly account_id: string;
  readonly credential_type: string;
  readonly algorithm: string;
  readonly params: Record<string, unknown>;
  readonly secret_hash: string;
  readonly status: string;
  readonly version: number;
}

/** Account + identity status, resolved from a normalized login identifier. */
export interface LoginAccountRow {
  readonly account_id: string;
  readonly account_status: string;
  readonly account_type: string;
  readonly identity_id: string;
  readonly identity_status: string;
  readonly identity_type: string;
}

export interface SessionRow {
  readonly id: string;
  readonly account_id: string;
  readonly identity_id: string;
  readonly token_hash: string;
  readonly rotation_family: string;
  readonly token_version: number;
  readonly assurance: string;
  readonly authenticated_at: Date;
  readonly issued_at: Date;
  readonly last_used_at: Date;
  readonly idle_expires_at: Date;
  readonly absolute_expires_at: Date;
  readonly status: string;
  readonly revoked_at: Date | null;
  readonly revoked_reason: string | null;
  readonly client_ip: string | null;
  readonly user_agent: string | null;
  readonly selected_tenant_id: string | null;
}

export class AuthRepository {
  // --- accounts (identity plane, same module) -----------------------------------------------------

  async findLoginAccount(tx: Tx, loginNorm: string): Promise<LoginAccountRow | null> {
    const result = await tx.query<LoginAccountRow>(
      `SELECT a.id AS account_id, a.status AS account_status, a.account_type,
              i.id AS identity_id, i.status AS identity_status, i.identity_type
       FROM user_accounts a JOIN identities i ON i.id = a.identity_id
       WHERE a.login_identifier_norm = $1`,
      [loginNorm],
    );
    return result.rows[0] ?? null;
  }

  async accountExists(tx: Tx, accountId: string): Promise<boolean> {
    const result = await tx.query(`SELECT 1 FROM user_accounts WHERE id = $1`, [accountId]);
    return result.rows.length > 0;
  }

  async identityIdForAccount(tx: Tx, accountId: string): Promise<string | null> {
    const result = await tx.query<{ identity_id: string }>(
      `SELECT identity_id FROM user_accounts WHERE id = $1`,
      [accountId],
    );
    return result.rows[0]?.identity_id ?? null;
  }

  // --- credentials --------------------------------------------------------------------------------

  async findActiveCredential(tx: Tx, accountId: string): Promise<CredentialRow | null> {
    const result = await tx.query<CredentialRow>(
      `SELECT id, account_id, credential_type, algorithm, params, secret_hash, status, version
       FROM authentication_credentials
       WHERE account_id = $1 AND credential_type = 'password' AND status = 'active'`,
      [accountId],
    );
    return result.rows[0] ?? null;
  }

  async insertCredential(
    tx: Tx,
    input: {
      accountId: string;
      algorithm: string;
      params: Record<string, unknown>;
      secretHash: string;
      createdBy: string | null;
    },
  ): Promise<CredentialRow> {
    const result = await tx.query<CredentialRow>(
      `INSERT INTO authentication_credentials (account_id, algorithm, params, secret_hash, created_by)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       RETURNING id, account_id, credential_type, algorithm, params, secret_hash, status, version`,
      [input.accountId, input.algorithm, JSON.stringify(input.params), input.secretHash, input.createdBy],
    );
    return firstRow(result.rows, 'insert credential');
  }

  /** Replaces the live secret in place (rehash-on-login / password change), bumping version. */
  async updateCredentialSecret(
    tx: Tx,
    input: { id: string; algorithm: string; params: Record<string, unknown>; secretHash: string },
  ): Promise<void> {
    await tx.query(
      `UPDATE authentication_credentials
       SET algorithm = $2, params = $3::jsonb, secret_hash = $4, version = version + 1, last_changed_at = now()
       WHERE id = $1`,
      [input.id, input.algorithm, JSON.stringify(input.params), input.secretHash],
    );
  }

  async disableCredential(tx: Tx, input: { id: string; reason: string }): Promise<void> {
    await tx.query(
      `UPDATE authentication_credentials
       SET status = 'disabled', disabled_at = now(), disabled_reason = $2
       WHERE id = $1 AND status = 'active'`,
      [input.id, input.reason],
    );
  }

  // --- login attempts (append-only, pre-auth) -----------------------------------------------------

  async insertAttempt(
    tx: Tx,
    input: {
      loginRefHash: string;
      accountId: string | null;
      outcome: 'succeeded' | 'failed';
      failureReason: string | null;
      clientIp: string | null;
      userAgent: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO login_attempts (login_ref_hash, account_id, outcome, failure_reason, client_ip, user_agent, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.loginRefHash,
        input.accountId,
        input.outcome,
        input.failureReason,
        input.clientIp,
        input.userAgent,
        input.correlationId,
      ],
    );
  }

  async countRecentFailures(
    tx: Tx,
    input: { loginRefHash?: string; clientIp?: string; since: Date },
  ): Promise<number> {
    if (input.loginRefHash !== undefined) {
      const result = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM login_attempts
         WHERE outcome = 'failed' AND login_ref_hash = $1 AND created_at >= $2`,
        [input.loginRefHash, input.since],
      );
      return Number(result.rows[0]?.n ?? '0');
    }
    if (input.clientIp !== undefined) {
      const result = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM login_attempts
         WHERE outcome = 'failed' AND client_ip = $1 AND created_at >= $2`,
        [input.clientIp, input.since],
      );
      return Number(result.rows[0]?.n ?? '0');
    }
    return 0;
  }

  // --- sessions -----------------------------------------------------------------------------------

  async insertSession(
    tx: Tx,
    input: {
      accountId: string;
      identityId: string;
      tokenHash: string;
      rotationFamily: string;
      assurance: string;
      idleExpiresAt: Date;
      absoluteExpiresAt: Date;
      clientIp: string | null;
      userAgent: string | null;
      selectedTenantId: string | null;
    },
  ): Promise<SessionRow> {
    const result = await tx.query<SessionRow>(
      `INSERT INTO sessions (account_id, identity_id, token_hash, rotation_family,
                             assurance, idle_expires_at, absolute_expires_at, client_ip, user_agent,
                             selected_tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        input.accountId,
        input.identityId,
        input.tokenHash,
        input.rotationFamily,
        input.assurance,
        input.idleExpiresAt,
        input.absoluteExpiresAt,
        input.clientIp,
        input.userAgent,
        input.selectedTenantId,
      ],
    );
    return firstRow(result.rows, 'insert session');
  }

  async findByTokenHash(tx: Tx, tokenHash: string): Promise<SessionRow | null> {
    const result = await tx.query<SessionRow>(`SELECT * FROM sessions WHERE token_hash = $1`, [tokenHash]);
    return result.rows[0] ?? null;
  }

  async findSessionById(tx: Tx, id: string): Promise<SessionRow | null> {
    const result = await tx.query<SessionRow>(`SELECT * FROM sessions WHERE id = $1`, [id]);
    return result.rows[0] ?? null;
  }

  async listByAccount(tx: Tx, accountId: string, activeOnly: boolean): Promise<SessionRow[]> {
    const result = await tx.query<SessionRow>(
      `SELECT * FROM sessions WHERE account_id = $1 ${activeOnly ? `AND status = 'active'` : ''}
       ORDER BY issued_at DESC LIMIT 200`,
      [accountId],
    );
    return result.rows;
  }

  async touchLastUsed(tx: Tx, input: { id: string; lastUsedAt: Date; idleExpiresAt: Date }): Promise<void> {
    await tx.query(`UPDATE sessions SET last_used_at = $2, idle_expires_at = $3 WHERE id = $1`, [
      input.id,
      input.lastUsedAt,
      input.idleExpiresAt,
    ]);
  }

  /** Rotates the access token of an ACTIVE session. Returns null if it was not active. */
  async rotate(
    tx: Tx,
    input: { id: string; newTokenHash: string; idleExpiresAt: Date; lastUsedAt: Date },
  ): Promise<SessionRow | null> {
    const result = await tx.query<SessionRow>(
      `UPDATE sessions
       SET token_hash = $2, token_version = token_version + 1, idle_expires_at = $3, last_used_at = $4
       WHERE id = $1 AND status = 'active'
       RETURNING *`,
      [input.id, input.newTokenHash, input.idleExpiresAt, input.lastUsedAt],
    );
    return result.rows[0] ?? null;
  }

  async setStatus(
    tx: Tx,
    input: { id: string; toStatus: 'revoked' | 'expired'; reason: string | null },
  ): Promise<SessionRow | null> {
    const result = await tx.query<SessionRow>(
      `UPDATE sessions
       SET status = $2,
           revoked_at = CASE WHEN $2 = 'revoked' THEN now() ELSE revoked_at END,
           revoked_reason = CASE WHEN $2 = 'revoked' THEN $3 ELSE revoked_reason END
       WHERE id = $1 AND status = 'active'
       RETURNING *`,
      [input.id, input.toStatus, input.reason],
    );
    return result.rows[0] ?? null;
  }

  /** Revokes every ACTIVE session in a rotation family (theft response). Returns the affected ids. */
  async revokeFamily(tx: Tx, rotationFamily: string, reason: string): Promise<string[]> {
    const result = await tx.query<{ id: string }>(
      `UPDATE sessions
       SET status = 'revoked', revoked_at = now(), revoked_reason = $2
       WHERE rotation_family = $1 AND status = 'active'
       RETURNING id`,
      [rotationFamily, reason],
    );
    return result.rows.map((r) => r.id);
  }

  /** Revokes every ACTIVE session for an account (password change / suspension). Returns affected ids. */
  async revokeAllForAccount(tx: Tx, accountId: string, reason: string): Promise<string[]> {
    const result = await tx.query<{ id: string }>(
      `UPDATE sessions
       SET status = 'revoked', revoked_at = now(), revoked_reason = $2
       WHERE account_id = $1 AND status = 'active'
       RETURNING id`,
      [accountId, reason],
    );
    return result.rows.map((r) => r.id);
  }

  // --- refresh-token ledger (rotation + reuse detection) ------------------------------------------

  async insertRefreshToken(
    tx: Tx,
    input: {
      refreshTokenHash: string;
      sessionId: string;
      accountId: string;
      rotationFamily: string;
      tokenVersion: number;
      expiresAt: Date;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO session_refresh_tokens
         (refresh_token_hash, session_id, account_id, rotation_family, token_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.refreshTokenHash,
        input.sessionId,
        input.accountId,
        input.rotationFamily,
        input.tokenVersion,
        input.expiresAt,
      ],
    );
  }

  async findRefreshToken(
    tx: Tx,
    refreshTokenHash: string,
  ): Promise<{
    refresh_token_hash: string;
    session_id: string;
    account_id: string;
    rotation_family: string;
    token_version: number;
    expires_at: Date;
    consumed_at: Date | null;
  } | null> {
    const result = await tx.query<{
      refresh_token_hash: string;
      session_id: string;
      account_id: string;
      rotation_family: string;
      token_version: number;
      expires_at: Date;
      consumed_at: Date | null;
    }>(`SELECT * FROM session_refresh_tokens WHERE refresh_token_hash = $1`, [refreshTokenHash]);
    return result.rows[0] ?? null;
  }

  /** Marks a refresh token consumed exactly once. Returns true if THIS call consumed it (won the race). */
  async consumeRefreshToken(tx: Tx, refreshTokenHash: string): Promise<boolean> {
    const result = await tx.query(
      `UPDATE session_refresh_tokens SET consumed_at = now()
       WHERE refresh_token_hash = $1 AND consumed_at IS NULL`,
      [refreshTokenHash],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async appendHistory(
    tx: Tx,
    input: {
      sessionId: string;
      accountId: string;
      fromStatus: string | null;
      toStatus: string;
      action: string;
      reason: string | null;
      tokenVersion: number;
      correlationId: string;
      changedBy: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO session_status_history
         (session_id, account_id, from_status, to_status, action, reason, token_version, correlation_id, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.sessionId,
        input.accountId,
        input.fromStatus,
        input.toStatus,
        input.action,
        input.reason,
        input.tokenVersion,
        input.correlationId,
        input.changedBy,
      ],
    );
  }
}
