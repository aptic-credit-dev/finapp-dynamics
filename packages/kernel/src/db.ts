import type { RequestContext, SystemContext } from './request-context.ts';

export interface QueryResult<TRow> {
  readonly rows: TRow[];
  readonly rowCount: number;
}

/**
 * A handle to the one open transaction. Obtained only from `Db.withTenant`/`Db.withSystem`, never
 * constructed by a module: that is what makes the tenant GUC and the transaction boundary inseparable.
 */
export interface Tx {
  query<TRow = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<TRow>>;
}

/**
 * The ambient-transaction database.
 *
 * Both entry points open a transaction, bind the context to it, run the callback, then COMMIT on
 * return / ROLLBACK on throw. There is no `query()` outside a transaction and no way to hold a `Tx`
 * past the callback — a state change and the outbox row recording it therefore always land atomically
 * (ADR-004), and a tenant-scoped query can never run without `app.tenant_id` set (ADR-003).
 */
export interface Db {
  /**
   * Runs `fn` inside a transaction bound to `ctx.tenantId`.
   *
   * Sets `app.tenant_id` as a transaction-local GUC, which is what every `tenant_isolation` RLS policy
   * reads. Because the GUC is transaction-local it cannot leak to the next user of a pooled connection.
   */
  withTenant<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T>;

  /**
   * Runs `fn` inside a transaction with NO tenant bound — the escape hatch for the legitimately-global
   * tables only: the tenancy control plane (m01), the audit spine (m03), pre-authentication login
   * attempts (m02), and global reference registries (m06 entity types).
   *
   * `ctx.reason` is mandatory and is expected to be recorded. Adding to the global list needs an ADR;
   * reaching for `withSystem` to dodge an RLS policy is exactly the failure this signature makes visible
   * in review.
   */
  withSystem<T>(ctx: SystemContext, fn: (tx: Tx) => Promise<T>): Promise<T>;
}
