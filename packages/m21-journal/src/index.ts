/**
 * @finapp/m21-journal — the journal engine (Stage 3, DRAFT-first MVP).
 *
 * Turns m20 DRAFT reconciliation recommendations (and operational inputs) into BALANCED, decimal-safe journal DRAFTS
 * (debits == credits in INTEGER MINOR UNITS — never float), runs deterministic + explainable validation (reason
 * codes), manages the draft lifecycle up to submit-for-approval, and PREPARES approval-gated posting requests +
 * records posting-result evidence. Services run inside `db.withTenant` with audit (m03) + journal.lifecycle /
 * posting_request.lifecycle events on the ONE outbox m06 owns. It NEVER approves a journal (m22 owns maker-checker +
 * SoD), posts to a ledger/ERP/core system (m23/m33, post-MVP), auto-posts, posts into a closed/locked period, or
 * duplicate-posts. Owns no chart of accounts/periods (m19), GL reconciliation (m20) or approvals (m22); those are
 * referenced by opaque id.
 */

// Permissions + audit codes
export { M21_PERMISSIONS, ALL_M21_PERMISSIONS, M21_PRIVILEGED_PERMISSIONS } from './permissions.ts';
export type { M21Permission } from './permissions.ts';
export { M21_AUDIT_CODES, ALL_M21_AUDIT_CODES, JOURNAL_AUDIT_PREFIX } from './audit-codes.ts';
export type { M21AuditCode } from './audit-codes.ts';

// Domain — vocab + limits
export {
  M21_LIMITS,
  JournalError,
  SOURCE_TYPES,
  isSourceType,
  JOURNAL_TYPE_KINDS,
  isJournalTypeKind,
  DIRECTIONS,
  isDirection,
  LINE_STATUSES,
  isLineStatus,
  PERIOD_STATUSES,
  isPeriodStatus,
  CONFIDENCE_BANDS,
  isConfidenceBand,
  NOTE_TYPES,
  isNoteType,
  REASON_SEVERITIES,
  isReasonSeverity,
  REASON_CATEGORIES,
  isReasonCategory,
  REASON_CODES,
  ALL_REASON_CODES,
  reasonCodeOf,
} from './domain/limits.ts';
export type {
  SourceType,
  JournalTypeKind,
  Direction,
  LineStatus,
  PeriodStatus,
  ConfidenceBand,
  NoteType,
  ReasonSeverity,
  ReasonCategory,
  ReasonCodeKey,
} from './domain/limits.ts';

// Domain — lifecycles
export {
  DRAFT_STATUSES,
  checkDraftTransition,
  isDraftEditable,
  isDraftTerminal,
  RECOMMENDATION_STATUSES,
  checkRecommendationTransition,
  SPEC_STATUSES,
  checkSpecTransition,
  isSpecFrozen,
  POSTING_REQUEST_STATUSES,
  checkPostingRequestTransition,
  POSTING_RESULT_STATUSES,
  checkPostingResultTransition,
} from './domain/lifecycles.ts';
export type {
  TransitionResult,
  DraftStatus,
  RecommendationStatus,
  SpecStatus,
  PostingRequestStatus,
  PostingResultStatus,
} from './domain/lifecycles.ts';

// The PURE validation + balance engine
export { validateDraft, computeBalance, sumMinor, assertMinorUnits, JournalEngineError } from './engine.ts';
export type {
  ValidatableLine,
  ValidatableDraft,
  BalanceResult,
  ValidationFinding,
  ValidationResult,
} from './engine.ts';

// Ports + errors + emit
export { SystemClock, FixedClock } from './ports.ts';
export type { Clock } from './ports.ts';
export { badRequest, invalidSpec } from './errors.ts';
export { M21Emitter } from './emit.ts';

// Persistence
export { JournalRepository } from './repository.ts';
export type {
  JournalTypeRow,
  JournalConfigRow,
  JournalReasonCodeRow,
  JournalRecommendationRow,
  JournalRecommendationLineRow,
  JournalRecommendationHistoryRow,
  JournalDraftRow,
  JournalLineRow,
  JournalStatusHistoryRow,
  JournalDraftBalanceRow,
  JournalNoteRow,
  JournalValidationRow,
  JournalValidationFindingRow,
  PostingRequestRow,
  PostingRequestHistoryRow,
  PostingResultRow,
  PostingResultHistoryRow,
  PostingIdempotencyRow,
} from './repository.ts';

// Services
export { CatalogService } from './catalog.service.ts';
export { RecommendationService } from './recommendation.service.ts';
export { DraftService } from './draft.service.ts';
export { ValidationService } from './validation.service.ts';
export { PostingService } from './posting.service.ts';
