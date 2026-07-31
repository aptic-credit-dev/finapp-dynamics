/**
 * @finapp/m20-glrecon — general-ledger reconciliation (Stage 3).
 *
 * Reconciles GL balances + transactions against a source system: multi-account GL/source ingestion (duplicate-
 * protected), the balance invariant (opening + debits − credits = calculated closing) in INTEGER MINOR UNITS,
 * versioned matching rulesets, reconciliation runs, the deterministic matching ORCHESTRATION (REUSES the PURE m15a
 * engine — never duplicated), candidates + matches + match lines, reconciling items, exceptions + aging, manual
 * review/override (append-only evidence), balance certification (with a privileged override for open blockers), and
 * DRAFT journal recommendations handed off to m21. Money is INTEGER MINOR UNITS (bigint) — never float. Services run
 * inside `db.withTenant` with audit (m03) + glrecon.lifecycle events on the ONE outbox m06 owns. It NEVER posts a
 * journal, writes to the general ledger, or approves anything. Owns no chart of accounts (m19), bank reconciliation
 * (m15), journal posting (m21) or approvals (m22); m19 referenced by opaque id.
 */

// Permissions + audit codes
export { M20_PERMISSIONS, ALL_M20_PERMISSIONS, M20_PRIVILEGED_PERMISSIONS } from './permissions.ts';
export type { M20Permission } from './permissions.ts';
export { M20_AUDIT_CODES, ALL_M20_AUDIT_CODES, GLRECON_AUDIT_PREFIX } from './audit-codes.ts';
export type { M20AuditCode } from './audit-codes.ts';

// Domain — vocab + limits (incl. re-exported m15a vocab)
export {
  GLRECON_LIMITS,
  GlreconError,
  SOURCE_FORMATS,
  isSourceFormat,
  IMPORT_STATUSES,
  isImportStatus,
  LINE_STATUSES,
  isLineStatus,
  MATCH_SIDES,
  isMatchSide,
  EXCEPTION_TYPES,
  isExceptionType,
  ITEM_TYPES,
  isItemType,
  DECISION_TYPES,
  isDecisionType,
  NOTE_TYPES,
  isNoteType,
  MATCHED_BY,
  isMatchedBy,
  RECOMMENDATION_STATUSES,
  isRecommendationStatus,
  RULE_KINDS,
  isRuleKind,
  CONFIDENCE_BANDS,
  isConfidenceBand,
  COLOUR_STATUS,
  MATCH_TYPES,
  isMatchType,
  DIRECTIONS,
  isDirection,
} from './domain/limits.ts';
export type {
  SourceFormat,
  ImportStatus,
  LineStatus,
  MatchSide,
  ExceptionType,
  ItemType,
  DecisionType,
  NoteType,
  MatchedBy,
  RecommendationStatus,
  RuleKind,
  ConfidenceBand,
  MatchType,
  Direction,
} from './domain/limits.ts';

// Domain — lifecycles
export {
  RUN_STATUSES,
  checkRunTransition,
  isRunOpen,
  MATCH_STATUSES,
  checkMatchTransition,
  RULESET_STATUSES,
  checkRulesetTransition,
  isRulesetFrozen,
  ITEM_STATUSES,
  checkItemTransition,
  isItemOpen,
  EXCEPTION_STATUSES,
  checkExceptionTransition,
  isExceptionOpen,
  CERTIFICATION_STATUSES,
  checkCertificationTransition,
} from './domain/lifecycles.ts';
export type {
  RunStatus,
  MatchStatus,
  RulesetStatus,
  ItemStatus,
  ExceptionStatus,
  CertificationStatus,
  TransitionResult,
} from './domain/lifecycles.ts';

// The GL BALANCE engine (m20) + the REUSED m15a line-matching engine
export {
  aggregateByDirection,
  calculatedClosingMinor,
  reconcileBalance,
  GlBalanceError,
  scoreCandidate,
  bestCandidate,
  confidenceOf,
  classifyMatchType,
  sumMinor,
  balances,
  amountVarianceMinor,
  dateVarianceDays,
  assertMinorUnits,
} from './engine.ts';
export type {
  DirectionalAmount,
  BalanceReconciliation,
  MatchableLine,
  Ruleset,
  CandidateScore,
} from './engine.ts';

// Ports + hash + errors + emit
export { SystemClock, FixedClock } from './ports.ts';
export type { Clock } from './ports.ts';
export { contentHashOf, canonicalJson } from './hash.ts';
export { badRequest, invalidSpec } from './errors.ts';
export { M20Emitter } from './emit.ts';

// Persistence
export { GlreconRepository } from './repository.ts';
export type {
  GlAccountRow,
  GlRulesetRow,
  GlRuleRow,
  GlRulesetHistoryRow,
  GlImportRow,
  GlImportErrorRow,
  GlBalanceRow,
  GlLineRow,
  GlSourceImportRow,
  GlSourceLineRow,
  GlRunRow,
  GlRunStatusHistoryRow,
  GlRunBalanceRow,
  GlMatchRow,
  GlMatchLineRow,
  GlMatchCandidateRow,
  GlReconcilingItemRow,
  GlExceptionRow,
  GlManualDecisionRow,
  GlCertificationRow,
  GlCertificationHistoryRow,
  GlRecommendationRow,
  GlRunSummaryRow,
  GlNoteRow,
} from './repository.ts';

// Services
export { CatalogService } from './catalog.service.ts';
export { ImportService } from './import.service.ts';
export type { RawGlLine, RawSourceLine, GlImportResult, SourceImportResult } from './import.service.ts';
export { ReconciliationService } from './reconciliation.service.ts';
export { MatchService } from './match.service.ts';
export { CertificationService } from './certification.service.ts';
export { RecommendationService } from './recommendation.service.ts';
