/**
 * Legal-knowledge relationship matching — PURE. Knowledge-to-knowledge relationships and clause dependencies are
 * validated and self/duplicate cycles are rejected. Cross-module references (to m09 documents, m14 matters, m16
 * proceedings, m17 recoveries) are OPAQUE ids typed by `ReferenceType` (see limits.ts) — m18 never reads those
 * modules' tables and imposes no lifecycle coupling (ADR-075).
 */

/** Knowledge-record to knowledge-record relationship kinds. `supersedes` is the version link. */
export const RELATIONSHIP_KINDS = [
  'supersedes',
  'related_to',
  'cites',
  'derived_from',
  'duplicate_of',
  'contradicts',
  'refines',
] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];
export function isRelationshipKind(v: unknown): v is RelationshipKind {
  return typeof v === 'string' && (RELATIONSHIP_KINDS as readonly string[]).includes(v);
}

/** Clause-to-clause dependency / conflict kinds within the clause library. */
export const CLAUSE_RELATION_KINDS = [
  'depends_on',
  'conflicts_with',
  'alternative_to',
  'fallback_for',
] as const;
export type ClauseRelationKind = (typeof CLAUSE_RELATION_KINDS)[number];
export function isClauseRelationKind(v: unknown): v is ClauseRelationKind {
  return typeof v === 'string' && (CLAUSE_RELATION_KINDS as readonly string[]).includes(v);
}

export function isSelfRelation(fromId: string, toId: string): boolean {
  return fromId === toId;
}
