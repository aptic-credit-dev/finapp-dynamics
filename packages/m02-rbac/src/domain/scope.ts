/**
 * Authorization scope — pure (ADR-018). MVP scopes: platform, tenant, and organizational (entity, branch,
 * department) reusing M01's composite `(tenant_id, id)` identifiers. No own-record/product/ABAC.
 *
 * Canonical representation: a level + an optional reference id. `platform` and `tenant` carry no org ref;
 * `entity`/`branch`/`department` carry the M01 node id (always within the actor's tenant — enforced by RLS
 * and composite FKs on the assignment, never by this pure code).
 */
export const SCOPE_LEVELS = ['platform', 'tenant', 'entity', 'branch', 'department'] as const;
export type ScopeLevel = (typeof SCOPE_LEVELS)[number];
export function isScopeLevel(v: string): v is ScopeLevel {
  return (SCOPE_LEVELS as readonly string[]).includes(v);
}

export interface Scope {
  readonly level: ScopeLevel;
  /** M01 node id for org levels; null for platform/tenant. */
  readonly ref: string | null;
}

/** The org levels, broadest-first, that a tenant-wide assignment contains. */
const ORG_LEVELS: readonly ScopeLevel[] = ['entity', 'branch', 'department'];

/**
 * Does an ASSIGNMENT scope CONTAIN a requested RESOURCE scope? Default deny — an unrepresentable or
 * mismatched pair returns false, so a missing/invalid scope fails closed at the call site.
 *
 * Rules:
 *  - `platform` contains everything.
 *  - A tenant-wide assignment (`tenant`) contains any scope IN THE SAME TENANT. (Tenant identity is proven
 *    separately via RLS; this function is called only after the request is already in the actor's tenant.)
 *  - An org-scoped assignment contains a resource scope only if they are the SAME org node (same level AND
 *    same ref). Stage 1D does not model the branch→department tree here (that is M01's data); a scoped
 *    assignment authorizes exactly its node. A broader org tree containment is a future refinement.
 */
export function assignmentScopeContains(assignment: Scope, resource: Scope): boolean {
  if (assignment.level === 'platform') return true;
  if (assignment.level === 'tenant') return true; // tenant-wide within the already-proven tenant
  // Org-scoped assignment: exact node match.
  if (!ORG_LEVELS.includes(assignment.level)) return false;
  return assignment.level === resource.level && assignment.ref !== null && assignment.ref === resource.ref;
}

/** Parses a stored scope (level + ref) into a Scope, or null if the level is unrecognised (fail closed). */
export function parseScope(level: string, ref: string | null): Scope | null {
  if (!isScopeLevel(level)) return null;
  if ((level === 'platform' || level === 'tenant') && ref !== null) return null;
  if (ORG_LEVELS.includes(level) && ref === null) return null;
  return { level, ref };
}
