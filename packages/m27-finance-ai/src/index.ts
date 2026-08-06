/**
 * @finapp/m27-finance-ai — GOVERNED Finance AI (Stage 5, mvp:partial): human-reviewed, EXPLAINABLE AI SUGGESTIONS for
 * reconciliation and finance (bank recon from M15/M15a, GL recon from M20) — match suggestions, exception
 * classification, anomaly detection, risk flagging and journal-recommendation drafting. IT NEVER AUTO-POSTS, never
 * approves, never auto-matches, never auto-reconciles, never closes an exception and never mutates a finance record;
 * suggestions feed DRAFT journals + human approval only (CLAUDE.md no-autopost hard rule). It consumes the M24 governed
 * AI pipeline BY CONTRACT through an AI-gateway PORT (no second AI engine, no provider/routing/DLP), references
 * M15/M20/M24 subjects by OPAQUE id (reads no m15/m20/m24 table; matching stays owned by M15a, GL recon by M20; M15/M20
 * remain the source of truth), audits every action under the shared AI_ prefix (AI_FINANCE_*), shares the m24 ai.*
 * permission namespace, and owns NO second outbox and NO new event family. Money is bigint minor units (never float,
 * ADR-007); a suggestion is never a confirmed accounting fact. No production provider, no network, no HTTP client.
 */

// Permissions + audit codes
export { M27_PERMISSIONS, ALL_M27_PERMISSIONS, M27_PRIVILEGED_PERMISSIONS } from './permissions.ts';
export type { M27Permission } from './permissions.ts';
export { M27_AUDIT_CODES, ALL_M27_AUDIT_CODES, AI_FINANCE_AUDIT_PREFIX } from './audit-codes.ts';
export type { M27AuditCode } from './audit-codes.ts';

// Domain
export {
  M27_LIMITS,
  FinanceAiError,
  FINANCE_CLASSIFICATIONS,
  isFinanceClassification,
  SUBJECT_TYPES,
  isSubjectType,
  ANALYSIS_KINDS,
  isAnalysisKind,
  SUGGESTION_TYPES,
  isSuggestionType,
  EXCEPTION_CATEGORIES,
  isExceptionCategory,
  FEATURE_TYPES,
  isFeatureType,
  EVIDENCE_SOURCES,
  isEvidenceSource,
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
  isMinorUnits,
  evaluateReviewGate,
  clampPage,
} from './domain.ts';
export type {
  FinanceClassification,
  SubjectType,
  AnalysisKind,
  SuggestionType,
  ExceptionCategory,
  FeatureType,
  EvidenceSource,
  AnalysisStatus,
  SuggestionStatus,
  SpecStatus,
  ReviewDecision,
  ReviewTarget,
  ReasonCodeKey,
  TransitionResult,
  ReviewGateInput,
  ReviewGateResult,
  Page,
} from './domain.ts';

// Errors + emit
export { badRequest, governanceForbidden } from './errors.ts';
export { M27Emitter } from './emit.ts';

// AI gateway port (consumes M24 by contract)
export { M24AiGateway } from './gateway.ts';
export type { AiGatewayPort, AiAnalysisInput, AiAnalysisResult, AiDecisionResult } from './gateway.ts';

// Persistence
export { FinanceAiRepository } from './repository.ts';
export type {
  ConfigRow,
  SubjectRow,
  AnalysisRow,
  SuggestionRow,
  FeatureRow,
  ExceptionClassificationRow,
  ModelResultRow,
  EvidenceRow,
  ReviewRow,
} from './repository.ts';

// Services
export { FinanceAiConfigurationService } from './config.service.ts';
export { FinanceAiAnalysisService } from './analysis.service.ts';
export { FinanceAiSuggestionService } from './suggestion.service.ts';
export { FinanceAiReviewService } from './review.service.ts';
export { FinanceAiEvidenceService } from './evidence.service.ts';
