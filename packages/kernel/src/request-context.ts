import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who is asking, on behalf of which tenant, and under what correlation id.
 *
 * `RequestContext` is the unit the ambient-transaction Db binds a connection to: entering tenant
 * context sets `app.tenant_id`, which is what every `tenant_isolation` RLS policy reads (ADR-003).
 */
export interface RequestContext {
  /** Tenant the work is performed for. Every tenant-scoped row is keyed by this. */
  readonly tenantId: string;
  /** The acting identity. Absent only for pre-authentication work (e.g. login attempts). */
  readonly userId?: string;
  /** Correlates logs, audit entries, and emitted events across a single request. */
  readonly correlationId: string;
  /** Permissions already resolved for this caller. Authorization decisions go through AUTHZ. */
  readonly permissions: readonly string[];
}

/**
 * System context — for work with no tenant and no user (migrations, outbox drain, control plane).
 *
 * It is deliberately NOT a `RequestContext`: system work cannot accidentally satisfy a parameter that
 * wants a tenant. `reason` is required so that every use of the escape hatch is explainable in review.
 */
export interface SystemContext {
  readonly reason: string;
  readonly correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext | SystemContext>();

/** Runs `fn` with `ctx` as the ambient context for everything it awaits. */
export function runInContext<T>(ctx: RequestContext | SystemContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The ambient context, or `undefined` outside of any. */
export function currentContext(): RequestContext | SystemContext | undefined {
  return storage.getStore();
}

export function isRequestContext(ctx: RequestContext | SystemContext | undefined): ctx is RequestContext {
  return ctx !== undefined && 'tenantId' in ctx;
}

/**
 * The ambient tenant context, or a thrown error outside of one.
 *
 * Fail closed: code that needs a tenant must never silently fall back to "no tenant" and end up
 * running a query with RLS unsatisfied.
 */
export function requireTenantContext(): RequestContext {
  const ctx = currentContext();
  if (!isRequestContext(ctx)) {
    throw new Error(
      'No tenant context is active. Enter one via Db.withTenant() before touching tenant data.',
    );
  }
  return ctx;
}
