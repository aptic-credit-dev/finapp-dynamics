/**
 * Recovery-number formatting — PURE and deterministic. The number is a stable, human-readable, tenant-safe
 * identifier `REC-<token>` where `token` is a lowercase hex slice of a fresh UUID supplied by the service. It is
 * deterministic given its input (unit-testable), unique per tenant by a `(tenant_id, recovery_number)` unique
 * index, and carries no cross-tenant sequence leakage.
 */
const RECOVERY_NUMBER_RE = /^REC-[0-9a-f]{12}$/;

export function formatRecoveryNumber(uuid: string): string {
  const hex = uuid.replace(/-/g, '').toLowerCase().slice(0, 12);
  return `REC-${hex}`;
}

export function isValidRecoveryNumber(v: unknown): boolean {
  return typeof v === 'string' && RECOVERY_NUMBER_RE.test(v);
}
