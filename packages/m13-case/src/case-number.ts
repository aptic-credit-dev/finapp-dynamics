/**
 * Case-number formatting (F2) — PURE and deterministic. The number is a stable, human-readable, tenant-safe
 * identifier `CASE-<token>` where `token` is a lowercase hex slice of a fresh UUID supplied by the service. It is
 * deterministic given its input (so it is unit-testable), unique per tenant by a `(tenant_id, case_number)`
 * unique index, and carries no cross-tenant sequence leakage (unlike a global Postgres sequence).
 */
const CASE_NUMBER_RE = /^CASE-[0-9a-f]{12}$/;

/** Format a case number from a UUID (or any hex-ish token); uses the first 12 hex characters. */
export function formatCaseNumber(uuid: string): string {
  const hex = uuid.replace(/-/g, '').toLowerCase().slice(0, 12);
  return `CASE-${hex}`;
}

export function isValidCaseNumber(v: unknown): boolean {
  return typeof v === 'string' && CASE_NUMBER_RE.test(v);
}
