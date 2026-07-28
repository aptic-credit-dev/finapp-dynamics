/**
 * Hard limits + shared vocabulary for the litigation-proceedings domain. Every bound is enforced fail-closed so an
 * oversized submission, an excessive filing batch, or a runaway payload is rejected deterministically (ADR-066).
 * These are DATA, shared by the validators and services. Proceeding TYPES, jurisdictions, forums/courts/tribunals,
 * statutes, procedural rules, firms and advocates are NOT enumerated here — they are configurable per tenant
 * (ADR-065). What IS enumerated are the governed control vocabularies the platform reasons about. Legal strategy,
 * full pleadings, witness statements, full submissions, private witness/party contacts, and confidential order/
 * outcome terms are treated as sensitive: RLS-stored, redacted, never in events/audit (ADR-068).
 */
export const LITIGATION_LIMITS = {
  maxTitleChars: 500,
  maxSummaryChars: 4_000,
  maxDescriptionChars: 60_000,
  maxNoteChars: 60_000,
  maxStatementChars: 60_000,
  maxParties: 500,
  maxClaims: 200,
  maxBatch: 500,
  maxSearchLimit: 200,
} as const;

export class LitigationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LitigationError';
    this.code = code;
  }
}

/** Where a proceeding entered the platform. `matter_referral` is the controlled M14 seam. */
export const PROCEEDING_SOURCES = [
  'matter_referral',
  'direct_instruction',
  'claim_against_org',
  'claim_by_org',
  'appeal_from_proceeding',
  'tribunal_referral',
  'arbitration_referral',
  'mediation_referral',
  'regulatory_referral',
  'disciplinary_referral',
  'external_system',
] as const;
export type ProceedingSource = (typeof PROCEEDING_SOURCES)[number];
export function isProceedingSource(v: unknown): v is ProceedingSource {
  return typeof v === 'string' && (PROCEEDING_SOURCES as readonly string[]).includes(v);
}

/** Configurable forum families — courts/tribunals/statutes are tenant data, only the family is governed. */
export const FORUM_TYPES = [
  'court',
  'tribunal',
  'arbitration',
  'mediation',
  'regulatory_panel',
  'disciplinary',
  'adr',
  'other',
] as const;
export type ForumType = (typeof FORUM_TYPES)[number];
export function isForumType(v: unknown): v is ForumType {
  return typeof v === 'string' && (FORUM_TYPES as readonly string[]).includes(v);
}

/** The role the organization plays in the proceeding. */
export const ORGANIZATION_ROLES = [
  'claimant',
  'plaintiff',
  'petitioner',
  'applicant',
  'appellant',
  'prosecutor',
  'complainant',
  'defendant',
  'respondent',
  'accused',
  'interested_party',
  'third_party',
] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];
export function isOrganizationRole(v: unknown): v is OrganizationRole {
  return typeof v === 'string' && (ORGANIZATION_ROLES as readonly string[]).includes(v);
}

export const CONFIDENTIALITY_LEVELS = ['standard', 'confidential', 'restricted', 'privileged'] as const;
export type Confidentiality = (typeof CONFIDENTIALITY_LEVELS)[number];
export function isConfidentiality(v: unknown): v is Confidentiality {
  return typeof v === 'string' && (CONFIDENTIALITY_LEVELS as readonly string[]).includes(v);
}
export function confidentialityRank(c: Confidentiality): number {
  return CONFIDENTIALITY_LEVELS.indexOf(c);
}

export const LITIGATION_RISKS = ['low', 'medium', 'high', 'critical'] as const;
export type LitigationRisk = (typeof LITIGATION_RISKS)[number];
export function isLitigationRisk(v: unknown): v is LitigationRisk {
  return typeof v === 'string' && (LITIGATION_RISKS as readonly string[]).includes(v);
}

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export function isPriority(v: unknown): v is Priority {
  return typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v);
}

/** The role a party plays in a proceeding — a reference to a master record, never a duplicate of it. */
export const PARTY_ROLES = [
  'claimant',
  'plaintiff',
  'petitioner',
  'applicant',
  'appellant',
  'prosecutor',
  'complainant',
  'defendant',
  'respondent',
  'accused',
  'interested_party',
  'third_party',
  'counterclaimant',
  'counter_defendant',
  'regulator',
  'witness',
  'expert_witness',
  'advocate',
  'law_firm',
] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];
export function isPartyRole(v: unknown): v is PartyRole {
  return typeof v === 'string' && (PARTY_ROLES as readonly string[]).includes(v);
}

/** Structured claim / prayer / defence kinds. Full legal argument stays out of events/audit. */
export const CLAIM_TYPES = [
  'monetary',
  'declaratory',
  'injunctive',
  'specific_performance',
  'possession',
  'judicial_review',
  'constitutional',
  'statutory',
  'appeal_ground',
  'counterclaim',
  'defence',
  'other',
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];
export function isClaimType(v: unknown): v is ClaimType {
  return typeof v === 'string' && (CLAIM_TYPES as readonly string[]).includes(v);
}

/** Filing / pleading document roles. Full documents live in m09; these are reference metadata only. */
export const FILING_ROLES = [
  'originating_pleading',
  'response',
  'defence',
  'reply',
  'affidavit',
  'witness_statement',
  'submissions',
  'list_of_documents',
  'bundle',
  'application',
  'notice',
  'appeal_document',
  'consent',
  'order',
  'decree',
  'ruling',
  'judgment',
] as const;
export type FilingRole = (typeof FILING_ROLES)[number];
export function isFilingRole(v: unknown): v is FilingRole {
  return typeof v === 'string' && (FILING_ROLES as readonly string[]).includes(v);
}

/** Service-of-process methods. */
export const SERVICE_METHODS = [
  'personal',
  'substituted',
  'postal',
  'electronic',
  'advertisement',
  'agent',
  'deemed',
  'other',
] as const;
export type ServiceMethod = (typeof SERVICE_METHODS)[number];
export function isServiceMethod(v: unknown): v is ServiceMethod {
  return typeof v === 'string' && (SERVICE_METHODS as readonly string[]).includes(v);
}

/** Appearance / diary event types. */
export const APPEARANCE_TYPES = [
  'mention',
  'directions',
  'case_management_conference',
  'pre_trial_conference',
  'hearing',
  'ruling',
  'judgment',
  'mediation',
  'arbitration_session',
  'settlement_conference',
  'compliance_review',
  'appeal_hearing',
] as const;
export type AppearanceType = (typeof APPEARANCE_TYPES)[number];
export function isAppearanceType(v: unknown): v is AppearanceType {
  return typeof v === 'string' && (APPEARANCE_TYPES as readonly string[]).includes(v);
}

/** Witness kinds. */
export const WITNESS_TYPES = [
  'fact',
  'expert',
  'character',
  'hostile',
  'rebuttal',
  'corporate_representative',
] as const;
export type WitnessType = (typeof WITNESS_TYPES)[number];
export function isWitnessType(v: unknown): v is WitnessType {
  return typeof v === 'string' && (WITNESS_TYPES as readonly string[]).includes(v);
}

/** Court order types. Full order content lives in m09; these are reference metadata only. */
export const ORDER_TYPES = [
  'interim_order',
  'injunction',
  'conservatory_order',
  'stay',
  'directions_order',
  'disclosure_order',
  'production_order',
  'consent_order',
  'costs_order',
  'decree',
  'warrant',
  'final_order',
] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
export function isOrderType(v: unknown): v is OrderType {
  return typeof v === 'string' && (ORDER_TYPES as readonly string[]).includes(v);
}

/** Proceeding outcome / decision types. */
export const OUTCOME_TYPES = [
  'ruling',
  'interim_order',
  'final_judgment',
  'award',
  'consent',
  'dismissal',
  'withdrawal',
  'settlement',
  'struck_out',
  'regulatory_determination',
] as const;
export type OutcomeType = (typeof OUTCOME_TYPES)[number];
export function isOutcomeType(v: unknown): v is OutcomeType {
  return typeof v === 'string' && (OUTCOME_TYPES as readonly string[]).includes(v);
}

/** Litigation deadline categories. `limitation` is high-risk and clearly distinguishable (ADR-066). */
export const DEADLINE_TYPES = [
  'filing',
  'service',
  'response',
  'disclosure',
  'witness_statement',
  'expert_report',
  'bundle',
  'submissions',
  'hearing',
  'ruling',
  'judgment',
  'appeal',
  'review',
  'order_compliance',
  'limitation',
  'internal_preparation',
] as const;
export type DeadlineType = (typeof DEADLINE_TYPES)[number];
export function isDeadlineType(v: unknown): v is DeadlineType {
  return typeof v === 'string' && (DEADLINE_TYPES as readonly string[]).includes(v);
}

/** Litigation cost reference types. References only — no accounts payable / posting / payment (ADR-067). */
export const COST_TYPES = [
  'filing_fee',
  'service_fee',
  'counsel_fee',
  'expert_fee',
  'witness_expense',
  'transcript_fee',
  'bundle_cost',
  'awarded_costs',
  'taxed_costs',
  'enforcement_reference',
] as const;
export type CostType = (typeof COST_TYPES)[number];
export function isCostType(v: unknown): v is CostType {
  return typeof v === 'string' && (COST_TYPES as readonly string[]).includes(v);
}

/** Litigation note kinds. `confidential`/`privileged`/`counsel`/`strategy` require a privileged permission. */
export const NOTE_TYPES = [
  'general',
  'confidential',
  'privileged',
  'counsel',
  'strategy',
  'management',
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export function isNoteType(v: unknown): v is NoteType {
  return typeof v === 'string' && (NOTE_TYPES as readonly string[]).includes(v);
}
/** A note whose content is restricted from ordinary readers + never emitted in events/audit. */
export function isRestrictedNote(t: NoteType): boolean {
  return t === 'confidential' || t === 'privileged' || t === 'counsel' || t === 'strategy';
}
