/**
 * Hard limits + shared vocabulary for the recovery & enforcement domain. Every bound is enforced fail-closed so an
 * oversized narrative, an excessive batch, or a runaway payload is rejected deterministically (ADR-070). These are
 * DATA, shared by the validators and services. Recovery TYPES, jurisdictions, courts, auctioneers, statutes,
 * notices and enforcement methods are NOT enumerated here — they are configurable per tenant (ADR-069). What IS
 * enumerated are the governed control vocabularies the platform reasons about. Debtor contacts, negotiation
 * strategy, settlement terms, bank/payment details and security valuations are treated as sensitive: RLS-stored,
 * redacted, never in events/audit (ADR-072). ALL amounts are REFERENCES only — no cash application, ledger
 * posting, or accounting write-off (ADR-071).
 */
export const RECOVERY_LIMITS = {
  maxTitleChars: 500,
  maxSummaryChars: 4_000,
  maxDescriptionChars: 60_000,
  maxNoteChars: 60_000,
  maxParties: 500,
  maxInstallments: 600,
  maxBatch: 500,
  maxSearchLimit: 200,
} as const;

export class RecoveryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RecoveryError';
    this.code = code;
  }
}

/** Where a recovery entered the platform. `enforcement_referral` is the controlled M16 seam. */
export const RECOVERY_SOURCES = [
  'enforcement_referral',
  'matter_referral',
  'direct_instruction',
  'judgment',
  'decree',
  'court_order',
  'arbitral_award',
  'settlement',
  'contractual_default',
  'guarantee',
  'indemnity',
  'security_realization',
  'unpaid_obligation',
  'regulatory_determination',
  'internal_referral',
  'external_system',
] as const;
export type RecoverySource = (typeof RECOVERY_SOURCES)[number];
export function isRecoverySource(v: unknown): v is RecoverySource {
  return typeof v === 'string' && (RECOVERY_SOURCES as readonly string[]).includes(v);
}

/** Configurable enforceable-instrument families — statutes/notices are tenant data, only the family is governed. */
export const INSTRUMENT_TYPES = [
  'judgment',
  'decree',
  'court_order',
  'arbitral_award',
  'settlement_agreement',
  'consent_order',
  'promissory_note',
  'guarantee',
  'indemnity',
  'debenture',
  'charge',
  'mortgage',
  'lien',
  'bond',
  'contract',
  'statutory_demand',
  'regulatory_order',
  'other',
] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];
export function isInstrumentType(v: unknown): v is InstrumentType {
  return typeof v === 'string' && (INSTRUMENT_TYPES as readonly string[]).includes(v);
}

/** Recovery strategies. */
export const RECOVERY_STRATEGIES = [
  'demand',
  'negotiation',
  'repayment_arrangement',
  'litigation',
  'enforcement',
  'security_realization',
  'agent_referral',
  'write_off',
  'monitoring',
  'hybrid',
] as const;
export type RecoveryStrategy = (typeof RECOVERY_STRATEGIES)[number];
export function isRecoveryStrategy(v: unknown): v is RecoveryStrategy {
  return typeof v === 'string' && (RECOVERY_STRATEGIES as readonly string[]).includes(v);
}

export const CONFIDENTIALITY_LEVELS = ['standard', 'confidential', 'restricted', 'privileged'] as const;
export type Confidentiality = (typeof CONFIDENTIALITY_LEVELS)[number];
export function isConfidentiality(v: unknown): v is Confidentiality {
  return typeof v === 'string' && (CONFIDENTIALITY_LEVELS as readonly string[]).includes(v);
}
export function confidentialityRank(c: Confidentiality): number {
  return CONFIDENTIALITY_LEVELS.indexOf(c);
}

export const RECOVERY_RISKS = ['low', 'medium', 'high', 'critical'] as const;
export type RecoveryRisk = (typeof RECOVERY_RISKS)[number];
export function isRecoveryRisk(v: unknown): v is RecoveryRisk {
  return typeof v === 'string' && (RECOVERY_RISKS as readonly string[]).includes(v);
}

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export function isPriority(v: unknown): v is Priority {
  return typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v);
}

/** The role a party plays in a recovery — a reference to a master record, never a duplicate of it. */
export const PARTY_ROLES = [
  'principal_debtor',
  'co_debtor',
  'guarantor',
  'surety',
  'indemnifier',
  'judgment_debtor',
  'third_party',
  'chargor',
  'mortgagor',
  'director',
  'spouse',
  'beneficiary',
  'claimant',
  'creditor',
] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];
export function isPartyRole(v: unknown): v is PartyRole {
  return typeof v === 'string' && (PARTY_ROLES as readonly string[]).includes(v);
}

/** Demand kinds (G-demand). */
export const DEMAND_TYPES = [
  'informal_demand',
  'formal_demand',
  'statutory_demand',
  'final_demand',
  'letter_before_action',
  'notice_to_pay',
  'notice_of_default',
] as const;
export type DemandType = (typeof DEMAND_TYPES)[number];
export function isDemandType(v: unknown): v is DemandType {
  return typeof v === 'string' && (DEMAND_TYPES as readonly string[]).includes(v);
}

/** Operational repayment-arrangement kinds. Schedule METADATA only — no cash application. */
export const ARRANGEMENT_TYPES = [
  'lump_sum',
  'installment',
  'structured_settlement',
  'moratorium',
  'restructure',
  'standstill',
] as const;
export type ArrangementType = (typeof ARRANGEMENT_TYPES)[number];
export function isArrangementType(v: unknown): v is ArrangementType {
  return typeof v === 'string' && (ARRANGEMENT_TYPES as readonly string[]).includes(v);
}

/** Enforcement-action families (references only — no production enforcement execution, ADR-071). */
export const ENFORCEMENT_ACTION_TYPES = [
  'attachment',
  'garnishee',
  'execution',
  'warrant_of_execution',
  'proclamation',
  'auction',
  'repossession',
  'eviction',
  'receivership',
  'charging_order',
  'stop_order',
  'committal',
  'statutory_demand',
  'winding_up',
  'bankruptcy_petition',
  'other',
] as const;
export type EnforcementActionType = (typeof ENFORCEMENT_ACTION_TYPES)[number];
export function isEnforcementActionType(v: unknown): v is EnforcementActionType {
  return typeof v === 'string' && (ENFORCEMENT_ACTION_TYPES as readonly string[]).includes(v);
}

/** Security / collateral families. References + valuation references only. */
export const SECURITY_TYPES = [
  'real_property',
  'motor_vehicle',
  'chattel',
  'shares',
  'deposit',
  'guarantee',
  'debenture',
  'lien',
  'cash_cover',
  'insurance',
  'other',
] as const;
export type SecurityType = (typeof SECURITY_TYPES)[number];
export function isSecurityType(v: unknown): v is SecurityType {
  return typeof v === 'string' && (SECURITY_TYPES as readonly string[]).includes(v);
}

/** Recovery receipt REFERENCE types. m17 records a reference only — no cash application / posting (ADR-071). */
export const RECEIPT_TYPES = [
  'cash',
  'cheque',
  'bank_transfer',
  'mobile_money',
  'security_realization',
  'auction_proceeds',
  'agent_remittance',
  'court_deposit',
  'set_off',
  'other',
] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];
export function isReceiptType(v: unknown): v is ReceiptType {
  return typeof v === 'string' && (RECEIPT_TYPES as readonly string[]).includes(v);
}

/** Recovery deadline categories. `limitation` is high-risk and clearly distinguishable (ADR-070). */
export const DEADLINE_TYPES = [
  'demand_response',
  'arrangement_review',
  'installment_due',
  'enforcement_filing',
  'enforcement_action',
  'security_realization',
  'agent_report',
  'statutory_period',
  'limitation',
  'review',
  'closure',
  'internal_action',
] as const;
export type DeadlineType = (typeof DEADLINE_TYPES)[number];
export function isDeadlineType(v: unknown): v is DeadlineType {
  return typeof v === 'string' && (DEADLINE_TYPES as readonly string[]).includes(v);
}

/** Enforcement / recovery cost reference types. No AP/GL/posting/payment (ADR-071). */
export const COST_TYPES = [
  'auctioneer_fee',
  'agent_fee',
  'court_fee',
  'valuation_fee',
  'legal_fee',
  'execution_cost',
  'storage_cost',
  'advertising_cost',
  'other',
] as const;
export type CostType = (typeof COST_TYPES)[number];
export function isCostType(v: unknown): v is CostType {
  return typeof v === 'string' && (COST_TYPES as readonly string[]).includes(v);
}

/** Write-off RECOMMENDATION reason codes. m17 recommends only — a human approves; no accounting write-off. */
export const WRITEOFF_REASONS = [
  'uncollectible',
  'deceased_debtor',
  'insolvent_debtor',
  'untraceable',
  'statute_barred',
  'commercial_decision',
  'cost_exceeds_recovery',
  'settled_partial',
  'security_shortfall',
  'other',
] as const;
export type WriteOffReason = (typeof WRITEOFF_REASONS)[number];
export function isWriteOffReason(v: unknown): v is WriteOffReason {
  return typeof v === 'string' && (WRITEOFF_REASONS as readonly string[]).includes(v);
}

/** Recovery outcome types. */
export const OUTCOME_TYPES = [
  'fully_recovered',
  'partially_recovered',
  'settled',
  'written_off',
  'uncollectible',
  'withdrawn',
  'referred_out',
  'other',
] as const;
export type OutcomeType = (typeof OUTCOME_TYPES)[number];
export function isOutcomeType(v: unknown): v is OutcomeType {
  return typeof v === 'string' && (OUTCOME_TYPES as readonly string[]).includes(v);
}

/** Recovery note kinds. `confidential`/`privileged`/`strategy`/`agent` require a privileged permission. */
export const NOTE_TYPES = [
  'general',
  'confidential',
  'privileged',
  'strategy',
  'agent',
  'management',
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export function isNoteType(v: unknown): v is NoteType {
  return typeof v === 'string' && (NOTE_TYPES as readonly string[]).includes(v);
}
/** A note whose content is restricted from ordinary readers + never emitted in events/audit. */
export function isRestrictedNote(t: NoteType): boolean {
  return t === 'confidential' || t === 'privileged' || t === 'strategy' || t === 'agent';
}
