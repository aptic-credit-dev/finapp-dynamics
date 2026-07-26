/**
 * Document relationships + ACL grantee model (prompt §E10/§E16) — PURE. Relationship types are allow-listed;
 * the acyclic types (`supersedes`, `derived_from`) reject a cycle when the service supplies the existing edge
 * set. ACL grantee kinds are allow-listed; a document grant SUPPLEMENTS M02 RBAC and is never a second RBAC
 * system (ADR-048).
 */
import { DocError } from './limits.ts';

export const RELATIONSHIP_TYPES = [
  'supersedes',
  'derived_from',
  'attachment_to',
  'evidence_for',
  'related_to',
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/** Types whose semantics require a directed acyclic graph. */
export const ACYCLIC_TYPES: readonly RelationshipType[] = ['supersedes', 'derived_from'];

export function isRelationshipType(v: unknown): v is RelationshipType {
  return typeof v === 'string' && (RELATIONSHIP_TYPES as readonly string[]).includes(v);
}

/**
 * Would adding edge (from → to) of an acyclic type create a cycle, given the existing same-type edges?
 * Walks forward from `to`: if we can reach `from`, the new edge closes a cycle. Deterministic, no I/O.
 */
export function wouldCreateCycle(
  from: string,
  to: string,
  existingEdges: readonly { from: string; to: string }[],
): boolean {
  if (from === to) return true;
  const adjacency = new Map<string, string[]>();
  for (const e of existingEdges) {
    const list = adjacency.get(e.from) ?? [];
    list.push(e.to);
    adjacency.set(e.from, list);
  }
  const stack = [to];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || visited.has(node)) continue;
    if (node === from) return true;
    visited.add(node);
    for (const next of adjacency.get(node) ?? []) stack.push(next);
  }
  return false;
}

export function assertAcyclic(
  type: RelationshipType,
  from: string,
  to: string,
  existingEdges: readonly { from: string; to: string }[],
): void {
  if (ACYCLIC_TYPES.includes(type) && wouldCreateCycle(from, to, existingEdges)) {
    throw new DocError('RELATIONSHIP_CYCLE', `a ${type} relationship would create a cycle`);
  }
}

// --- ACL grantee model -------------------------------------------------------------------------
export const GRANTEE_KINDS = ['user', 'role', 'permission', 'participant', 'custodian'] as const;
export type GranteeKind = (typeof GRANTEE_KINDS)[number];

export function isGranteeKind(v: unknown): v is GranteeKind {
  return typeof v === 'string' && (GRANTEE_KINDS as readonly string[]).includes(v);
}

export const ACCESS_LEVELS = ['read', 'download', 'edit_metadata', 'manage'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export function isAccessLevel(v: unknown): v is AccessLevel {
  return typeof v === 'string' && (ACCESS_LEVELS as readonly string[]).includes(v);
}
