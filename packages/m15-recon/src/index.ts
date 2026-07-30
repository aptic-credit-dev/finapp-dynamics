/**
 * @finapp/m15-recon — bank reconciliation + the matching engine (Stage 3).
 *
 * The PURE deterministic matching engine lives in @finapp/m15a-matching (re-exported below); this package owns the
 * reconciliation DATA + lifecycle: bank accounts, statement + ledger ingestion (duplicate-protected), versioned
 * matching rulesets, reconciliation runs, the matching ORCHESTRATION (via m15a), candidates + matches + match lines,
 * exceptions + aging, manual review/override (append-only evidence), run summaries + notes. Money is INTEGER MINOR
 * UNITS (bigint) — never float. Services run inside `db.withTenant` with audit (m03) + reconciliation.lifecycle
 * events on the ONE outbox m06 owns. Owns no chart of accounts (m19), GL reconciliation (m20), journals/postings
 * (m21) or approvals (m22); m19/m09 referenced by opaque id. AI suggestions (m27) are optional — matching stands
 * alone.
 */

// Permissions + audit codes
export { M15_PERMISSIONS, ALL_M15_PERMISSIONS, M15_PRIVILEGED_PERMISSIONS } from './permissions.ts';
export type { M15Permission } from './permissions.ts';
export { M15_AUDIT_CODES, ALL_M15_AUDIT_CODES, RECON_AUDIT_PREFIX } from './audit-codes.ts';
export type { M15AuditCode } from './audit-codes.ts';

// Domain — vocab + limits (incl. re-exported m15a vocab)
export {
  RECON_LIMITS,
  ReconError,
  SOURCE_FORMATS,
  isSourceFormat,
  IMPORT_STATUSES,
  isImportStatus,
  LINE_STATUSES,
  isLineStatus,
  DECISION_TYPES,
  isDecisionType,
  NOTE_TYPES,
  isNoteType,
  MATCHED_BY,
  isMatchedBy,
  RULE_KINDS,
  isRuleKind,
  CONFIDENCE_BANDS,
  isConfidenceBand,
  COLOUR_STATUS,
  MATCH_TYPES,
  isMatchType,
  DIRECTIONS,
  isDirection,
  EXCEPTION_TYPES,
  isExceptionType,
} from './domain/limits.ts';
export type {
  SourceFormat,
  ImportStatus,
  LineStatus,
  DecisionType,
  NoteType,
  MatchedBy,
} from './domain/limits.ts';
export type { RuleKind, ConfidenceBand, MatchType, Direction, ExceptionType } from './domain/limits.ts';

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
  EXCEPTION_STATUSES,
  checkExceptionTransition,
  isExceptionOpen,
} from './domain/lifecycles.ts';
export type {
  RunStatus,
  MatchStatus,
  RulesetStatus,
  ExceptionStatus,
  TransitionResult,
} from './domain/lifecycles.ts';

// The PURE matching engine (m15a), re-exported for consumers + tests
export {
  scoreCandidate,
  bestCandidate,
  confidenceOf,
  classifyMatchType,
  sumMinor,
  balances,
  amountVarianceMinor,
  dateVarianceDays,
  assertMinorUnits,
} from '@finapp/m15a-matching';
export type { MatchableLine, Ruleset, CandidateScore } from '@finapp/m15a-matching';

// Ports + hash + errors + emit
export { SystemClock, FixedClock } from './ports.ts';
export type { Clock } from './ports.ts';
export { contentHashOf, canonicalJson } from './hash.ts';
export { badRequest, invalidSpec } from './errors.ts';
export { M15Emitter } from './emit.ts';

// Persistence
export { ReconRepository } from './repository.ts';
export type {
  BankAccountRow,
  MatchingRulesetRow,
  MatchingRuleRow,
  RulesetHistoryRow,
  StatementImportRow,
  StatementLineRow,
  LedgerImportRow,
  LedgerEntryRow,
  RunRow,
  StatusHistoryRow,
  MatchRow,
  MatchLineRow,
  MatchCandidateRow,
  ExceptionRow,
  ManualDecisionRow,
  RunSummaryRow,
  NoteRow,
  ImportErrorRow,
} from './repository.ts';

// Services
export { CatalogService } from './catalog.service.ts';
export { ImportService } from './import.service.ts';
export type {
  RawStatementLine,
  RawLedgerEntry,
  StatementImportResult,
  LedgerImportResult,
} from './import.service.ts';
export { ReconciliationService } from './reconciliation.service.ts';
export { MatchService } from './match.service.ts';
