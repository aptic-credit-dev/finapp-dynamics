/**
 * Hard limits + shared vocabulary for GL reconciliation. Bounds are enforced fail-closed. The matching-engine vocab
 * (rule kinds, confidence bands, match types, directions) is owned by @finapp/m15a-matching and re-exported here so
 * services + validators share ONE source — m20 REUSES the engine, it does not duplicate it. Money is INTEGER MINOR
 * UNITS (never float).
 */
export {
  RULE_KINDS,
  isRuleKind,
  CONFIDENCE_BANDS,
  isConfidenceBand,
  COLOUR_STATUS,
  MATCH_TYPES,
  isMatchType,
  DIRECTIONS,
  isDirection,
} from '@finapp/m15a-matching';
export type { RuleKind, ConfidenceBand, MatchType, Direction } from '@finapp/m15a-matching';

export const GLRECON_LIMITS = {
  maxCodeChars: 60,
  maxDescriptionChars: 2_000,
  maxImportLines: 100_000,
  maxBatch: 5_000,
  maxSearchLimit: 200,
} as const;

export class GlreconError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'GlreconError';
    this.code = code;
  }
}

/** GL / source import source formats. */
export const SOURCE_FORMATS = ['csv', 'excel', 'pdf', 'api', 'manual'] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];
export function isSourceFormat(v: unknown): v is SourceFormat {
  return typeof v === 'string' && (SOURCE_FORMATS as readonly string[]).includes(v);
}

/** Import lifecycle: created -> validated -> accepted or rejected. */
export const IMPORT_STATUSES = ['created', 'validated', 'accepted', 'rejected'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
export function isImportStatus(v: unknown): v is ImportStatus {
  return typeof v === 'string' && (IMPORT_STATUSES as readonly string[]).includes(v);
}

/** GL / source line reconciliation state. */
export const LINE_STATUSES = ['unmatched', 'matched', 'partially_matched', 'excepted'] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];
export function isLineStatus(v: unknown): v is LineStatus {
  return typeof v === 'string' && (LINE_STATUSES as readonly string[]).includes(v);
}

/** Match sides — a match member is a GL line or a source line. */
export const MATCH_SIDES = ['gl', 'source'] as const;
export type MatchSide = (typeof MATCH_SIDES)[number];
export function isMatchSide(v: unknown): v is MatchSide {
  return typeof v === 'string' && (MATCH_SIDES as readonly string[]).includes(v);
}

/** GL-reconciliation exception kinds — the conditions a run raises for review. */
export const EXCEPTION_TYPES = [
  'opening_balance_mismatch',
  'closing_balance_mismatch',
  'unmatched_gl',
  'unmatched_source',
  'amount_mismatch',
  'date_out_of_window',
  'duplicate_suspect',
  'out_of_period',
  'currency_mismatch',
  'unsupported_type',
  'unresolved_variance',
] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];
export function isExceptionType(v: unknown): v is ExceptionType {
  return typeof v === 'string' && (EXCEPTION_TYPES as readonly string[]).includes(v);
}

/** Reconciling-item kinds — the residual differences a reconciliation records. */
export const ITEM_TYPES = [
  'timing_difference',
  'unposted_gl',
  'unposted_source',
  'fx_difference',
  'error_correction',
  'other',
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export function isItemType(v: unknown): v is ItemType {
  return typeof v === 'string' && (ITEM_TYPES as readonly string[]).includes(v);
}

/** Manual review/override decision kinds — append-only evidence, never overwriting system evidence. */
export const DECISION_TYPES = [
  'manual_match',
  'unmatch',
  'tick',
  'group',
  'split',
  'clear_item',
  'waive',
  'reopen',
  'assign',
] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];
export function isDecisionType(v: unknown): v is DecisionType {
  return typeof v === 'string' && (DECISION_TYPES as readonly string[]).includes(v);
}

export const NOTE_TYPES = ['general', 'review', 'exception', 'certification', 'escalation'] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export function isNoteType(v: unknown): v is NoteType {
  return typeof v === 'string' && (NOTE_TYPES as readonly string[]).includes(v);
}

export const MATCHED_BY = ['system', 'manual'] as const;
export type MatchedBy = (typeof MATCHED_BY)[number];
export function isMatchedBy(v: unknown): v is MatchedBy {
  return typeof v === 'string' && (MATCHED_BY as readonly string[]).includes(v);
}

/** Draft journal-recommendation status — proposed -> withdrawn or handed_off. NEVER posted or approved by m20. */
export const RECOMMENDATION_STATUSES = ['proposed', 'withdrawn', 'handed_off'] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];
export function isRecommendationStatus(v: unknown): v is RecommendationStatus {
  return typeof v === 'string' && (RECOMMENDATION_STATUSES as readonly string[]).includes(v);
}
