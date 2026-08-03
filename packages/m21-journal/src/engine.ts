/**
 * The M21 journal validation engine — PURE, deterministic, explainable. Given a draft's lines + context it computes
 * the double-entry balance in INTEGER MINOR UNITS (never float; ADR-007) and produces a reproducible ValidationResult
 * whose findings each carry ONE machine-readable reason code (domain/limits REASON_CODES). Same input => identical
 * output; no ambient time, no randomness, no I/O. This is the single source of the balanced-before-post / no-closed-
 * period / no-duplicate-post decisions the services enforce; the DB CHECKs are the belt to this engine's braces.
 */
import { REASON_CODES } from './domain/limits.ts';

export class JournalEngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'JournalEngineError';
    this.code = code;
  }
}

/** Fail closed on a non-integer "minor units" amount — money is integer minor units, never float. */
export function assertMinorUnits(n: number, label: string): void {
  if (!Number.isInteger(n)) {
    throw new JournalEngineError(
      'float_amount',
      `${label} must be an integer in minor units (got ${String(n)})`,
    );
  }
}

/** Exact integer sum of minor-unit values (rejects any float). */
export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    assertMinorUnits(v, 'amountMinor');
    total += v;
  }
  return total;
}

export interface ValidatableLine {
  readonly id?: string;
  readonly accountRef: string | null;
  readonly direction: string;
  readonly amountMinor: number;
  readonly currencyRef?: string | null;
  readonly status?: string;
}

export interface ValidatableDraft {
  readonly entityRef: string | null;
  readonly currencyRef: string | null;
  readonly periodStatus: string;
  readonly lines: readonly ValidatableLine[];
  /** A succeeded posting already exists for this draft — a re-post would be a duplicate (no duplicate posting). */
  readonly alreadyPosted?: boolean;
}

export interface BalanceResult {
  readonly debitsMinor: number;
  readonly creditsMinor: number;
  readonly varianceMinor: number;
  readonly balanced: boolean;
}

export interface ValidationFinding {
  readonly severity: 'error' | 'warning' | 'info';
  readonly reasonCode: string;
  readonly lineRef?: string;
  readonly detail?: string;
}

export interface ValidationResult {
  readonly isValid: boolean;
  readonly debitsMinor: number;
  readonly creditsMinor: number;
  readonly balanced: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly findings: readonly ValidationFinding[];
}

/** Active lines only — a 'removed' line drops out of the balance (no DELETE; ADR-010). */
function activeLines(lines: readonly ValidatableLine[]): readonly ValidatableLine[] {
  return lines.filter((l) => l.status !== 'removed');
}

/**
 * The double-entry balance over a draft's ACTIVE lines, in exact integer minor units. `balanced` is the exact truth
 * of debits == credits; `varianceMinor` is the exact integer difference (debits - credits). Deterministic.
 */
export function computeBalance(lines: readonly ValidatableLine[]): BalanceResult {
  let debitsMinor = 0;
  let creditsMinor = 0;
  for (const l of activeLines(lines)) {
    if (!Number.isInteger(l.amountMinor) || l.amountMinor <= 0) continue; // invalid lines are surfaced as findings
    if (l.direction === 'debit') debitsMinor += l.amountMinor;
    else if (l.direction === 'credit') creditsMinor += l.amountMinor;
  }
  return {
    debitsMinor,
    creditsMinor,
    varianceMinor: debitsMinor - creditsMinor,
    balanced: debitsMinor === creditsMinor,
  };
}

/**
 * Deterministic, explainable validation of a draft journal. Findings are produced in a fixed order so the result is
 * reproducible. `isValid` is true iff there is no `error` finding — the gate a draft must pass before it can advance
 * out of 'draft' (balanced, decimal-safe, in an open period, no duplicate post).
 */
export function validateDraft(draft: ValidatableDraft): ValidationResult {
  const findings: ValidationFinding[] = [];
  const active = activeLines(draft.lines);

  // 1. structure — a journal needs lines.
  if (active.length === 0) {
    findings.push({
      severity: 'error',
      reasonCode: REASON_CODES.noLines.code,
      detail: 'a draft journal has no active lines',
    });
  }

  // 2. entity — a journal must name its accounting entity (opaque m19 ref).
  if (draft.entityRef === null || draft.entityRef === undefined) {
    findings.push({
      severity: 'error',
      reasonCode: REASON_CODES.missingEntity.code,
      detail: 'no accounting entity',
    });
  }

  // 3. per-line structural checks (decimal safety, positivity, account presence, currency consistency).
  for (const l of active) {
    if (!Number.isInteger(l.amountMinor)) {
      findings.push({
        severity: 'error',
        reasonCode: REASON_CODES.floatAmount.code,
        ...(l.id !== undefined ? { lineRef: l.id } : {}),
        detail: 'line amount is not integer minor units',
      });
    } else if (l.amountMinor <= 0) {
      findings.push({
        severity: 'error',
        reasonCode: REASON_CODES.nonPositiveAmount.code,
        ...(l.id !== undefined ? { lineRef: l.id } : {}),
        detail: 'line amount must be > 0',
      });
    }
    if (l.accountRef === null || l.accountRef === undefined) {
      findings.push({
        severity: 'error',
        reasonCode: REASON_CODES.unknownAccount.code,
        ...(l.id !== undefined ? { lineRef: l.id } : {}),
        detail: 'line has no account',
      });
    }
    if (
      draft.currencyRef !== null &&
      draft.currencyRef !== undefined &&
      l.currencyRef !== null &&
      l.currencyRef !== undefined &&
      l.currencyRef !== draft.currencyRef
    ) {
      findings.push({
        severity: 'error',
        reasonCode: REASON_CODES.currencyMismatch.code,
        ...(l.id !== undefined ? { lineRef: l.id } : {}),
        detail: 'line currency differs from the journal currency',
      });
    }
  }

  // 4. balance — the double-entry invariant (debits == credits).
  const balance = computeBalance(draft.lines);
  if (active.length > 0) {
    const oneSided =
      (balance.debitsMinor === 0 && balance.creditsMinor > 0) ||
      (balance.creditsMinor === 0 && balance.debitsMinor > 0);
    if (oneSided) {
      findings.push({
        severity: 'error',
        reasonCode: REASON_CODES.singleSided.code,
        detail: 'a journal must have both debits and credits',
      });
    } else if (!balance.balanced) {
      findings.push({
        severity: 'error',
        reasonCode: REASON_CODES.unbalanced.code,
        detail: `debits (${String(balance.debitsMinor)}) != credits (${String(balance.creditsMinor)})`,
      });
    }
  }

  // 5. period — no posting into a closed / locked period (ADR-078). Surfaced as an error so a draft in a shut
  //    period cannot pass validation and become submittable.
  if (draft.periodStatus === 'closed') {
    findings.push({
      severity: 'error',
      reasonCode: REASON_CODES.closedPeriod.code,
      detail: 'the target period is closed',
    });
  } else if (draft.periodStatus === 'locked') {
    findings.push({
      severity: 'error',
      reasonCode: REASON_CODES.lockedPeriod.code,
      detail: 'the target period is locked',
    });
  }

  // 6. duplicate posting — a draft that has already posted must not post again (no duplicate posting).
  if (draft.alreadyPosted === true) {
    findings.push({
      severity: 'error',
      reasonCode: REASON_CODES.duplicatePosting.code,
      detail: 'a posting already exists for this draft',
    });
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  // 7. success marker — only when balanced with lines present and no error.
  if (errorCount === 0 && active.length > 0 && balance.balanced) {
    findings.push({ severity: 'info', reasonCode: REASON_CODES.balanced.code, detail: 'debits == credits' });
  }

  return {
    isValid: errorCount === 0,
    debitsMinor: balance.debitsMinor,
    creditsMinor: balance.creditsMinor,
    balanced: balance.balanced,
    errorCount,
    warningCount,
    findings,
  };
}
