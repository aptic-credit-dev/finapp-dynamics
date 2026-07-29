/**
 * Hard limits + shared vocabulary for the legal documents & knowledge domain. Every bound is enforced fail-closed
 * so an oversized narrative, an excessive batch, or a runaway payload is rejected deterministically (ADR-074).
 * These are DATA, shared by the validators and services. Practice areas, jurisdictions, legal topics, document
 * types and tags are NOT enumerated here — they are configurable per tenant via the taxonomy (ADR-073). What IS
 * enumerated are the governed control vocabularies the platform reasons about. Privileged legal advice,
 * confidential clause/opinion/analysis text and drafting strategy are treated as sensitive: RLS-stored, redacted,
 * never in events/audit (ADR-076). m18 owns no storage — document bytes live in m09.
 */
export const LEGALDOCS_LIMITS = {
  maxTitleChars: 500,
  maxSummaryChars: 4_000,
  maxAbstractChars: 20_000,
  maxNoteChars: 60_000,
  maxBatch: 500,
  maxSearchLimit: 200,
} as const;

export class LegalDocsError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LegalDocsError';
    this.code = code;
  }
}

/** The record-family discriminator carried on events/audit for the whole knowledge domain. */
export const RECORD_TYPES = [
  'knowledge',
  'authority',
  'precedent',
  'opinion',
  'research',
  'template',
  'clause',
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];
export function isRecordType(v: unknown): v is RecordType {
  return typeof v === 'string' && (RECORD_TYPES as readonly string[]).includes(v);
}

/** Legal knowledge record kinds. */
export const KNOWLEDGE_TYPES = [
  'legal_memo',
  'practice_note',
  'guidance',
  'checklist',
  'interpretation',
  'advisory',
  'faq',
  'playbook',
  'standard_position',
  'other',
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];
export function isKnowledgeType(v: unknown): v is KnowledgeType {
  return typeof v === 'string' && (KNOWLEDGE_TYPES as readonly string[]).includes(v);
}

/** Legal authority / citation kinds. */
export const AUTHORITY_TYPES = [
  'statute',
  'regulation',
  'regulatory_circular',
  'case_law',
  'constitutional_provision',
  'policy',
  'internal_opinion',
  'external_opinion',
  'contractual_authority',
  'standard_reference',
] as const;
export type AuthorityType = (typeof AUTHORITY_TYPES)[number];
export function isAuthorityType(v: unknown): v is AuthorityType {
  return typeof v === 'string' && (AUTHORITY_TYPES as readonly string[]).includes(v);
}

/** How an authority is treated (case-law treatment + statutory status). */
export const AUTHORITY_TREATMENTS = [
  'followed',
  'applied',
  'distinguished',
  'overruled',
  'repealed',
  'amended',
  'superseded',
  'persuasive',
  'binding',
] as const;
export type AuthorityTreatment = (typeof AUTHORITY_TREATMENTS)[number];
export function isAuthorityTreatment(v: unknown): v is AuthorityTreatment {
  return typeof v === 'string' && (AUTHORITY_TREATMENTS as readonly string[]).includes(v);
}

/** Clause library kinds. `prohibited` clauses are drafting guardrails. */
export const CLAUSE_KINDS = [
  'approved',
  'alternative',
  'fallback',
  'prohibited',
  'jurisdiction_specific',
  'practice_area',
] as const;
export type ClauseKind = (typeof CLAUSE_KINDS)[number];
export function isClauseKind(v: unknown): v is ClauseKind {
  return typeof v === 'string' && (CLAUSE_KINDS as readonly string[]).includes(v);
}

export const AUTHORITY_LEVELS = ['binding', 'persuasive', 'informational', 'internal'] as const;
export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number];
export function isAuthorityLevel(v: unknown): v is AuthorityLevel {
  return typeof v === 'string' && (AUTHORITY_LEVELS as readonly string[]).includes(v);
}

/** Legal-privilege level. Privileged records require dedicated privileged permissions (ADR-076). */
export const PRIVILEGE_LEVELS = ['none', 'work_product', 'attorney_client', 'litigation_privilege'] as const;
export type PrivilegeLevel = (typeof PRIVILEGE_LEVELS)[number];
export function isPrivilegeLevel(v: unknown): v is PrivilegeLevel {
  return typeof v === 'string' && (PRIVILEGE_LEVELS as readonly string[]).includes(v);
}

export const CONFIDENTIALITY_LEVELS = ['standard', 'confidential', 'restricted', 'privileged'] as const;
export type Confidentiality = (typeof CONFIDENTIALITY_LEVELS)[number];
export function isConfidentiality(v: unknown): v is Confidentiality {
  return typeof v === 'string' && (CONFIDENTIALITY_LEVELS as readonly string[]).includes(v);
}
export function confidentialityRank(c: Confidentiality): number {
  return CONFIDENTIALITY_LEVELS.indexOf(c);
}

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export function isRiskLevel(v: unknown): v is RiskLevel {
  return typeof v === 'string' && (RISK_LEVELS as readonly string[]).includes(v);
}

/** Where a knowledge record originated. No production legal-research vendor ingestion (ADR-073). */
export const SOURCE_TYPES = [
  'internal',
  'external',
  'court',
  'regulator',
  'statute',
  'subscription',
  'contributed',
  'other',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export function isSourceType(v: unknown): v is SourceType {
  return typeof v === 'string' && (SOURCE_TYPES as readonly string[]).includes(v);
}

/** Configurable taxonomy dimensions. The VALUES are tenant data; only the DIMENSION kind is governed. */
export const TAXONOMY_KINDS = [
  'practice_area',
  'jurisdiction',
  'legal_topic',
  'document_type',
  'tag',
] as const;
export type TaxonomyKind = (typeof TAXONOMY_KINDS)[number];
export function isTaxonomyKind(v: unknown): v is TaxonomyKind {
  return typeof v === 'string' && (TAXONOMY_KINDS as readonly string[]).includes(v);
}

/** Review / expiry deadline kinds. */
export const REVIEW_TYPES = [
  'periodic_review',
  'expiry',
  'renewal',
  'authority_review',
  'publication_review',
] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];
export function isReviewType(v: unknown): v is ReviewType {
  return typeof v === 'string' && (REVIEW_TYPES as readonly string[]).includes(v);
}

/** Cross-module + document reference targets. The target id is OPAQUE — m18 never reads the other module's tables. */
export const REFERENCE_TYPES = [
  'document',
  'matter',
  'litigation',
  'recovery',
  'authority',
  'precedent',
  'external',
] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];
export function isReferenceType(v: unknown): v is ReferenceType {
  return typeof v === 'string' && (REFERENCE_TYPES as readonly string[]).includes(v);
}

/** Legal note kinds. `confidential`/`privileged`/`strategy` require a privileged permission. */
export const NOTE_TYPES = [
  'general',
  'confidential',
  'privileged',
  'strategy',
  'review',
  'management',
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export function isNoteType(v: unknown): v is NoteType {
  return typeof v === 'string' && (NOTE_TYPES as readonly string[]).includes(v);
}
/** A note whose content is restricted from ordinary readers + never emitted in events/audit. */
export function isRestrictedNote(t: NoteType): boolean {
  return t === 'confidential' || t === 'privileged' || t === 'strategy';
}
