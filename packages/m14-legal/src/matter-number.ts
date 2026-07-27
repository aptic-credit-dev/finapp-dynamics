/**
 * Matter-number formatting (G3) — PURE and deterministic. The number is a stable, human-readable, tenant-safe
 * identifier `MATTER-<token>` where `token` is a lowercase hex slice of a fresh UUID supplied by the service. It is
 * deterministic given its input (unit-testable), unique per tenant by a `(tenant_id, matter_number)` unique index,
 * and carries no cross-tenant sequence leakage.
 */
const MATTER_NUMBER_RE = /^MATTER-[0-9a-f]{12}$/;

export function formatMatterNumber(uuid: string): string {
  const hex = uuid.replace(/-/g, '').toLowerCase().slice(0, 12);
  return `MATTER-${hex}`;
}

export function isValidMatterNumber(v: unknown): boolean {
  return typeof v === 'string' && MATTER_NUMBER_RE.test(v);
}
