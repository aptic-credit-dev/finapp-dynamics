/**
 * @finapp/m17-recovery — enterprise recovery & enforcement management (Stage 4.3).
 *
 * The PURE domain layer (recovery + spec state machines, recovery-type + SLA-policy spec validation, deterministic
 * clock-driven SLA + deadline + limitation math, closure eligibility gate, recovery-number formatting, relationship
 * rules) carries no I/O and is exhaustively unit-tested. The services layer runs everything inside `db.withTenant`
 * with audit + outbox in the same transaction; m17 consumes DB/AUDIT/AUTHZ via kernel tokens and publishes
 * `recovery.lifecycle` through the ONE outbox m06 owns. Workflow (m06), rules (m07), escalation/notifications (m08),
 * documents (m09) and the M16 enforcement referral are reused THROUGH events/contracts, never by importing their
 * internals. Nothing is jurisdiction-specific: recovery types, courts, auctioneers and enforcement methods are
 * configurable. Debtor contacts, negotiation strategy, settlement terms, bank/payment details, security valuations
 * and privileged notes are sensitive (redacted; never in events/audit). The M16→M17 referral is idempotent (one
 * recovery per referral key) and m17 never reads m16/m14 tables. FINANCE BOUNDARY (ADR-071): ALL amounts are
 * REFERENCES only — no cash application, ledger posting, AR, payment, reconciliation, or accounting write-off.
 * Write-off is a RECOMMENDATION with maker-checker approval; a human/finance system executes the accounting.
 */

export { M17_PERMISSIONS, ALL_M17_PERMISSIONS, M17_PRIVILEGED_PERMISSIONS } from './permissions.ts';
export type { M17Permission } from './permissions.ts';
export { M17_AUDIT_CODES, ALL_M17_AUDIT_CODES, RECOVERY_AUDIT_PREFIX } from './audit-codes.ts';
export type { M17AuditCode } from './audit-codes.ts';

// Domain — limits + vocab
export {
  RECOVERY_LIMITS,
  RecoveryError,
  RECOVERY_SOURCES,
  isRecoverySource,
  INSTRUMENT_TYPES,
  isInstrumentType,
  RECOVERY_STRATEGIES,
  isRecoveryStrategy,
  CONFIDENTIALITY_LEVELS,
  isConfidentiality,
  confidentialityRank,
  RECOVERY_RISKS,
  isRecoveryRisk,
  PRIORITIES,
  isPriority,
  PARTY_ROLES,
  isPartyRole,
  DEMAND_TYPES,
  isDemandType,
  ARRANGEMENT_TYPES,
  isArrangementType,
  ENFORCEMENT_ACTION_TYPES,
  isEnforcementActionType,
  SECURITY_TYPES,
  isSecurityType,
  RECEIPT_TYPES,
  isReceiptType,
  DEADLINE_TYPES,
  isDeadlineType,
  COST_TYPES,
  isCostType,
  WRITEOFF_REASONS,
  isWriteOffReason,
  OUTCOME_TYPES,
  isOutcomeType,
  NOTE_TYPES,
  isNoteType,
  isRestrictedNote,
} from './domain/limits.ts';
export type {
  RecoverySource,
  InstrumentType,
  RecoveryStrategy,
  Confidentiality,
  RecoveryRisk,
  Priority,
  PartyRole,
  DemandType,
  ArrangementType,
  EnforcementActionType,
  SecurityType,
  ReceiptType,
  DeadlineType,
  CostType,
  WriteOffReason,
  NoteType,
} from './domain/limits.ts';

// Domain — lifecycles
export {
  RECOVERY_STATUSES,
  RECOVERY_TERMINAL,
  checkRecoveryTransition,
  isRecoveryTerminal,
  isRecoveryOpen,
  SPEC_STATUSES,
  SPEC_ACTIONS,
  checkSpecTransition,
  isSpecFrozen,
} from './domain/lifecycles.ts';
export type { RecoveryStatus, SpecStatus, SpecAction, TransitionResult } from './domain/lifecycles.ts';

// Domain — recovery type + SLA + deadlines + closure
export { RECOVERY_TYPE_SCHEMA_VERSION, validateRecoveryTypeSpec } from './domain/recoverytype.ts';
export type { RecoveryTypeSpec, SpecError, SpecValidation } from './domain/recoverytype.ts';
export {
  SLA_POLICY_SCHEMA_VERSION,
  validateRecoverySlaPolicySpec,
  computeDueDates,
  slaStageState,
} from './domain/sla.ts';
export type {
  RecoverySlaPolicySpec,
  SlaDueDates,
  SlaStageState,
  SlaSpecError,
  SlaSpecValidation,
} from './domain/sla.ts';
export { computeDeadlineDueMs, deadlineState, isLimitationSafe, isLimitation } from './domain/deadlines.ts';
export type { DeadlineRule, DeadlineInput, DeadlineState } from './domain/deadlines.ts';
export { evaluateClosure, RELATIONSHIP_KINDS, isRelationshipKind, isSelfRelation } from './domain/closure.ts';
export type {
  ClosureCriteria,
  ClosureState,
  ClosureEligibility,
  RelationshipKind,
} from './domain/closure.ts';

// Recovery number + hash + ports
export { formatRecoveryNumber, isValidRecoveryNumber } from './recovery-number.ts';
export { contentHashOf, canonicalJson } from './hash.ts';
export { SystemClock, FixedClock } from './ports.ts';
export type { Clock, EnforcementReferral, NormalizedRecoveryIntake, RecoveryIntakeAdapter } from './ports.ts';

// Persistence + emit + errors
export { RecoveryRepository } from './repository.ts';
export type {
  SpecRow,
  RecoveryRow,
  ReferralRow,
  PartyRow,
  InstrumentRow,
  StrategyRow,
  DemandRow,
  NegotiationRow,
  ArrangementRow,
  InstallmentRow,
  EnforcementActionRow,
  SecurityRow,
  AgentRow,
  AgentReportRow,
  ReceiptRow,
  WaiverRow,
  WriteoffRow,
  OutcomeRow,
  DeadlineRow,
  CostRow,
  NoteRow,
  RelationshipRow,
} from './repository.ts';
export { M17Emitter } from './emit.ts';
export { badRequest, invalidSpec } from './errors.ts';

// Services
export { CatalogService } from './catalog.service.ts';
export { RecoveryService } from './recovery.service.ts';
export { RecoveryWorkService } from './recovery-work.service.ts';
