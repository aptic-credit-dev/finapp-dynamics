/**
 * @finapp/m26-legal-ai — GOVERNED Legal AI (Stage 5, mvp:false): human-reviewed, citation-backed AI SUGGESTIONS for the
 * legal domain (matters/cases from M14) — summaries, chronology, issue/obligation/deadline extraction, clause analysis,
 * evidence-gap detection and drafting assistance. LEGAL-ADVISORY ONLY — it never files, never reaches a legal
 * conclusion, never settles or enforces, never mutates a matter, and never exposes privileged/work-product data to
 * unauthorized users (privilege + ethical-wall boundaries; CLAUDE.md hard rules). It consumes the M24 governed AI
 * pipeline BY CONTRACT through an AI-gateway PORT (no second AI engine, no provider/routing/DLP of its own), references
 * M14 matters + M09 documents by OPAQUE id (reads no m14/m09 table; M14 stays the legal source of truth; citations hold
 * a document REFERENCE + version/hash, never content), audits every action under the shared AI_ prefix (AI_LEGAL_*),
 * shares the m24 ai.* permission namespace, and owns NO second outbox and NO new event family. An AI inference is never
 * a verified legal fact. No production provider, no network, no HTTP client.
 */

// Permissions + audit codes
export { M26_PERMISSIONS, ALL_M26_PERMISSIONS, M26_PRIVILEGED_PERMISSIONS } from './permissions.ts';
export type { M26Permission } from './permissions.ts';
export { M26_AUDIT_CODES, ALL_M26_AUDIT_CODES, AI_LEGAL_AUDIT_PREFIX } from './audit-codes.ts';
export type { M26AuditCode } from './audit-codes.ts';

// Domain
export {
  M26_LIMITS,
  LegalAiError,
  LEGAL_CLASSIFICATIONS,
  isLegalClassification,
  PRIVILEGE_CLASSIFICATIONS,
  isPrivilegeClassification,
  isBehindEthicalWall,
  SUBJECT_TYPES,
  isSubjectType,
  ANALYSIS_KINDS,
  isAnalysisKind,
  FINDING_TYPES,
  isFindingType,
  FACT_STATUSES,
  isFactStatus,
  SUGGESTION_TYPES,
  isSuggestionType,
  CITATION_SOURCE_TYPES,
  isCitationSourceType,
  EVIDENCE_CLASSIFICATIONS,
  isEvidenceClassification,
  ANALYSIS_STATUSES,
  checkAnalysisTransition,
  isAnalysisTerminal,
  SUGGESTION_STATUSES,
  checkSuggestionTransition,
  isSuggestionTerminal,
  SPEC_STATUSES,
  isSpecFrozen,
  REVIEW_DECISIONS,
  isReviewDecision,
  decisionToState,
  REVIEW_TARGETS,
  REASON_CODES,
  ALL_REASON_CODES,
  isConfidenceBps,
  evaluateEthicalWall,
  evaluateReviewGate,
  clampPage,
} from './domain.ts';
export type {
  LegalClassification,
  PrivilegeClassification,
  SubjectType,
  AnalysisKind,
  FindingType,
  FactStatus,
  SuggestionType,
  CitationSourceType,
  EvidenceClassification,
  AnalysisStatus,
  SuggestionStatus,
  SpecStatus,
  ReviewDecision,
  ReviewTarget,
  ReasonCodeKey,
  TransitionResult,
  EthicalWallInput,
  EthicalWallResult,
  ReviewGateInput,
  ReviewGateResult,
  Page,
} from './domain.ts';

// Errors + emit
export { badRequest, governanceForbidden } from './errors.ts';
export { M26Emitter } from './emit.ts';

// AI gateway port (consumes M24 by contract)
export { M24AiGateway } from './gateway.ts';
export type { AiGatewayPort, AiAnalysisInput, AiAnalysisResult, AiDecisionResult } from './gateway.ts';

// Persistence
export { LegalAiRepository } from './repository.ts';
export type {
  ConfigRow,
  SubjectRow,
  AnalysisRow,
  FindingRow,
  CitationRow,
  SuggestionRow,
  ReviewRow,
  EvidenceRow,
} from './repository.ts';

// Services
export { LegalAiConfigurationService } from './config.service.ts';
export { LegalAiAnalysisService } from './analysis.service.ts';
export { LegalAiEvidenceService } from './evidence.service.ts';
export { LegalAiReviewService } from './review.service.ts';
export { LegalAiSuggestionService } from './suggestion.service.ts';
