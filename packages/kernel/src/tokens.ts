/**
 * The four kernel DI tokens.
 *
 * Every module consumes the shared-service spine through these tokens and their contracts — never by
 * importing another module's implementation and never by reaching into another module's tables
 * (docs/01-architecture/SHARED_SERVICE_OWNERSHIP.md, ADR-002).
 *
 * There is exactly one authoritative provider bound to each token, supplied by its owning module:
 *   DB     -> the ambient-transaction database (see db.ts)
 *   AUDIT  -> m03-audit    (append-only spine; registered SCREAMING_SNAKE codes only)
 *   AUTHZ  -> m02-identity (RBAC; a security posture layers over it but never replaces it)
 *   OUTBOX -> m06-workflow (the ONLY event-delivery path — ADR-004)
 *
 * Tokens are `symbol`s rather than strings so that a second, accidentally-duplicated provider cannot
 * silently collide with the authoritative one under the same name.
 */

export const DB: unique symbol = Symbol.for('finapp.kernel.DB');
export const AUDIT: unique symbol = Symbol.for('finapp.kernel.AUDIT');
export const AUTHZ: unique symbol = Symbol.for('finapp.kernel.AUTHZ');
export const OUTBOX: unique symbol = Symbol.for('finapp.kernel.OUTBOX');

/** Every kernel token, for boot-time completeness checks. */
export const KERNEL_TOKENS = [DB, AUDIT, AUTHZ, OUTBOX] as const;

export type KernelToken = (typeof KERNEL_TOKENS)[number];
