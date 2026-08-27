/**
 * @finapp/m12-feedback — enterprise feedback management (Stage 3.1).
 *
 * The PURE domain layer (feedback/spec state machines, questionnaire spec + answer validation + deterministic
 * CX-score normalization, SLA policy spec + deterministic clock-driven SLA math, closure eligibility gate, and
 * duplicate/related matching) carries no I/O and is exhaustively unit-tested. The services layer runs everything
 * inside `db.withTenant` with audit + outbox in the same transaction; m12 consumes DB/AUDIT/AUTHZ via kernel
 * tokens and publishes `feedback.lifecycle` through the ONE outbox m06 owns. Escalation reuses m08, notifications
 * m08, documents m09, workflow m06, rules m07 — all through events/contracts, never by importing their internals.
 * Nothing is Aptic-specific: sources, products, types are configurable. Customer contacts + narratives are
 * sensitive (redacted; never in events/audit). Case handoff to M13 is a port + pending record + event only.
 */

export { M12_PERMISSIONS, ALL_M12_PERMISSIONS } from './permissions.ts';
export type { M12Permission } from './permissions.ts';
export { M12_AUDIT_CODES, ALL_M12_AUDIT_CODES, FEEDBACK_AUDIT_PREFIX } from './audit-codes.ts';
export type { M12AuditCode } from './audit-codes.ts';

// Domain — limits + vocab
export {
  FEEDBACK_LIMITS,
  FeedbackError,
  FEEDBACK_CHANNELS,
  isChannel,
  SENTIMENTS,
  isSentiment,
  severityRank,
  SEVERITIES,
  isSeverity,
  FEEDBACK_TYPES,
  isFeedbackType,
  isPositiveType,
  ROOT_CAUSE_CATEGORIES,
  isRootCauseCategory,
} from './domain/limits.ts';
export type {
  FeedbackChannel,
  Sentiment,
  Severity,
  FeedbackType,
  RootCauseCategory,
} from './domain/limits.ts';

// Domain — lifecycles
export {
  FEEDBACK_STATUSES,
  checkFeedbackTransition,
  isFeedbackTerminal,
  isFeedbackOpen,
  SPEC_STATUSES,
  SPEC_ACTIONS,
  checkSpecTransition,
  isSpecFrozen,
} from './domain/lifecycles.ts';
export type { FeedbackStatus, SpecStatus, SpecAction, TransitionResult } from './domain/lifecycles.ts';

// Domain — questionnaire + scores
export {
  QUESTIONNAIRE_SCHEMA_VERSION,
  ANSWER_TYPES,
  CX_METRICS,
  validateQuestionnaireSpec,
  validateAnswers,
  computeScores,
} from './domain/questionnaire.ts';
export type {
  QuestionnaireSpec,
  Question,
  AnswerType,
  CxMetric,
  AnswerValue,
  CxScores,
} from './domain/questionnaire.ts';

// Domain — SLA
export {
  SLA_POLICY_SCHEMA_VERSION,
  validateSlaPolicySpec,
  computeDueDates,
  slaStageState,
} from './domain/sla.ts';
export type { SlaPolicySpec, SlaDueDates, SlaStageState } from './domain/sla.ts';

// Domain — closure + matching
export {
  evaluateClosure,
  RELATIONSHIP_KINDS,
  isRelationshipKind,
  duplicateKey,
  relatedKey,
} from './domain/closure.ts';
export type {
  ClosureCriteria,
  ClosureState,
  ClosureEligibility,
  RelationshipKind,
} from './domain/closure.ts';

// Hash + ports
export { contentHashOf, canonicalJson } from './hash.ts';
export { SystemClock, FixedClock } from './ports.ts';
export type { Clock, NormalizedTransaction, SourceSystemAdapter } from './ports.ts';

// Persistence + emit + errors
export { FeedbackRepository } from './repository.ts';
export type {
  SpecRow,
  CategoryRow,
  SourceSystemRow,
  SourceTransactionRow,
  FeedbackRow,
  QueueItemRow,
  ContactAttemptRow,
  ActivityRow,
  ResolutionRow,
  SlaInstanceRow,
  CaseHandoffRow,
  RelationshipRow,
} from './repository.ts';
export { M12Emitter } from './emit.ts';
export { badRequest, invalidSpec } from './errors.ts';

// Services
export { CatalogService } from './catalog.service.ts';
export { FeedbackService } from './feedback.service.ts';
export { RecordsService } from './records.service.ts';
