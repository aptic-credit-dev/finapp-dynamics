/**
 * Hard limits + shared vocabulary for the legal-matter domain. Every bound is enforced fail-closed so an oversized
 * legal position, an excessive activity batch, or a runaway payload is rejected deterministically (ADR-062). These
 * are DATA, shared by the validators and services. Matter TYPES, jurisdictions, courts/forums, statutes, firms and
 * advocates are NOT enumerated here — they are configurable per tenant (ADR-061). What IS enumerated are the
 * governed control vocabularies the platform reasons about. Legal positions/strategy, opinions, privileged notes,
 * party contacts and confidential settlement terms are treated as sensitive: RLS-stored, redacted, never in
 * events/audit (ADR-064).
 */
export const LEGAL_LIMITS = {
  maxTitleChars: 500,
  maxSummaryChars: 4_000,
  maxDescriptionChars: 60_000,
  maxNoteChars: 60_000,
  maxPositionChars: 60_000,
  maxActivityDescriptionChars: 60_000,
  maxParties: 500,
  maxIssues: 200,
  maxBatch: 500,
  maxSearchLimit: 200,
} as const;

export class LegalError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LegalError';
    this.code = code;
  }
}

/** Where a matter entered the platform. `case_conversion` is the controlled M13 seam. */
export const MATTER_SOURCES = [
  'case_conversion',
  'direct_instruction',
  'internal_referral',
  'customer_complaint',
  'contract_dispute',
  'employment_matter',
  'regulatory_matter',
  'recovery_referral',
  'corporate_matter',
  'external_claim',
  'court_process',
  'tribunal_process',
  'arbitration',
  'mediation',
  'external_system',
] as const;
export type MatterSource = (typeof MATTER_SOURCES)[number];
export function isMatterSource(v: unknown): v is MatterSource {
  return typeof v === 'string' && (MATTER_SOURCES as readonly string[]).includes(v);
}

export const CONFIDENTIALITY_LEVELS = ['standard', 'confidential', 'restricted', 'privileged'] as const;
export type Confidentiality = (typeof CONFIDENTIALITY_LEVELS)[number];
export function isConfidentiality(v: unknown): v is Confidentiality {
  return typeof v === 'string' && (CONFIDENTIALITY_LEVELS as readonly string[]).includes(v);
}
export function confidentialityRank(c: Confidentiality): number {
  return CONFIDENTIALITY_LEVELS.indexOf(c);
}

export const LEGAL_RISKS = ['low', 'medium', 'high', 'critical'] as const;
export type LegalRisk = (typeof LEGAL_RISKS)[number];
export function isLegalRisk(v: unknown): v is LegalRisk {
  return typeof v === 'string' && (LEGAL_RISKS as readonly string[]).includes(v);
}

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export function isPriority(v: unknown): v is Priority {
  return typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v);
}

/** The role a party plays in a legal matter — a reference to a master record, never a duplicate of it (G6). */
export const PARTY_ROLES = [
  'claimant',
  'plaintiff',
  'petitioner',
  'applicant',
  'defendant',
  'respondent',
  'interested_party',
  'appellant',
  'respondent_on_appeal',
  'accused',
  'complainant',
  'witness',
  'regulator',
  'government_entity',
  'bank',
  'insurer',
  'contractor',
  'employee',
  'customer',
  'guarantor',
  'advocate',
  'external_counsel',
  'law_firm',
] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];
export function isPartyRole(v: unknown): v is PartyRole {
  return typeof v === 'string' && (PARTY_ROLES as readonly string[]).includes(v);
}

/** Deadline categories (G17). `limitation` is high-risk and clearly distinguishable (ADR-062). */
export const DEADLINE_TYPES = [
  'filing',
  'service',
  'response',
  'submissions',
  'witness_statement',
  'hearing_bundle',
  'ruling',
  'judgment',
  'appeal',
  'limitation',
  'compliance',
  'settlement',
  'enforcement',
  'regulatory',
  'internal_instruction',
] as const;
export type DeadlineType = (typeof DEADLINE_TYPES)[number];
export function isDeadlineType(v: unknown): v is DeadlineType {
  return typeof v === 'string' && (DEADLINE_TYPES as readonly string[]).includes(v);
}

/** Court / tribunal / administrative event types (G16). */
export const COURT_EVENT_TYPES = [
  'mention',
  'hearing',
  'ruling',
  'judgment',
  'mediation',
  'arbitration',
  'settlement_conference',
  'case_management_conference',
  'directions',
  'filing_deadline',
  'service_deadline',
  'appeal_deadline',
  'regulatory_appearance',
] as const;
export type CourtEventType = (typeof COURT_EVENT_TYPES)[number];
export function isCourtEventType(v: unknown): v is CourtEventType {
  return typeof v === 'string' && (COURT_EVENT_TYPES as readonly string[]).includes(v);
}

/** Pleading / filing document roles (G15). Full documents live in m09; these are reference metadata only. */
export const PLEADING_ROLES = [
  'plaint',
  'petition',
  'application',
  'notice_of_motion',
  'affidavit',
  'defence',
  'response',
  'replying_affidavit',
  'submissions',
  'list_of_documents',
  'witness_statement',
  'notice_of_appeal',
  'memorandum_of_appeal',
  'demand',
  'undertaking',
  'consent',
  'settlement_agreement',
  'decree',
  'order',
  'judgment',
  'ruling',
] as const;
export type PleadingRole = (typeof PLEADING_ROLES)[number];
export function isPleadingRole(v: unknown): v is PleadingRole {
  return typeof v === 'string' && (PLEADING_ROLES as readonly string[]).includes(v);
}

/** Matter outcome / judgment types (G28). */
export const OUTCOME_TYPES = [
  'ruling',
  'interim_order',
  'final_judgment',
  'award',
  'consent',
  'dismissal',
  'withdrawal',
  'settlement',
  'regulatory_determination',
] as const;
export type OutcomeType = (typeof OUTCOME_TYPES)[number];
export function isOutcomeType(v: unknown): v is OutcomeType {
  return typeof v === 'string' && (OUTCOME_TYPES as readonly string[]).includes(v);
}

/** Enforcement stages (G30). References only — no collections accounting (ADR-063). */
export const ENFORCEMENT_STAGES = [
  'none',
  'pre_execution',
  'demand',
  'execution',
  'garnishee',
  'attachment',
  'auction',
  'payment_plan',
  'recovered',
  'partially_recovered',
  'closed',
] as const;
export type EnforcementStage = (typeof ENFORCEMENT_STAGES)[number];
export function isEnforcementStage(v: unknown): v is EnforcementStage {
  return typeof v === 'string' && (ENFORCEMENT_STAGES as readonly string[]).includes(v);
}

/** Legal note kinds. `confidential`/`privileged`/`counsel`/`strategy` require a privileged permission (ADR-064). */
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
