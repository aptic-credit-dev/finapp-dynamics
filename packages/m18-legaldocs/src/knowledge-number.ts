/**
 * Knowledge-number formatting — PURE and deterministic. The number is a stable, human-readable, tenant-safe
 * identifier `KNOW-<token>` where `token` is a lowercase hex slice of a fresh UUID supplied by the service. It is
 * deterministic given its input (unit-testable), unique per tenant by a `(tenant_id, knowledge_number)` unique
 * index, and carries no cross-tenant sequence leakage.
 */
const KNOWLEDGE_NUMBER_RE = /^KNOW-[0-9a-f]{12}$/;

export function formatKnowledgeNumber(uuid: string): string {
  const hex = uuid.replace(/-/g, '').toLowerCase().slice(0, 12);
  return `KNOW-${hex}`;
}

export function isValidKnowledgeNumber(v: unknown): boolean {
  return typeof v === 'string' && KNOWLEDGE_NUMBER_RE.test(v);
}
