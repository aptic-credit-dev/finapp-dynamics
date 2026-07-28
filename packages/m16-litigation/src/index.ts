/**
 * @finapp/m16-litigation — enterprise litigation & adjudicative proceedings management (Stage 4.2).
 *
 * The PURE domain layer (proceeding + spec state machines, proceeding-type + SLA-policy spec validation,
 * deterministic clock-driven SLA + deadline + limitation math, closure eligibility gate, proceeding-number
 * formatting, relationship rules) carries no I/O and is exhaustively unit-tested. The services layer runs
 * everything inside `db.withTenant` with audit + outbox in the same transaction; m16 consumes DB/AUDIT/AUTHZ via
 * kernel tokens and publishes `litigation.lifecycle` through the ONE outbox m06 owns. Workflow (m06), rules (m07),
 * escalation/notifications (m08), documents/evidence/bundles (m09) and the M14 matter referral are reused THROUGH
 * events/contracts, never by importing their internals. Nothing is jurisdiction-specific: proceeding types, forums
 * and courts are configurable. Legal strategy, full pleadings, witness statements, private witness/party contacts
 * and confidential order/outcome terms are sensitive (redacted; never in events/audit). The M14→M16 referral is
 * idempotent (one proceeding per referral key) and m16 never reads m14's tables. Costs store court + finance
 * references only — no ledger/posting/payment/tax/reconciliation. Enforcement (m17) + knowledge (m18) are out of
 * scope: m16 emits only safe boundary signals.
 */

export { M16_PERMISSIONS, ALL_M16_PERMISSIONS, M16_PRIVILEGED_PERMISSIONS } from './permissions.ts';
export type { M16Permission } from './permissions.ts';
export { M16_AUDIT_CODES, ALL_M16_AUDIT_CODES, LITIGATION_AUDIT_PREFIX } from './audit-codes.ts';
export type { M16AuditCode } from './audit-codes.ts';

// Domain — limits + vocab
export {
  LITIGATION_LIMITS,
  LitigationError,
  PROCEEDING_SOURCES,
  isProceedingSource,
  FORUM_TYPES,
  isForumType,
  ORGANIZATION_ROLES,
  isOrganizationRole,
  CONFIDENTIALITY_LEVELS,
  isConfidentiality,
  confidentialityRank,
  LITIGATION_RISKS,
  isLitigationRisk,
  PRIORITIES,
  isPriority,
  PARTY_ROLES,
  isPartyRole,
  CLAIM_TYPES,
  isClaimType,
  FILING_ROLES,
  isFilingRole,
  SERVICE_METHODS,
  isServiceMethod,
  APPEARANCE_TYPES,
  isAppearanceType,
  WITNESS_TYPES,
  isWitnessType,
  ORDER_TYPES,
  isOrderType,
  OUTCOME_TYPES,
  isOutcomeType,
  DEADLINE_TYPES,
  isDeadlineType,
  COST_TYPES,
  isCostType,
  NOTE_TYPES,
  isNoteType,
  isRestrictedNote,
} from './domain/limits.ts';
export type {
  ProceedingSource,
  ForumType,
  OrganizationRole,
  Confidentiality,
  LitigationRisk,
  Priority,
  PartyRole,
  ClaimType,
  FilingRole,
  ServiceMethod,
  AppearanceType,
  WitnessType,
  OrderType,
  OutcomeType,
  DeadlineType,
  CostType,
  NoteType,
} from './domain/limits.ts';

// Domain — lifecycles
export {
  PROCEEDING_STATUSES,
  PROCEEDING_TERMINAL,
  checkProceedingTransition,
  isProceedingTerminal,
  isProceedingOpen,
  SPEC_STATUSES,
  SPEC_ACTIONS,
  checkSpecTransition,
  isSpecFrozen,
} from './domain/lifecycles.ts';
export type { ProceedingStatus, SpecStatus, SpecAction, TransitionResult } from './domain/lifecycles.ts';

// Domain — proceeding type + SLA + deadlines + closure
export { PROCEEDING_TYPE_SCHEMA_VERSION, validateProceedingTypeSpec } from './domain/proceedingtype.ts';
export type { ProceedingTypeSpec, SpecError, SpecValidation } from './domain/proceedingtype.ts';
export {
  SLA_POLICY_SCHEMA_VERSION,
  validateLitigationSlaPolicySpec,
  computeDueDates,
  slaStageState,
} from './domain/sla.ts';
export type {
  LitigationSlaPolicySpec,
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

// Proceeding number + hash + ports
export { formatProceedingNumber, isValidProceedingNumber } from './proceeding-number.ts';
export { contentHashOf, canonicalJson } from './hash.ts';
export { SystemClock, FixedClock } from './ports.ts';
export type { Clock, MatterReferral, NormalizedProceedingIntake, ProceedingIntakeAdapter } from './ports.ts';

// Persistence + emit + errors
export { LitigationRepository } from './repository.ts';
export type {
  SpecRow,
  ProceedingRow,
  ReferralRow,
  PartyRow,
  ClaimRow,
  FilingRow,
  ServiceRow,
  AppearanceRow,
  ProceedingRecordRow,
  WitnessRow,
  ExpertRow,
  ExhibitRow,
  BundleRow,
  BundleItemRow,
  OrderRow,
  ComplianceRow,
  OutcomeRow,
  AppealRow,
  DeadlineRow,
  CostRow,
  NoteRow,
  RelationshipRow,
} from './repository.ts';
export { M16Emitter } from './emit.ts';
export { badRequest, invalidSpec } from './errors.ts';

// Services
export { CatalogService } from './catalog.service.ts';
export { ProceedingService } from './proceeding.service.ts';
export { LitigationWorkService } from './litigation.service.ts';
