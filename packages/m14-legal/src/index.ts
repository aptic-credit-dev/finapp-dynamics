/**
 * @finapp/m14-legal — enterprise legal matter management (Stage 4.1).
 *
 * The PURE domain layer (matter + spec state machines, matter-type + SLA-policy spec validation, deterministic
 * clock-driven SLA + deadline + limitation math, closure eligibility gate, matter-number formatting, relationship
 * rules) carries no I/O and is exhaustively unit-tested. The services layer runs everything inside `db.withTenant`
 * with audit + outbox in the same transaction; m14 consumes DB/AUDIT/AUTHZ via kernel tokens and publishes
 * `legal.lifecycle` through the ONE outbox m06 owns. Workflow (m06), rules (m07), escalation/notifications (m08),
 * documents/evidence (m09) and the M13 case conversion are reused THROUGH events/contracts, never by importing
 * their internals. Nothing is Aptic-/Kenya-specific: matter types, jurisdictions, forums are configurable. Legal
 * positions/strategy, opinions, privileged notes, party contacts and confidential settlement terms are sensitive
 * (redacted; never in events/audit). The M13→M14 conversion is idempotent (one matter per source case) and
 * consumes case.converted_to_matter (m14 never reads m13's tables). Costs/exposure/enforcement store finance +
 * court references only — no ledger/posting/payment/tax/reconciliation. m16/m17/m18 + finance are out of scope.
 */

export { M14_PERMISSIONS, ALL_M14_PERMISSIONS, M14_PRIVILEGED_PERMISSIONS } from './permissions.ts';
export type { M14Permission } from './permissions.ts';
export { M14_AUDIT_CODES, ALL_M14_AUDIT_CODES, LEGAL_AUDIT_PREFIX } from './audit-codes.ts';
export type { M14AuditCode } from './audit-codes.ts';

// Domain — limits + vocab
export {
  LEGAL_LIMITS,
  LegalError,
  MATTER_SOURCES,
  isMatterSource,
  CONFIDENTIALITY_LEVELS,
  isConfidentiality,
  confidentialityRank,
  LEGAL_RISKS,
  isLegalRisk,
  PRIORITIES,
  isPriority,
  PARTY_ROLES,
  isPartyRole,
  DEADLINE_TYPES,
  isDeadlineType,
  COURT_EVENT_TYPES,
  isCourtEventType,
  PLEADING_ROLES,
  isPleadingRole,
  OUTCOME_TYPES,
  isOutcomeType,
  ENFORCEMENT_STAGES,
  isEnforcementStage,
  NOTE_TYPES,
  isNoteType,
  isRestrictedNote,
} from './domain/limits.ts';
export type {
  MatterSource,
  Confidentiality,
  LegalRisk,
  Priority,
  PartyRole,
  DeadlineType,
  CourtEventType,
  PleadingRole,
  OutcomeType,
  EnforcementStage,
  NoteType,
} from './domain/limits.ts';

// Domain — lifecycles
export {
  MATTER_STATUSES,
  checkMatterTransition,
  isMatterTerminal,
  isMatterOpen,
  SPEC_STATUSES,
  SPEC_ACTIONS,
  checkSpecTransition,
  isSpecFrozen,
} from './domain/lifecycles.ts';
export type { MatterStatus, SpecStatus, SpecAction, TransitionResult } from './domain/lifecycles.ts';

// Domain — matter type + SLA + deadlines + closure
export { MATTER_TYPE_SCHEMA_VERSION, validateMatterTypeSpec } from './domain/mattertype.ts';
export type { MatterTypeSpec } from './domain/mattertype.ts';
export {
  SLA_POLICY_SCHEMA_VERSION,
  validateLegalSlaPolicySpec,
  computeDueDates,
  slaStageState,
} from './domain/sla.ts';
export type { LegalSlaPolicySpec, SlaDueDates, SlaStageState } from './domain/sla.ts';
export { computeDeadlineDueMs, deadlineState, isLimitationSafe, isLimitation } from './domain/deadlines.ts';
export type { DeadlineRule, DeadlineInput, DeadlineState } from './domain/deadlines.ts';
export { evaluateClosure, RELATIONSHIP_KINDS, isRelationshipKind, isSelfRelation } from './domain/closure.ts';
export type {
  ClosureCriteria,
  ClosureState,
  ClosureEligibility,
  RelationshipKind,
} from './domain/closure.ts';

// Matter number + hash + ports
export { formatMatterNumber, isValidMatterNumber } from './matter-number.ts';
export { contentHashOf, canonicalJson } from './hash.ts';
export { SystemClock, FixedClock } from './ports.ts';
export type { Clock, CaseConversion, NormalizedIntake, IntakeAdapter } from './ports.ts';

// Persistence + emit + errors
export { LegalRepository } from './repository.ts';
export type {
  SpecRow,
  MatterRow,
  ConversionRow,
  InstructionRow,
  PartyRow,
  ActivityRow,
  TaskRow,
  IssueRow,
  PositionRow,
  OpinionRow,
  ResearchRow,
  PleadingRow,
  CourtEventRow,
  DeadlineRow,
  CounselRow,
  CounselReportRow,
  CostRow,
  SettlementRow,
  OutcomeRow,
  NoteRow,
  RelationshipRow,
} from './repository.ts';
export { M14Emitter } from './emit.ts';
export { badRequest, invalidSpec } from './errors.ts';

// Services
export { CatalogService } from './catalog.service.ts';
export { MatterService } from './matter.service.ts';
export { MatterWorkService } from './work.service.ts';
export { MatterLegalService } from './legal.service.ts';
