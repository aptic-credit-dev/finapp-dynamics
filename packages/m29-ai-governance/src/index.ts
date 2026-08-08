/**
 * @finapp/m29-ai-governance — AI GOVERNANCE & RELEASE (Stage 5, mvp:false): the enterprise oversight layer for the AI
 * lifecycle. It governs AI USE CASES + POLICIES and the human-approved RELEASE of M24 assets (model/prompt/provider/
 * policy/use-case versions) with release gates, evaluation EVIDENCE, controlled exceptions/WAIVERS, and suspension/
 * withdrawal. THE LOAD-BEARING RULE: AI NEVER APPROVES ITS OWN RELEASE — final approval requires a HUMAN who is not the
 * proposer (maker != checker), a passing evaluation and a policy check, enforced in the pure gates, the services and DB
 * CHECKs. It records governed DECISIONS + EVIDENCE and EMITS the ai.governance_lifecycle event (family owned/declared by
 * M24; ADR-113) into the ONE m06 outbox as an authorized emitter — NO second family, NO second outbox, NO duplication of
 * the M24 provider/model/request/output foundation. It references M24 assets by OPAQUE id only (reads no m24/business
 * table, calls no provider, stores no credential/secret, holds no prompt/output content), performs NO domain action, NO
 * deployment/runtime control and NO REST API (internal governed library). Confidence/accuracy are integer basis points;
 * no float; no secret column. No production provider, no network, no HTTP client.
 */

// Permissions + audit codes
export {
  M29_PERMISSIONS,
  ALL_M29_PERMISSIONS,
  M29_NEW_PERMISSIONS,
  M29_PRIVILEGED_PERMISSIONS,
} from './permissions.ts';
export type { M29Permission } from './permissions.ts';
export { M29_AUDIT_CODES, ALL_M29_AUDIT_CODES, AI_GOVERNANCE_AUDIT_PREFIX } from './audit-codes.ts';
export type { M29AuditCode } from './audit-codes.ts';

// Domain
export {
  M29_LIMITS,
  AiGovernanceError,
  DATA_CLASSIFICATIONS,
  isDataClassification,
  isSensitiveClassification,
  RISK_TIERS,
  isRiskTier,
  SUBJECT_KINDS,
  isSubjectKind,
  isWaiver,
  DEPLOYMENT_STATUSES,
  isDeploymentStatus,
  DLP_RESULTS,
  SAFETY_RESULTS,
  CITATION_RESULTS,
  isDlpResult,
  isSafetyResult,
  isCitationResult,
  DECISION_KINDS,
  isDecisionKind,
  RELEASE_STATUSES,
  checkReleaseTransition,
  isReleaseTerminal,
  WAIVER_STATUSES,
  checkWaiverTransition,
  ABSOLUTE_CONTROLS,
  isAbsoluteControl,
  SPEC_STATUSES,
  isSpecFrozen,
  REASON_CODES,
  ALL_REASON_CODES,
  isConfidenceBps,
  isHumanActor,
  evaluateSodGate,
  evaluateReleaseGate,
  evaluateWaiverGate,
  evaluatePasses,
  clampPage,
} from './domain.ts';
export type {
  DataClassification,
  RiskTier,
  SubjectKind,
  DeploymentStatus,
  DecisionKind,
  ReleaseStatus,
  WaiverStatus,
  AbsoluteControl,
  SpecStatus,
  TransitionResult,
  ReasonCodeKey,
  SodGateInput,
  SodGateResult,
  ReleaseGateInput,
  ReleaseGateResult,
  WaiverGateInput,
  EvaluationInput,
  Page,
} from './domain.ts';

// Errors + emit
export { badRequest, governanceForbidden } from './errors.ts';
export { M29Emitter } from './emit.ts';

// Persistence
export { AiGovernanceRepository } from './repository.ts';
export type { PolicyRow, UseCaseRow, ReleaseRow, EvaluationRow, DecisionRow } from './repository.ts';

// Services
export { AiGovernancePolicyService } from './policy.service.ts';
export { AiUseCaseGovernanceService } from './use-case.service.ts';
export { AiReleaseService } from './release.service.ts';
export { AiEvaluationService } from './evaluation.service.ts';
export { AiWaiverService } from './waiver.service.ts';
export { AiGovernanceDecisionService } from './decision.service.ts';
