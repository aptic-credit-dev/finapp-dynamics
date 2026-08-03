/**
 * Hard limits + shared vocabulary for the journal engine. Bounds are enforced fail-closed. Money is INTEGER MINOR
 * UNITS (never float; ADR-007). The confidence-band vocabulary matches the m20 handoff so a recommendation's band
 * survives intake unchanged; m21 owns its own reason-code vocabulary (deterministic + explainable validation).
 */

export const M21_LIMITS = {
  maxCodeChars: 60,
  maxDescriptionChars: 2_000,
  maxLines: 1_000,
  maxBatch: 5_000,
  maxSearchLimit: 200,
} as const;

export class JournalError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'JournalError';
    this.code = code;
  }
}

/** Where a recommendation / draft originated. */
export const SOURCE_TYPES = ['gl_reconciliation', 'ai', 'operational', 'manual'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export function isSourceType(v: unknown): v is SourceType {
  return typeof v === 'string' && (SOURCE_TYPES as readonly string[]).includes(v);
}

/** Journal type kinds — CONFIGURABLE (nothing Aptic-/Kenya-specific). */
export const JOURNAL_TYPE_KINDS = ['standard', 'accrual', 'reversal', 'correction', 'adjustment'] as const;
export type JournalTypeKind = (typeof JOURNAL_TYPE_KINDS)[number];
export function isJournalTypeKind(v: unknown): v is JournalTypeKind {
  return typeof v === 'string' && (JOURNAL_TYPE_KINDS as readonly string[]).includes(v);
}

/** A line is a debit or a credit — the only two directions (double-entry). */
export const DIRECTIONS = ['debit', 'credit'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export function isDirection(v: unknown): v is Direction {
  return typeof v === 'string' && (DIRECTIONS as readonly string[]).includes(v);
}

/** Journal line state — no DELETE (ADR-010); a removed line drops out of the balance. */
export const LINE_STATUSES = ['active', 'removed'] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];
export function isLineStatus(v: unknown): v is LineStatus {
  return typeof v === 'string' && (LINE_STATUSES as readonly string[]).includes(v);
}

/** The m19 fiscal-period state m21 reads as the "no posting into a closed period" gate (ADR-078). */
export const PERIOD_STATUSES = ['open', 'closed', 'locked'] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];
export function isPeriodStatus(v: unknown): v is PeriodStatus {
  return typeof v === 'string' && (PERIOD_STATUSES as readonly string[]).includes(v);
}

/** Confidence bands carried on the m20 recommendation handoff (kept verbatim through intake). */
export const CONFIDENCE_BANDS = ['exact', 'strong', 'partial', 'review', 'unmatched'] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];
export function isConfidenceBand(v: unknown): v is ConfidenceBand {
  return typeof v === 'string' && (CONFIDENCE_BANDS as readonly string[]).includes(v);
}

export const NOTE_TYPES = ['general', 'review', 'validation', 'submission', 'posting'] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export function isNoteType(v: unknown): v is NoteType {
  return typeof v === 'string' && (NOTE_TYPES as readonly string[]).includes(v);
}

/** Validation-finding severities + categories (for the configurable reason-code registry). */
export const REASON_SEVERITIES = ['error', 'warning', 'info'] as const;
export type ReasonSeverity = (typeof REASON_SEVERITIES)[number];
export function isReasonSeverity(v: unknown): v is ReasonSeverity {
  return typeof v === 'string' && (REASON_SEVERITIES as readonly string[]).includes(v);
}
export const REASON_CATEGORIES = [
  'balance',
  'period',
  'account',
  'currency',
  'posting',
  'structure',
] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];
export function isReasonCategory(v: unknown): v is ReasonCategory {
  return typeof v === 'string' && (REASON_CATEGORIES as readonly string[]).includes(v);
}

/**
 * Deterministic, machine-readable validation reason codes. Every validation failure maps to exactly one of these,
 * so a decision is explainable and reproducible. `balanced` is the single success code. Registered as configurable
 * reference data in `journal_reason_code`, but the ENGINE emits only these — a fixed, versioned vocabulary.
 */
export const REASON_CODES = {
  balanced: { code: 'balanced', category: 'balance', severity: 'info' },
  unbalanced: { code: 'unbalanced', category: 'balance', severity: 'error' },
  noLines: { code: 'no_lines', category: 'structure', severity: 'error' },
  singleSided: { code: 'single_sided', category: 'balance', severity: 'error' },
  nonPositiveAmount: { code: 'non_positive_amount', category: 'structure', severity: 'error' },
  floatAmount: { code: 'float_amount', category: 'structure', severity: 'error' },
  currencyMismatch: { code: 'currency_mismatch', category: 'currency', severity: 'error' },
  unknownAccount: { code: 'unknown_account', category: 'account', severity: 'error' },
  missingEntity: { code: 'missing_entity', category: 'structure', severity: 'error' },
  closedPeriod: { code: 'closed_period', category: 'period', severity: 'error' },
  lockedPeriod: { code: 'locked_period', category: 'period', severity: 'error' },
  duplicatePosting: { code: 'duplicate_posting', category: 'posting', severity: 'error' },
  draftNotEditable: { code: 'draft_not_editable', category: 'structure', severity: 'error' },
} as const;

export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES = Object.values(REASON_CODES).map((r) => r.code);
export function reasonCodeOf(key: ReasonCodeKey): string {
  return REASON_CODES[key].code;
}
