import type pg from 'pg';
import type { Db, QueryResult, Tx } from './db.ts';
import type { RequestContext, SystemContext } from './request-context.ts';
import { runInContext } from './request-context.ts';

/**
 * THE PostgreSQL implementation of the kernel's ambient-transaction `Db`.
 *
 * Stage 0 defined the contract and bound nothing to the `DB` token. This is that binding — one
 * implementation, living with the contract it implements, so no module has to invent its own and no
 * second one can appear (CLAUDE.md: never create a duplicate shared platform service).
 *
 * It is exported from the `@finapp/kernel/pg` subpath rather than the package root so the kernel's core
 * stays dependency-free and loadable under `node --experimental-strip-types` for the PURE smoke suites.
 *
 * Everything that matters here is about GUC lifetime:
 *
 *  - `SET LOCAL` is **transaction-scoped**. It reverts at COMMIT/ROLLBACK, so a pooled connection cannot
 *    carry one request's tenant into the next request that borrows it. This is the single most important
 *    property in the file.
 *  - `set_config($1, $2, true)` is the parameterised form — `SET LOCAL` cannot take a placeholder, and
 *    interpolating a tenant id into SQL is exactly how an injection reaches the isolation boundary.
 *  - After a transaction-local GUC has been set once, it reverts to the **empty string**, not NULL.
 *    Every `tenant_isolation` policy therefore reads it through `NULLIF(..., '')`
 *    (docs/07-engineering/DATABASE_CONVENTIONS.md). Nothing here can paper over a policy that forgets it.
 */

/** The connection must not be a superuser or table owner: both bypass or are exempt from RLS. */
export interface PgDbOptions {
  readonly pool: pg.Pool;
  /**
   * Optional role to `SET LOCAL ROLE` into for every transaction. Use when the connecting user is more
   * privileged than the application should be — the isolation guarantee is only as good as the role.
   */
  readonly appRole?: string;
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid role identifier: ${name}`);
  }
  return `"${name}"`;
}

class PgTx implements Tx {
  // Explicit field, not a parameter property: strip-types cannot compile those, and keeping the whole
  // kernel loadable from source costs nothing here.
  private readonly client: pg.PoolClient;

  constructor(client: pg.PoolClient) {
    this.client = client;
  }

  async query<TRow = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<TRow>> {
    const result = await this.client.query<Record<string, unknown>>(sql, params as unknown[]);
    // pg returns `rowCount: null` for statements that report no count (e.g. some DDL). The kernel's
    // contract says number, and 0 is the honest answer for "no rows affected".
    return { rows: result.rows as TRow[], rowCount: result.rowCount ?? 0 };
  }
}

export class PgDb implements Db {
  private readonly pool: pg.Pool;
  private readonly appRole: string | undefined;

  constructor(options: PgDbOptions) {
    this.pool = options.pool;
    this.appRole = options.appRole;
  }

  /**
   * Opens a transaction bound to `ctx.tenantId` and runs `fn`.
   *
   * `app.tenant_id` is what every `tenant_isolation` policy reads. Because it is set transaction-locally
   * and the callback cannot outlive the transaction, there is no way to run a tenant-scoped query with
   * the wrong tenant bound — or with none.
   */
  async withTenant<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run(ctx, fn, async (client) => {
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', ctx.tenantId]);
    });
  }

  /**
   * Opens a transaction with NO tenant bound and runs `fn`.
   *
   * For the legitimately-global tables only (ADR-001): the tenancy control plane, the audit spine,
   * pre-authentication login attempts, and global reference registries. `ctx.reason` is mandatory and is
   * recorded, because this is the one path that can see across tenants.
   *
   * `app.system_context` is set to 'on' here and NOWHERE else. The `tenants` policy admits it as an
   * explicit escape (ADR-014); tenant-scoped tables do not — their policies have no escape at all, so
   * `withSystem` sees **nothing** in them. That asymmetry is deliberate: reaching for `withSystem` cannot
   * quietly become a way to read another tenant's business data.
   */
  async withSystem<T>(ctx: SystemContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (ctx.reason.trim() === '') {
      throw new Error('Db.withSystem requires a non-empty reason: system access must be explainable.');
    }
    return this.run(ctx, fn, async (client) => {
      await client.query('SELECT set_config($1, $2, true)', ['app.system_context', 'on']);
    });
  }

  private async run<T>(
    ctx: RequestContext | SystemContext,
    fn: (tx: Tx) => Promise<T>,
    bind: (client: pg.PoolClient) => Promise<void>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Role first: everything after it, including the GUCs, runs as the application role.
      if (this.appRole !== undefined) {
        await client.query(`SET LOCAL ROLE ${quoteIdent(this.appRole)}`);
      }
      await bind(client);

      const result = await runInContext(ctx, () => fn(new PgTx(client)));
      await client.query('COMMIT');
      return result;
    } catch (error: unknown) {
      // A failed ROLLBACK must not mask the original error — that error is why we are here.
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
