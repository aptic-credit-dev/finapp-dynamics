/**
 * @finapp/m25-operational-ai — GOVERNED Operational AI (Stage 5, MVP): human-reviewed AI SUGGESTIONS for Feedback (m12)
 * and Case (m13) — summaries, sentiment, classification, root-cause hints, suggested activities and routing/escalation
 * recommendations. It RECOMMENDS ONLY — it never closes, escalates, reassigns or resolves a controlled item on its own;
 * a human decides and acts (CLAUDE.md hard rules). It consumes the M24 governed AI gateway/registries + request->output
 * ->human-review pipeline BY CONTRACT through an AI-gateway PORT (no second AI engine, no provider/routing/DLP/prompt/
 * vector of its own), references feedback/case/document/M24 subjects by OPAQUE id (reads no m12/m13/m24 table), audits
 * every mutation under the shared AI_ prefix (AI_OPS_*), shares the m24 ai.* permission namespace, and owns NO second
 * outbox and NO new event family (M24 emits the ai.*_lifecycle events). No provider adapter, no network, no HTTP client.
 */

// Permissions + audit codes
export { M25_PERMISSIONS, ALL_M25_PERMISSIONS, M25_PRIVILEGED_PERMISSIONS } from './permissions.ts';
export type { M25Permission } from './permissions.ts';
export { M25_AUDIT_CODES, ALL_M25_AUDIT_CODES, AI_OPS_AUDIT_PREFIX } from './audit-codes.ts';
export type { M25AuditCode } from './audit-codes.ts';

// Domain
export {
  M25_LIMITS,
  OperationalAiError,
  SUBJECT_TYPES,
  isSubjectType,
  ANALYSIS_KINDS,
  isAnalysisKind,
  SENTIMENT_LABELS,
  isSentimentLabel,
  ANALYSIS_STATUSES,
  checkAnalysisTransition,
  isAnalysisTerminal,
  SUGGESTION_TYPES,
  isSuggestionType,
  SUGGESTION_STATUSES,
  checkSuggestionTransition,
  isSuggestionTerminal,
  SPEC_STATUSES,
  isSpecFrozen,
  DECISIONS,
  isDecision,
  decisionToState,
  EVIDENCE_SOURCES,
  isEvidenceSource,
  REVIEW_TARGETS,
  REASON_CODES,
  ALL_REASON_CODES,
  isConfidenceBps,
  evaluateDecisionGate,
  clampPage,
} from './domain.ts';
export type {
  SubjectType,
  AnalysisKind,
  SentimentLabel,
  AnalysisStatus,
  SuggestionType,
  SuggestionStatus,
  SpecStatus,
  Decision,
  EvidenceSource,
  ReviewTarget,
  ReasonCodeKey,
  TransitionResult,
  DecisionGateInput,
  DecisionGateResult,
  Page,
} from './domain.ts';

// Errors + emit
export { badRequest, governanceForbidden } from './errors.ts';
export { M25Emitter } from './emit.ts';

// AI gateway port (consumes M24 by contract)
export { M24AiGateway } from './gateway.ts';
export type { AiGatewayPort, AiAnalysisInput, AiAnalysisResult, AiDecisionResult } from './gateway.ts';

// Persistence
export { OperationalAiRepository } from './repository.ts';
export type {
  ConfigRow,
  SubjectRow,
  AnalysisRow,
  SuggestionRow,
  EvidenceRow,
  ReviewRow,
} from './repository.ts';

// Services
export { ConfigService } from './config.service.ts';
export { OperationalAiService } from './operational.service.ts';
export { SuggestionService } from './suggestion.service.ts';
