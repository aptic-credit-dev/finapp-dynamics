/**
 * @finapp/m18-legaldocs — enterprise legal documents & knowledge management (Stage 4.4).
 *
 * The PURE domain layer (the shared PUBLISHABLE state machine, deterministic clock-driven review/expiry math,
 * relationship rules, knowledge-number formatting, canonical content hashing) carries no I/O and is exhaustively
 * unit-tested. The services layer runs everything inside `db.withTenant` with append-only history + audit + outbox
 * in the SAME transaction; m18 consumes DB/AUDIT/AUTHZ via kernel tokens and publishes `legaldocs.lifecycle`
 * through the ONE outbox m06 owns. Workflow (m06), rules (m07), escalation/notifications (m08) and documents (m09)
 * are reused THROUGH events/contracts, never by importing their internals — m18 OWNS no storage (bytes live in
 * m09) and REFERENCES m09/m14/m16/m17 through OPAQUE ids only, never reading their tables (ADR-075). Nothing is
 * jurisdiction-specific: practice areas, jurisdictions, legal topics, document types and tags are configurable
 * taxonomy. Knowledge records, templates and clauses are PUBLISHABLE + maker-checker (approved_by <> submitted_by):
 * published content is immutable, a change is a NEW version (supersession), content_hash frozen at publish
 * (ADR-074). Privileged legal advice, confidential clause/opinion/analysis text, drafting strategy and restricted
 * notes are sensitive: RLS-stored, redacted on read, and NEVER placed in events/audit (ADR-076). No finance, no AI,
 * no vector/semantic search, no production legal-research vendor ingestion.
 */

// Permissions + audit codes
export { M18_PERMISSIONS, ALL_M18_PERMISSIONS, M18_PRIVILEGED_PERMISSIONS } from './permissions.ts';
export type { M18Permission } from './permissions.ts';
export { M18_AUDIT_CODES, ALL_M18_AUDIT_CODES, LEGALDOC_AUDIT_PREFIX } from './audit-codes.ts';
export type { M18AuditCode } from './audit-codes.ts';

// Domain — limits + governed vocabulary + guards
export {
  LEGALDOCS_LIMITS,
  LegalDocsError,
  RECORD_TYPES,
  isRecordType,
  KNOWLEDGE_TYPES,
  isKnowledgeType,
  AUTHORITY_TYPES,
  isAuthorityType,
  AUTHORITY_TREATMENTS,
  isAuthorityTreatment,
  CLAUSE_KINDS,
  isClauseKind,
  AUTHORITY_LEVELS,
  isAuthorityLevel,
  PRIVILEGE_LEVELS,
  isPrivilegeLevel,
  CONFIDENTIALITY_LEVELS,
  isConfidentiality,
  confidentialityRank,
  RISK_LEVELS,
  isRiskLevel,
  SOURCE_TYPES,
  isSourceType,
  TAXONOMY_KINDS,
  isTaxonomyKind,
  REVIEW_TYPES,
  isReviewType,
  REFERENCE_TYPES,
  isReferenceType,
  NOTE_TYPES,
  isNoteType,
  isRestrictedNote,
} from './domain/limits.ts';
export type {
  RecordType,
  KnowledgeType,
  AuthorityType,
  AuthorityTreatment,
  ClauseKind,
  AuthorityLevel,
  PrivilegeLevel,
  Confidentiality,
  RiskLevel,
  SourceType,
  TaxonomyKind,
  ReviewType,
  ReferenceType,
  NoteType,
} from './domain/limits.ts';

// Domain — the shared PUBLISHABLE lifecycle
export {
  PUBLISHABLE_STATUSES,
  PUBLISHABLE_TERMINAL,
  checkPublishableTransition,
  isPublishableTerminal,
  isPublishableFrozen,
  isPublishableOpen,
  isPublished,
} from './domain/lifecycles.ts';
export type { PublishableStatus, TransitionResult } from './domain/lifecycles.ts';

// Domain — deterministic review/expiry deadlines
export { computeReviewDueMs, reviewState, isExpirySafe, isExpiry } from './domain/deadlines.ts';
export type { ReviewRule, ReviewInput, ReviewState } from './domain/deadlines.ts';

// Domain — relationship + clause-relation rules
export {
  RELATIONSHIP_KINDS,
  isRelationshipKind,
  CLAUSE_RELATION_KINDS,
  isClauseRelationKind,
  isSelfRelation,
} from './domain/relationships.ts';
export type { RelationshipKind, ClauseRelationKind } from './domain/relationships.ts';

// Knowledge number + hash + ports
export { formatKnowledgeNumber, isValidKnowledgeNumber } from './knowledge-number.ts';
export { contentHashOf, canonicalJson } from './hash.ts';
export { SystemClock, FixedClock } from './ports.ts';
export type { Clock, CrossModuleRef, KnowledgeIntakeAdapter, NormalizedKnowledgeIntake } from './ports.ts';

// Persistence + emit + errors
export { LegalDocsRepository } from './repository.ts';
export type {
  TaxonomyRow,
  KnowledgeRow,
  StatusHistoryRow,
  AssignmentHistoryRow,
  AuthorityRow,
  AuthorityTreatmentRow,
  PrecedentRow,
  OpinionRow,
  ResearchRow,
  TemplateRow,
  ClauseRow,
  ClauseRelationRow,
  ReferenceRow,
  RelationshipRow,
  ReviewRow,
  TagRow,
  CitationRow,
  NoteRow,
  UsageRow,
  ApprovalHistoryRow,
} from './repository.ts';
export { M18Emitter } from './emit.ts';
export { badRequest, invalidSpec } from './errors.ts';

// Services
export { CatalogService } from './catalog.service.ts';
export { KnowledgeService, redactKnowledge } from './knowledge.service.ts';
export { LibraryService } from './library.service.ts';
