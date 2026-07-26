/**
 * @finapp/m13-case — enterprise case management (Stage 3.2).
 *
 * The PURE domain layer (case + spec state machines, case-type + SLA-policy spec validation, deterministic
 * clock-driven SLA + deadline math, closure eligibility gate, case-number formatting, relationship rules) carries
 * no I/O and is exhaustively unit-tested. The services layer runs everything inside `db.withTenant` with audit +
 * outbox in the same transaction; m13 consumes DB/AUDIT/AUTHZ via kernel tokens and publishes `case.lifecycle`
 * and `case.converted_to_matter` through the ONE outbox m06 owns. Workflow (m06), rules (m07),
 * escalation/notifications (m08), documents/evidence (m09) and the feedback handoff (m12) are reused THROUGH
 * events/contracts and ports, never by importing their internals. Nothing is Aptic-/Kenya-specific: case types,
 * jurisdictions, SLA policies are configurable. Party contacts, privileged notes, correspondence bodies and
 * confidential settlement terms are sensitive (redacted; never in events/audit). The M12 handoff is idempotent
 * (one case per handoff); the m14 boundary is the case.converted_to_matter event. Settlement/recovery store
 * finance references only — no ledger/posting/payment.
 */

export { M13_PERMISSIONS, ALL_M13_PERMISSIONS, M13_PRIVILEGED_PERMISSIONS } from './permissions.ts';
export type { M13Permission } from './permissions.ts';
export { M13_AUDIT_CODES, ALL_M13_AUDIT_CODES, CASE_AUDIT_PREFIX } from './audit-codes.ts';
export type { M13AuditCode } from './audit-codes.ts';

// Domain — limits + vocab
export {
  CASE_LIMITS,
  CaseError,
  CASE_SOURCES,
  isCaseSource,
  CONFIDENTIALITY_LEVELS,
  isConfidentiality,
  confidentialityRank,
  SEVERITIES,
  isSeverity,
  PRIORITIES,
  isPriority,
  RISK_RATINGS,
  isRiskRating,
  PARTY_TYPES,
  isPartyType,
  FINDING_TYPES,
  isFindingType,
  DECISION_TYPES,
  isDecisionType,
  DEADLINE_TYPES,
  isDeadlineType,
  HEARING_TYPES,
  isHearingType,
  EVIDENCE_TYPES,
  isEvidenceType,
  RECOVERY_STAGES,
  isRecoveryStage,
  NOTE_TYPES,
  isNoteType,
  isRestrictedNote,
} from './domain/limits.ts';
export type {
  CaseSource,
  Confidentiality,
  Severity,
  Priority,
  RiskRating,
  PartyType,
  FindingType,
  DecisionType,
  DeadlineType,
  HearingType,
  EvidenceType,
  RecoveryStage,
  NoteType,
} from './domain/limits.ts';

// Domain — lifecycles
export {
  CASE_STATUSES,
  checkCaseTransition,
  isCaseTerminal,
  isCaseOpen,
  SPEC_STATUSES,
  SPEC_ACTIONS,
  checkSpecTransition,
  isSpecFrozen,
} from './domain/lifecycles.ts';
export type { CaseStatus, SpecStatus, SpecAction, TransitionResult } from './domain/lifecycles.ts';

// Domain — case type + SLA + deadlines + closure
export { CASE_TYPE_SCHEMA_VERSION, validateCaseTypeSpec } from './domain/casetype.ts';
export type { CaseTypeSpec } from './domain/casetype.ts';
export {
  SLA_POLICY_SCHEMA_VERSION,
  validateCaseSlaPolicySpec,
  computeDueDates,
  slaStageState,
} from './domain/sla.ts';
export type { CaseSlaPolicySpec, SlaDueDates, SlaStageState } from './domain/sla.ts';
export { computeDeadlineDueMs, deadlineState, isLimitationSafe } from './domain/deadlines.ts';
export type { DeadlineRule, DeadlineInput, DeadlineState } from './domain/deadlines.ts';
export { evaluateClosure, RELATIONSHIP_KINDS, isRelationshipKind, isSelfRelation } from './domain/closure.ts';
export type {
  ClosureCriteria,
  ClosureState,
  ClosureEligibility,
  RelationshipKind,
} from './domain/closure.ts';

// Case number + hash + ports
export { formatCaseNumber, isValidCaseNumber } from './case-number.ts';
export { contentHashOf, canonicalJson } from './hash.ts';
export { SystemClock, FixedClock, InMemoryHandoffSource } from './ports.ts';
export type {
  Clock,
  FeedbackHandoff,
  FeedbackHandoffSource,
  NormalizedIntake,
  IntakeAdapter,
} from './ports.ts';

// Persistence + emit + errors
export { CaseRepository } from './repository.ts';
export type {
  SpecRow,
  CaseRow,
  PartyRow,
  ActivityRow,
  TaskRow,
  IssueRow,
  InvestigationRow,
  FindingRow,
  DocumentRow,
  EvidenceRow,
  DeadlineRow,
  HearingRow,
  DecisionRow,
  SettlementRow,
  NoteRow,
  RelationshipRow,
  HandoffIntakeRow,
} from './repository.ts';
export { M13Emitter } from './emit.ts';
export { badRequest, invalidSpec } from './errors.ts';

// Services
export { CatalogService } from './catalog.service.ts';
export { CaseService } from './case.service.ts';
export { CaseWorkService } from './work.service.ts';
export { CaseDecisionService } from './decision.service.ts';
