/**
 * Finance-foundation reference-number formatting — PURE and deterministic. A stable, human-readable, tenant-safe
 * identifier `FIN-<token>` where `token` is a lowercase hex slice of a fresh UUID supplied by the service. Unique
 * per tenant by a `(tenant_id, <number>)` index; carries no cross-tenant sequence leakage.
 */
const FINANCE_NUMBER_RE = /^FIN-[0-9a-f]{12}$/;

export function formatFinanceNumber(uuid: string): string {
  const hex = uuid.replace(/-/g, '').toLowerCase().slice(0, 12);
  return `FIN-${hex}`;
}

export function isValidFinanceNumber(v: unknown): boolean {
  return typeof v === 'string' && FINANCE_NUMBER_RE.test(v);
}
