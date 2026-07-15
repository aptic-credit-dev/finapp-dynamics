import type pg from 'pg';
import type { Assert } from './harness.ts';

/**
 * The DB integration lane's harness.
 *
 * A spec proves what only a real PostgreSQL can: tenant isolation, controlled-action gates, idempotency,
 * and audit (docs/07-engineering/TEST_STRATEGY.md).
 *
 * The context mirrors the kernel's ambient-transaction `Db` on purpose — a spec enters tenant context
 * the same way production code does, so the spec proves the real path rather than a lookalike.
 */

export interface SpecTx {
  query<TRow extends pg.QueryResultRow = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<pg.QueryResult<TRow>>;
}

export interface DbSpecContext {
  /**
   * The raw connection, which is a SUPERUSER.
   *
   * A superuser BYPASSES RLS ENTIRELY — FORCE does not constrain it, because FORCE only removes the
   * *owner's* exemption. Never prove isolation through this pool; it is for role setup and for asserting
   * the bypass itself. This is the reason the application must never connect as a superuser.
   */
  readonly pool: pg.Pool;
  /** Non-superuser role that OWNS the tables. FORCE is what binds it. */
  readonly ownerRole: string;
  /** Non-superuser, non-owner role the application connects as. Isolation is proven through this one. */
  readonly appRole: string;

  /**
   * Runs `fn` in a transaction as the non-owner application role, with `app.tenant_id` bound to
   * `tenantId`. Pass `null` to enter as the app role with NO tenant context — the fail-closed case.
   *
   * Both the role and the GUC are set with SET LOCAL, so they are transaction-scoped and cannot leak to
   * the next user of the pooled connection.
   */
  asTenant<T>(tenantId: string | null, fn: (tx: SpecTx) => Promise<T>): Promise<T>;

  /** Runs `fn` in a transaction as the table OWNER (non-superuser) — to prove FORCE binds the owner. */
  asOwner<T>(tenantId: string | null, fn: (tx: SpecTx) => Promise<T>): Promise<T>;

  /** Runs `fn` in a transaction as the superuser, with no role change. Setup and bypass assertions only. */
  asSuperuser<T>(tenantId: string | null, fn: (tx: SpecTx) => Promise<T>): Promise<T>;

  /**
   * Runs `fn` as the non-superuser APPLICATION role with `app.system_context = 'on'` and no tenant bound
   * — mirroring exactly what the kernel's `Db.withSystem` does.
   *
   * This is how a spec exercises the control-plane escape (ADR-014) through the same role production
   * uses. It is deliberately NOT the superuser path: the escape must be proven to work because of the
   * POLICY, not because the connection could see everything anyway.
   */
  asSystem<T>(fn: (tx: SpecTx) => Promise<T>): Promise<T>;
}

export interface DbSpec {
  readonly name: string;
  run(ctx: DbSpecContext, t: Assert): Promise<void>;
}

export function defineDbSpec(name: string, run: (ctx: DbSpecContext, t: Assert) => Promise<void>): DbSpec {
  return { name, run };
}

/** Quotes a PostgreSQL identifier. Role names reach here from the environment. */
function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function createSpecContext(pool: pg.Pool, ownerRole: string, appRole: string): DbSpecContext {
  async function inTransaction<T>(
    role: string | null,
    tenantId: string | null,
    fn: (tx: SpecTx) => Promise<T>,
    systemContext = false,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (role !== null) await client.query(`SET LOCAL ROLE ${quoteIdent(role)}`);
      // Parameterised: set_config is a function call, unlike SET LOCAL which cannot take a placeholder.
      // `true` = local to this transaction.
      if (tenantId !== null)
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
      if (systemContext) await client.query('SELECT set_config($1, $2, true)', ['app.system_context', 'on']);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error: unknown) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    pool,
    ownerRole,
    appRole,
    asTenant: (tenantId, fn) => inTransaction(appRole, tenantId, fn),
    asOwner: (tenantId, fn) => inTransaction(ownerRole, tenantId, fn),
    asSuperuser: (tenantId, fn) => inTransaction(null, tenantId, fn),
    asSystem: (fn) => inTransaction(appRole, null, fn, true),
  };
}
