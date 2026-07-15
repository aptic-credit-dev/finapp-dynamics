import type { RequestContext, SystemContext } from './request-context.ts';

/**
 * The AUTHZ contract.
 *
 * Stage 0 declared the `AUTHZ` token but no interface. The contract lives with the token; the single
 * authoritative implementation is owned by m02-identity. A security posture engine may later layer over
 * this, but an allow never grants a permission the caller lacks (ADR-009).
 */
export interface Authz {
  /** Non-throwing check. Deny-by-default: an unknown permission is `false`, never `true`. */
  can(ctx: RequestContext | SystemContext, permission: string): Promise<boolean>;

  /**
   * Throws `ProblemError.forbidden` unless the caller holds `permission`.
   *
   * This is the form routes use, so that the default outcome of a missing check is a denial rather than
   * an accidental allow: forgetting to read a boolean is easy, forgetting to catch a throw is not.
   */
  require(ctx: RequestContext | SystemContext, permission: string): Promise<void>;
}
