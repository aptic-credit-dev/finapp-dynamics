/**
 * Proceeding-number formatting — PURE and deterministic. The number is a stable, human-readable, tenant-safe
 * identifier `PROC-<token>` where `token` is a lowercase hex slice of a fresh UUID supplied by the service. It is
 * deterministic given its input (unit-testable), unique per tenant by a `(tenant_id, proceeding_number)` unique
 * index, and carries no cross-tenant sequence leakage.
 */
const PROCEEDING_NUMBER_RE = /^PROC-[0-9a-f]{12}$/;

export function formatProceedingNumber(uuid: string): string {
  const hex = uuid.replace(/-/g, '').toLowerCase().slice(0, 12);
  return `PROC-${hex}`;
}

export function isValidProceedingNumber(v: unknown): boolean {
  return typeof v === 'string' && PROCEEDING_NUMBER_RE.test(v);
}
