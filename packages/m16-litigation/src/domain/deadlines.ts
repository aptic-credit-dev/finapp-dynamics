/**
 * Deterministic litigation-deadline calculation — PURE. Deadlines (filing / service / response / disclosure /
 * witness_statement / expert_report / bundle / submissions / appeal / order_compliance / limitation / …) are
 * computed from a start instant + a calculation rule against a SUPPLIED clock (epoch ms), never ambient
 * `Date.now`, so behaviour is replayable and unit-testable (ADR-066). Two rule kinds are supported
 * deterministically: a fixed offset in calendar days, and an explicit due instant. Business-calendar expansion is
 * delegated to m06's calendar, consumed through a port — not reimplemented here. `limitation` deadlines are
 * high-risk and clearly distinguishable. m16 builds NO timer engine; breach dispatch is delegated to m06/m08.
 */
import { LitigationError, isDeadlineType } from './limits.ts';

const DAY_MS = 86_400_000;

export interface DeadlineRule {
  readonly kind: 'offset_days' | 'explicit';
  readonly days?: number;
  readonly dueMs?: number;
}

export interface DeadlineInput {
  readonly type: string;
  readonly startMs: number;
  readonly rule: DeadlineRule;
}

/** Compute a deadline's due instant (epoch ms). Deterministic; validates the type + rule fail-closed. */
export function computeDeadlineDueMs(input: DeadlineInput): number {
  if (!isDeadlineType(input.type))
    throw new LitigationError('INVALID_DEADLINE_TYPE', `unknown deadline type "${input.type}"`);
  if (!Number.isFinite(input.startMs))
    throw new LitigationError('INVALID_START', 'deadline start is invalid');
  if (input.rule.kind === 'explicit') {
    if (typeof input.rule.dueMs !== 'number' || !Number.isFinite(input.rule.dueMs)) {
      throw new LitigationError('INVALID_RULE', 'explicit deadline needs a finite dueMs');
    }
    return input.rule.dueMs;
  }
  const days = input.rule.days;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0) {
    throw new LitigationError('INVALID_RULE', 'offset_days deadline needs a non-negative integer days');
  }
  return input.startMs + days * DAY_MS;
}

export interface DeadlineState {
  readonly breached: boolean;
  readonly warn: boolean;
  readonly remainingMs: number;
}

/**
 * Evaluate a deadline against a supplied clock. `warn` fires inside the final `warnWindowMs` before due;
 * `breached` once due is passed. PURE.
 */
export function deadlineState(input: { dueMs: number; nowMs: number; warnWindowMs: number }): DeadlineState {
  const remainingMs = input.dueMs - input.nowMs;
  return {
    breached: input.nowMs > input.dueMs,
    warn: remainingMs > 0 && remainingMs <= input.warnWindowMs,
    remainingMs,
  };
}

/** `limitation` is the highest-risk deadline: a limitation date must not already be in the past. */
export function isLimitationSafe(type: string, dueMs: number, nowMs: number): boolean {
  return type !== 'limitation' || dueMs > nowMs;
}
export function isLimitation(type: string): boolean {
  return type === 'limitation';
}
