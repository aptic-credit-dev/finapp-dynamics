/**
 * The tenant type catalogue.
 *
 * Catalogue-driven rather than hardcoded strings scattered across the codebase: the codes live in one
 * list here, are seeded into `tenant_type_catalogue` by the migration, and are referenced by a foreign
 * key from `tenants.tenant_type`. Adding a type is a migration plus one line here — not a grep.
 *
 * The FK is what makes this real. A CHECK constraint would drift the moment someone adds a type in code
 * and forgets the constraint; a FK to a seeded reference table cannot.
 */

export const TENANT_TYPES = [
  'internal_entity',
  'subsidiary',
  'enterprise_customer',
  'bank',
  'microfinance_institution',
  'insurance_business',
  'partner',
  'white_label_customer',
  'sandbox',
  'demonstration',
] as const;

export type TenantType = (typeof TENANT_TYPES)[number];

export function isTenantType(value: string): value is TenantType {
  return (TENANT_TYPES as readonly string[]).includes(value);
}

/**
 * `tenant_type_catalogue` is a global reference registry — one of the enumerated legitimately-global
 * tables (ADR-001). It is reference data, identical for every tenant, and provisioning a private copy
 * per tenant would create ten thousand rows that must never diverge.
 */
export const TENANT_TYPE_LABELS: Readonly<Record<TenantType, string>> = {
  internal_entity: 'Internal entity',
  subsidiary: 'Subsidiary',
  enterprise_customer: 'Enterprise customer',
  bank: 'Bank',
  microfinance_institution: 'Microfinance institution',
  insurance_business: 'Insurance business',
  partner: 'Partner',
  white_label_customer: 'White-label customer',
  sandbox: 'Sandbox',
  demonstration: 'Demonstration',
};
