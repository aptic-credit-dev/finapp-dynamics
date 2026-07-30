/**
 * Hard limits + shared vocabulary for bank reconciliation. Bounds are enforced fail-closed. The matching-engine
 * vocab (rule kinds, confidence bands, match types, exception types, directions) is owned by @finapp/m15a-matching
 * and re-exported here so services + validators share one source. Money is INTEGER MINOR UNITS (never float).
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
  EXCEPTION_TYPES,
  isExceptionType,
} from '@finapp/m15a-matching';
export type { RuleKind, ConfidenceBand, MatchType, Direction, ExceptionType } from '@finapp/m15a-matching';

export const RECON_LIMITS = {
  maxCodeChars: 60,
  maxDescriptionChars: 2_000,
  maxImportLines: 100_000,
  maxBatch: 5_000,
  maxSearchLimit: 200,
} as const;

export class ReconError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReconError';
    this.code = code;
  }
}

/** Statement/ledger import source formats. PDF ingestion links a document (m09) + normalized metadata. */
export const SOURCE_FORMATS = ['csv', 'excel', 'pdf', 'api', 'manual'] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];
export function isSourceFormat(v: unknown): v is SourceFormat {
  return typeof v === 'string' && (SOURCE_FORMATS as readonly string[]).includes(v);
}

export const IMPORT_STATUSES = ['pending', 'validated', 'imported', 'rejected'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
export function isImportStatus(v: unknown): v is ImportStatus {
  return typeof v === 'string' && (IMPORT_STATUSES as readonly string[]).includes(v);
}

/** Statement/ledger line reconciliation state. */
export const LINE_STATUSES = ['unmatched', 'matched', 'partially_matched', 'excepted'] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];
export function isLineStatus(v: unknown): v is LineStatus {
  return typeof v === 'string' && (LINE_STATUSES as readonly string[]).includes(v);
}

/** Manual review/override decision kinds — append-only evidence, never overwriting system evidence. */
export const DECISION_TYPES = [
  'manual_match',
  'unmatch',
  'tick',
  'group',
  'split',
  'waive',
  'reopen',
] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];
export function isDecisionType(v: unknown): v is DecisionType {
  return typeof v === 'string' && (DECISION_TYPES as readonly string[]).includes(v);
}

export const NOTE_TYPES = ['general', 'review', 'exception', 'escalation'] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export function isNoteType(v: unknown): v is NoteType {
  return typeof v === 'string' && (NOTE_TYPES as readonly string[]).includes(v);
}

export const MATCHED_BY = ['system', 'manual'] as const;
export type MatchedBy = (typeof MATCHED_BY)[number];
export function isMatchedBy(v: unknown): v is MatchedBy {
  return typeof v === 'string' && (MATCHED_BY as readonly string[]).includes(v);
}
