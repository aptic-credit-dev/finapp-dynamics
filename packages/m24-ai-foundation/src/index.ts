/**
 * @finapp/m24-ai-foundation — the GOVERNED enterprise AI layer (Stage 5, MVP): a provider-agnostic AI gateway + model/
 * prompt/DLP registries and a governed AI request -> output lifecycle with DLP, confidence, source citations, MANDATORY
 * human review, usage/cost metering and approved-provider routing per data classification.
 *
 * AI ASSISTS ONLY — it summarises, classifies and recommends with confidence + citations; it NEVER approves, posts,
 * files, reaches a conclusion or executes any controlled action, and NEVER routes restricted data to an unapproved
 * provider (human accountability preserved; CLAUDE.md hard rules). Production provider adapters are PROHIBITED — only
 * deterministic test doubles ship (no secrets, no network, no lock-in). Providers hold a secret REFERENCE only. Large
 * inputs/outputs/evidence are referenced through m09 documents (opaque ids). It reuses m02/m03/m06/m09 (and, deferred
 * behind a DLP/security port, m41), publishes to the ONE m06 outbox, and owns NO controlled-action execution and NO
 * second outbox.
 */

// Permissions + audit codes
export { M24_PERMISSIONS, ALL_M24_PERMISSIONS, M24_PRIVILEGED_PERMISSIONS } from './permissions.ts';
export type { M24Permission } from './permissions.ts';
export { M24_AUDIT_CODES, ALL_M24_AUDIT_CODES, AI_AUDIT_PREFIX } from './audit-codes.ts';
export type { M24AuditCode } from './audit-codes.ts';

// Domain
export {
  M24_LIMITS,
  AiError,
  DATA_CLASSIFICATIONS,
  isDataClassification,
  SPEC_STATUSES,
  isSpecFrozen,
  REQUEST_STATUSES,
  checkRequestTransition,
  isRequestTerminal,
  OUTPUT_STATUSES,
  checkOutputTransition,
  isOutputTerminal,
  OUTPUT_KINDS,
  isOutputKind,
  DLP_ACTIONS,
  REASON_CODES,
  ALL_REASON_CODES,
  isConfidenceBps,
  evaluateRouting,
  evaluateApprovalGate,
  SECRET_REFERENCE_PATTERN,
  isSecretReference,
  clampPage,
} from './domain.ts';
export type {
  DataClassification,
  SpecStatus,
  RequestStatus,
  OutputStatus,
  OutputKind,
  DlpAction,
  TransitionResult,
  ReasonCodeKey,
  RoutingInput,
  RoutingResult,
  ApprovalGateInput,
  ApprovalGateResult,
  Page,
} from './domain.ts';

// Ports + deterministic doubles (no production adapters)
export {
  SystemClock,
  FixedClock,
  DeterministicProvider,
  SafePromptRenderer,
  DeterministicDlp,
  DeterministicValidator,
  NoopCitationResolver,
  DefaultHumanReviewGateway,
  DefaultUsageMeter,
  DefaultCostCalculator,
  DeterministicProviderHealth,
} from './ports.ts';
export type {
  Clock,
  AiProvider,
  AiGenerationInput,
  AiGenerationOutput,
  PromptRenderer,
  DlpPolicyEvaluator,
  DlpEvaluationResult,
  OutputValidator,
  CitationResolver,
  HumanReviewGateway,
  UsageMeter,
  CostCalculator,
  ProviderHealthPort,
} from './ports.ts';

// Errors + emit
export { badRequest, governanceForbidden } from './errors.ts';
export { M24Emitter } from './emit.ts';

// Persistence
export { AiRepository } from './repository.ts';
export type {
  ProviderRow,
  ModelRow,
  PromptRow,
  DlpPolicyRow,
  ConfigRow,
  RequestRow,
  OutputRow,
  HistoryRow,
  CitationRow,
  HumanReviewRow,
  UsageRow,
} from './repository.ts';

// Services
export { CatalogService } from './catalog.service.ts';
export { RequestService } from './request.service.ts';
export { ReviewService } from './review.service.ts';
