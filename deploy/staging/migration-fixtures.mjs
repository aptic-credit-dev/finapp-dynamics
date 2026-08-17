/**
 * Stage-7 SYNTHETIC migration source fixture — clearly non-real. NO real customer PII. Actual first-tenant
 * migration sources remain TBD (OQ#14). Exercises valid + invalid + duplicate + exception records across 2 tenants,
 * with integer minor-unit financial data.
 */

/** Provider-neutral source-inventory schema, populated with SYNTHETIC entries only. */
export const SOURCE_INVENTORY = [
  {
    source_id: 'SYN-SRC-1',
    source_system_name: 'Synthetic Reference Extract (staging)',
    source_type: 'synthetic_reference_fixture',
    business_owner: 'ROLE:business/system owner (TBD)',
    data_domains: ['tenant', 'identity', 'ledger'],
    estimated_record_counts: { tenants: 2, identities: 4, ledger: 4 },
    extract_mechanism: 'in-memory fixture (no external system)',
    schema_version: '1.0.0',
    pii_classification: 'synthetic_non_personal',
    financial_data: true,
    retention_legal_constraints: 'synthetic; none',
    authoritative: false,
    note: 'SYNTHETIC ONLY — not a real migration source; real first-tenant sources are TBD (OQ#14)',
  },
];

/** The synthetic source records, keyed by entity. Includes deliberate invalid + duplicate records. */
export const SOURCE_DATA = {
  tenants: [
    { source_id: 'T1', code: 'stg_mig_a', legalName: 'Synthetic Migration Tenant A' },
    { source_id: 'T2', code: 'stg_mig_b', legalName: 'Synthetic Migration Tenant B' },
  ],
  identities: [
    { source_id: 'I1', tenantCode: 'stg_mig_a', email: 'A.User@Staging.Local', name: 'Synthetic A User' },
    { source_id: 'I2', tenantCode: 'stg_mig_a', email: 'a.user@staging.local', name: 'Synthetic A Dup' }, // DUPLICATE natural key (same email_norm+tenant)
    { source_id: 'I3', tenantCode: 'stg_mig_b', email: 'b.user@staging.local', name: 'Synthetic B User' },
    { source_id: 'I4', tenantCode: 'stg_mig_b', email: 'not-an-email', name: 'Synthetic B Invalid' }, // INVALID email -> exception
  ],
  ledger: [
    { source_id: 'L1', tenantCode: 'stg_mig_a', account: 'cash', amountMinor: 150000, currency: 'KES' },
    { source_id: 'L2', tenantCode: 'stg_mig_a', account: 'fees', amountMinor: 2599, currency: 'KES' },
    { source_id: 'L3', tenantCode: 'stg_mig_b', account: 'cash', amountMinor: 999999, currency: 'KES' },
    { source_id: 'L4', tenantCode: 'stg_mig_b', account: 'bad', amountMinor: 12.5, currency: 'KES' }, // NON-INTEGER money -> exception
  ],
};

/** Expected accepted control totals (for deterministic reconciliation assertions). */
export const EXPECTED = {
  tenant_count: 2,
  identity_count: 2, // I1 accepted; I2 duplicate (same email_norm+tenant); I3 accepted; I4 invalid email
  ledger_count: 3, // L1,L2 (tenant A) + L3 (tenant B) accepted; L4 rejected (non-integer money)
  ledger_minor_total_by_tenant: { stg_mig_a: 152599n, stg_mig_b: 999999n },
};
