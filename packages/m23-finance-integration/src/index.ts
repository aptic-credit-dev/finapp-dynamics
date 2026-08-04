/**
 * @finapp/m23-finance-integration — the finance integration FOUNDATION (Stage 3, FRAMEWORK ONLY / POST-MVP).
 *
 * Records the GOVERNED integration EXECUTION of already-approved posting intents (opaque m21 posting-request + m22
 * approval references) against a configured external DESTINATION, with a Framework-Only lifecycle (prepared -> ready ->
 * dispatched -> acknowledged | failed -> retryable -> exhausted | cancelled), BOUNDED retry, append-only attempt +
 * history evidence, external-reference mappings and an idempotency ledger. Because NO production connector exists,
 * dispatch NEVER calls out — it records intent only (ADR-096/101). Destinations hold SECRET REFERENCES only
 * (`secretref:` pointers, format-checked), NEVER credentials/secrets (ADR-102). Money is OPAQUE bigint evidence, never
 * transformed. It OWNS no journals/posting requests (m21), approval decisions (m22), reconciliation (m20/m15), chart of
 * accounts (m19), payments/AR/AP/treasury or AI (m27); has NO API surface, NO permission namespace, NO event family and
 * NO second outbox/workflow/timer/notification engine. Audit uses the FIN_ prefix (FIN_INTEGRATION_ codes; shared with
 * m19 per ADR-079, non-colliding).
 */

// Audit codes
export { M23_AUDIT_CODES, ALL_M23_AUDIT_CODES, FININT_AUDIT_PREFIX } from './audit-codes.ts';
export type { M23AuditCode } from './audit-codes.ts';

// Domain — vocabulary + reason codes
export {
  M23_LIMITS,
  IntegrationError,
  DESTINATION_TYPES,
  isDestinationType,
  DESTINATION_STATUSES,
  isDestinationStatus,
  EXECUTION_STATUSES,
  isExecutionStatus,
  ATTEMPT_RESULTS,
  isAttemptResult,
  SPEC_STATUSES,
  REASON_CATEGORIES,
  REASON_SEVERITIES,
  REASON_CODES,
  ALL_REASON_CODES,
  reasonCodeOf,
  SECRET_REFERENCE_PATTERN,
  isSecretReference,
} from './domain/vocab.ts';
export type {
  DestinationType,
  DestinationStatus,
  ExecutionStatus,
  AttemptResult,
  SpecStatus,
  ReasonCategory,
  ReasonSeverity,
  ReasonCode,
  ReasonCodeKey,
} from './domain/vocab.ts';

// Domain — lifecycles
export {
  checkDestinationTransition,
  isDestinationDispatchable,
  checkExecutionTransition,
  isExecutionTerminal,
  isExecutionActionable,
  checkSpecTransition,
  isSpecFrozen,
} from './domain/lifecycles.ts';
export type { TransitionResult } from './domain/lifecycles.ts';

// The PURE engine
export {
  decideRetry,
  assertSecretReference,
  evaluateDispatchGate,
  DEFAULT_RETRY_POLICY,
  IntegrationEngineError,
} from './engine.ts';
export type { RetryPolicy, RetryDecision, DispatchGateInput, DispatchGateResult } from './engine.ts';

// Ports (Framework-Only dispatch — never calls out)
export { SystemClock, FixedClock, FrameworkOnlyDispatch } from './ports.ts';
export type { Clock, DispatchPort, DispatchOutcome } from './ports.ts';

// Errors
export { badRequest } from './errors.ts';

// Persistence
export { IntegrationRepository } from './repository.ts';
export type {
  DestinationRow,
  ConfigRow,
  ExecutionRow,
  HistoryRow,
  AttemptRow,
  ExternalReferenceRow,
  IdempotencyRow,
} from './repository.ts';

// Services (Framework-Only internal library — no API/permission/event surface)
export { DestinationService } from './destination.service.ts';
export { ExecutionService } from './execution.service.ts';
