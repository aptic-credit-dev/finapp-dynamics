/**
 * Hard limits + shared vocabulary for the case-management domain. Every bound is enforced fail-closed so an
 * oversized narrative, an excessive activity batch, or a runaway payload is rejected deterministically (ADR-058).
 * These are DATA, shared by the validators and services. Case TYPES, categories, party roles, legal jurisdictions
 * and references are NOT enumerated here — they are configurable per tenant (ADR-057). What IS enumerated are the
 * governed control vocabularies the platform reasons about. Party contacts, privileged notes, correspondence
 * bodies and confidential settlement terms are treated as sensitive: RLS-stored, redacted, never in events/audit
 * (ADR-060).
 */
export const CASE_LIMITS = {
  maxTitleChars: 500,
  maxSummaryChars: 4_000,
  maxDescriptionChars: 40_000,
  maxNoteChars: 40_000,
  maxAllegationChars: 20_000,
  maxActivityDescriptionChars: 40_000,
  maxParties: 500,
  maxIssues: 200,
  maxBatch: 500,
  maxSearchLimit: 200,
} as const;

export class CaseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'CaseError';
    this.code = code;
  }
}

/** Where a case entered the platform. `feedback_handoff` is the controlled M12 seam. */
export const CASE_SOURCES = [
  'manual',
  'feedback_handoff',
  'internal_referral',
  'regulatory_referral',
  'customer_complaint',
  'incident_report',
  'legal_referral',
  'recovery_referral',
  'external_system',
] as const;
export type CaseSource = (typeof CASE_SOURCES)[number];
export function isCaseSource(v: unknown): v is CaseSource {
  return typeof v === 'string' && (CASE_SOURCES as readonly string[]).includes(v);
}

/** How restricted a case (or a sub-entity) is. `privileged` is the tightest — legal privilege. */
export const CONFIDENTIALITY_LEVELS = ['standard', 'confidential', 'restricted', 'privileged'] as const;
export type Confidentiality = (typeof CONFIDENTIALITY_LEVELS)[number];
export function isConfidentiality(v: unknown): v is Confidentiality {
  return typeof v === 'string' && (CONFIDENTIALITY_LEVELS as readonly string[]).includes(v);
}
export function confidentialityRank(c: Confidentiality): number {
  return CONFIDENTIALITY_LEVELS.indexOf(c);
}

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];
export function isSeverity(v: unknown): v is Severity {
  return typeof v === 'string' && (SEVERITIES as readonly string[]).includes(v);
}

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export function isPriority(v: unknown): v is Priority {
  return typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v);
}

export const RISK_RATINGS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskRating = (typeof RISK_RATINGS)[number];
export function isRiskRating(v: unknown): v is RiskRating {
  return typeof v === 'string' && (RISK_RATINGS as readonly string[]).includes(v);
}

/** The kind of party attached to a case — a reference to a master record, never a duplicate of it (F7). */
export const PARTY_TYPES = [
  'complainant',
  'customer',
  'respondent',
  'employee',
  'witness',
  'guarantor',
  'borrower',
  'contractor',
  'insurer',
  'bank',
  'advocate',
  'external_counsel',
  'regulator',
  'court',
  'government_body',
  'third_party',
] as const;
export type PartyType = (typeof PARTY_TYPES)[number];
export function isPartyType(v: unknown): v is PartyType {
  return typeof v === 'string' && (PARTY_TYPES as readonly string[]).includes(v);
}

/** Investigation findings (F12). Independent per issue (F13). */
export const FINDING_TYPES = [
  'substantiated',
  'partially_substantiated',
  'unsubstantiated',
  'inconclusive',
  'withdrawn',
  'outside_scope',
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];
export function isFindingType(v: unknown): v is FindingType {
  return typeof v === 'string' && (FINDING_TYPES as readonly string[]).includes(v);
}

/** Controlled decisions (F23). Approval is maker-checker where the type requires it. */
export const DECISION_TYPES = [
  'accept',
  'reject',
  'uphold_complaint',
  'dismiss_complaint',
  'approve_settlement',
  'reject_settlement',
  'approve_legal_action',
  'discontinue',
  'approve_recovery',
  'approve_closure',
  'refer_externally',
] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];
export function isDecisionType(v: unknown): v is DecisionType {
  return typeof v === 'string' && (DECISION_TYPES as readonly string[]).includes(v);
}

/** Deadline categories (F16). The calculation rule is deterministic against a supplied clock (ADR-058). */
export const DEADLINE_TYPES = [
  'response',
  'filing',
  'service',
  'mention',
  'hearing',
  'appeal',
  'limitation',
  'payment',
  'document_submission',
  'regulatory_reporting',
  'internal_review',
] as const;
export type DeadlineType = (typeof DEADLINE_TYPES)[number];
export function isDeadlineType(v: unknown): v is DeadlineType {
  return typeof v === 'string' && (DEADLINE_TYPES as readonly string[]).includes(v);
}

/** Court / administrative event types (F15). */
export const HEARING_TYPES = [
  'mention',
  'hearing',
  'ruling',
  'judgment',
  'mediation',
  'arbitration',
  'tribunal_session',
  'regulatory_hearing',
  'internal_disciplinary_hearing',
  'meeting',
  'filing_deadline',
  'service_deadline',
] as const;
export type HearingType = (typeof HEARING_TYPES)[number];
export function isHearingType(v: unknown): v is HearingType {
  return typeof v === 'string' && (HEARING_TYPES as readonly string[]).includes(v);
}

/** Evidence categories (F11). No forensic chain-of-custody certification is claimed. */
export const EVIDENCE_TYPES = [
  'document',
  'physical',
  'digital',
  'testimony',
  'photograph',
  'recording',
  'financial',
  'other',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export function isEvidenceType(v: unknown): v is EvidenceType {
  return typeof v === 'string' && (EVIDENCE_TYPES as readonly string[]).includes(v);
}

/** Recovery / enforcement stages (F26). Finance references only — no accounting (ADR-059). */
export const RECOVERY_STAGES = [
  'none',
  'pre_demand',
  'demand',
  'negotiation',
  'payment_plan',
  'enforcement',
  'litigation',
  'recovered',
  'partially_recovered',
  'written_off',
  'closed',
] as const;
export type RecoveryStage = (typeof RECOVERY_STAGES)[number];
export function isRecoveryStage(v: unknown): v is RecoveryStage {
  return typeof v === 'string' && (RECOVERY_STAGES as readonly string[]).includes(v);
}

/** Case note kinds. `confidential`/`privileged`/`legal_advice` require a privileged permission (ADR-060). */
export const NOTE_TYPES = ['general', 'internal', 'confidential', 'privileged', 'legal_advice'] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export function isNoteType(v: unknown): v is NoteType {
  return typeof v === 'string' && (NOTE_TYPES as readonly string[]).includes(v);
}
/** A note whose content is restricted from ordinary readers + never emitted in events/audit. */
export function isRestrictedNote(t: NoteType): boolean {
  return t === 'confidential' || t === 'privileged' || t === 'legal_advice';
}
