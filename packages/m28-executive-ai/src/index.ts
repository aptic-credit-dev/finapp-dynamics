/**
 * @finapp/m28-executive-ai — GOVERNED Executive Copilot (Stage 5, mvp:partial): a READ-ONLY, CITED, RLS-MASKED
 * executive assistant. It answers executive questions and produces cross-domain summaries (operations, finance, legal,
 * feedback, cases, KPIs, trends, risk, exceptions, portfolio) for MD/CEO/COO/CFO — every substantive answer is
 * EVIDENCE-BACKED (citations, human-verifiable) and RLS-MASKED (a caller only ever receives data their tenant +
 * row-level entitlements already permit; no cross-tenant inference, no masked-row/count leakage). IT NEVER mutates a
 * business record, approves, posts, disburses, reconciles, closes a case, files a matter, sends a notification, changes
 * roles/rules/workflow or executes ANY controlled action — a HUMAN decides (CLAUDE.md). It consumes the M24 governed AI
 * pipeline BY CONTRACT through an AI-gateway PORT (no second AI engine, no provider/routing/DLP), defers the UNBUILT M32
 * analytics behind a read-only ExecutiveAnalyticsPort (deterministic doubles; fail closed when unavailable), reads
 * cross-domain modules only through read-only ports, audits every action under the shared AI_ prefix (AI_COPILOT_*),
 * shares the m24 ai.* permission namespace (ai.copilot.*; GAP-4 resolved), and owns NO second outbox and NO new event
 * family. Confidence is integer basis points; large question/answer content lives behind M09 references; no float, no
 * secret column. No production provider, no network, no HTTP client.
 */

// Permissions + audit codes
export { M28_PERMISSIONS, ALL_M28_PERMISSIONS, M28_PRIVILEGED_PERMISSIONS } from './permissions.ts';
export type { M28Permission } from './permissions.ts';
export { M28_AUDIT_CODES, ALL_M28_AUDIT_CODES, AI_COPILOT_AUDIT_PREFIX } from './audit-codes.ts';
export type { M28AuditCode } from './audit-codes.ts';

// Domain
export {
  M28_LIMITS,
  ExecutiveAiError,
  DATA_CLASSIFICATIONS,
  isDataClassification,
  isSensitiveClassification,
  SCOPE_LEVELS,
  isScopeLevel,
  INTENT_CLASSES,
  isIntentClass,
  SOURCE_MODULES,
  CITATION_SOURCE_TYPES,
  isCitationSourceType,
  FEEDBACK_RATINGS,
  isFeedbackRating,
  ENTITLEMENT_RESULTS,
  QUERY_STATUSES,
  checkQueryTransition,
  isQueryTerminal,
  RESPONSE_STATUSES,
  checkResponseTransition,
  isResponseTerminal,
  SPEC_STATUSES,
  isSpecFrozen,
  REASON_CODES,
  ALL_REASON_CODES,
  isConfidenceBps,
  evaluateReadOnlyGate,
  screenPromptInjection,
  evaluateCitationGate,
  evaluateEntitlement,
  maskEvidence,
  clampPage,
  clampMaxSources,
} from './domain.ts';
export type {
  DataClassification,
  ScopeLevel,
  IntentClass,
  SourceModule,
  CitationSourceType,
  FeedbackRating,
  EntitlementResult,
  QueryStatus,
  ResponseStatus,
  SpecStatus,
  TransitionResult,
  ReasonCodeKey,
  ReadOnlyGateResult,
  PromptScreenResult,
  CitationGateInput,
  CitationGateResult,
  EvidenceEntitlement,
  Caller,
  EntitlementDecision,
  Page,
} from './domain.ts';

// Errors + emit
export { badRequest, governanceForbidden } from './errors.ts';
export { M28Emitter } from './emit.ts';

// AI gateway port (consumes M24 by contract)
export { M24CopilotGateway } from './gateway.ts';
export type { CopilotAiGatewayPort, AiAnswerInput, AiAnswerResult } from './gateway.ts';

// Cross-domain read ports + M32-deferred analytics (deterministic doubles only)
export {
  FixtureReadPort,
  FixtureFinanceSummaryPort,
  FixtureOperationsSummaryPort,
  FixtureLegalSummaryPort,
  FixtureCaseSummaryPort,
  FixtureDocumentEvidencePort,
  FixtureAnalyticsPort,
  UnavailableAnalyticsPort,
  AnalyticsUnavailableError,
} from './ports.ts';
export type { CrossDomainReadPort, ExecutiveAnalyticsPort, EvidenceItem, ReadPortQuery } from './ports.ts';

// Persistence
export { ExecutiveAiRepository } from './repository.ts';
export type { ConfigRow, SessionRow, QueryRow, ResponseRow, CitationRow, FeedbackRow } from './repository.ts';

// Services
export { CopilotConfigurationService } from './config.service.ts';
export { CopilotSessionService } from './session.service.ts';
export { ExecutiveSummaryService } from './summary.service.ts';
export type { ResolvedEvidence } from './summary.service.ts';
export { CopilotQueryService } from './query.service.ts';
export type { SubmitQueryInput, QueryWithResponse } from './query.service.ts';
export { CopilotResponseService } from './response.service.ts';
export { CopilotFeedbackService } from './feedback.service.ts';
