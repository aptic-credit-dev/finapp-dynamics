import {
  ProblemError,
  isRequestContext,
  type Authz,
  type RequestContext,
  type SystemContext,
} from '@finapp/kernel';

/**
 * The persistent authorization adapter (ADR-017) — bound to the kernel `AUTHZ` token, REPLACING the
 * temporary `ContextAuthz`. It keeps the exact `Authz` contract so the ~36 existing `authz.require(ctx,
 * permission)` call sites are untouched.
 *
 * It answers from `ctx.permissions`, which — unlike the retired `x-permissions` era — is populated ONLY by
 * the API's actor boundary from the authoritative `PermissionResolver` (persistent role assignments, read
 * fresh per request). So "the set on the context" is now the RBAC decision, not a client claim.
 *
 * DEFAULT DENY: an unknown or absent permission is `false`, never `true`. A `SystemContext` grants a
 * permission only if a platform action explicitly resolved and carried it — `withSystem` relaxes which ROWS
 * the database shows, never which ACTIONS are allowed, so system context is not a universal allow.
 */
export class RbacAuthz implements Authz {
  // eslint-disable-next-line @typescript-eslint/require-await -- the port is async; resolution is at the boundary
  async can(ctx: RequestContext | SystemContext, permission: string): Promise<boolean> {
    if (isRequestContext(ctx)) return ctx.permissions.includes(permission);
    const carried = (ctx as { permissions?: unknown }).permissions;
    return Array.isArray(carried) && carried.includes(permission);
  }

  async require(ctx: RequestContext | SystemContext, permission: string): Promise<void> {
    if (!(await this.can(ctx, permission))) {
      // Names the permission but nothing about the resource — a 403 that revealed whether a record exists
      // would be an enumeration oracle.
      throw ProblemError.forbidden(`Missing required permission: ${permission}.`, ctx.correlationId);
    }
  }
}
