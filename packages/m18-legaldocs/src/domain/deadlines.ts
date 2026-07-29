/**
 * Deterministic review/expiry-deadline calculation — PURE. Review, expiry, renewal and authority-review dates are
 * computed from a start instant + a calculation rule against a SUPPLIED clock (epoch ms), never ambient
 * `Date.now`, so overdue behaviour is replayable and unit-testable (ADR-074). Two rule kinds are supported
 * deterministically: a fixed offset in calendar days, and an explicit due instant. Business-calendar expansion is
 * delegated to m06's calendar, consumed through a port — not reimplemented here. m18 builds NO timer engine;
 * overdue/review dispatch is delegated to m06/m08.
 */
import { LegalDocsError, isReviewType } from './limits.ts';

const DAY_MS = 86_400_000;

export interface ReviewRule {
  readonly kind: 'offset_days' | 'explicit';
  readonly days?: number;
  readonly dueMs?: number;
}

export interface ReviewInput {
  readonly type: string;
  readonly startMs: number;
  readonly rule: ReviewRule;
}

/** Compute a review/expiry deadline's due instant (epoch ms). Deterministic; validates the type + rule fail-closed. */
export function computeReviewDueMs(input: ReviewInput): number {
  if (!isReviewType(input.type))
    throw new LegalDocsError('INVALID_REVIEW_TYPE', `unknown review type "${input.type}"`);
  if (!Number.isFinite(input.startMs)) throw new LegalDocsError('INVALID_START', 'review start is invalid');
  if (input.rule.kind === 'explicit') {
    if (typeof input.rule.dueMs !== 'number' || !Number.isFinite(input.rule.dueMs)) {
      throw new LegalDocsError('INVALID_RULE', 'explicit review needs a finite dueMs');
    }
    return input.rule.dueMs;
  }
  const days = input.rule.days;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0) {
    throw new LegalDocsError('INVALID_RULE', 'offset_days review needs a non-negative integer days');
  }
  return input.startMs + days * DAY_MS;
}

export interface ReviewState {
  readonly overdue: boolean;
  readonly warn: boolean;
  readonly remainingMs: number;
}

/**
 * Evaluate a review/expiry deadline against a supplied clock. `warn` fires inside the final `warnWindowMs` before
 * due; `overdue` once due is passed. PURE.
 */
export function reviewState(input: { dueMs: number; nowMs: number; warnWindowMs: number }): ReviewState {
  const remainingMs = input.dueMs - input.nowMs;
  return {
    overdue: input.nowMs > input.dueMs,
    warn: remainingMs > 0 && remainingMs <= input.warnWindowMs,
    remainingMs,
  };
}

/** `expiry` is the highest-risk review deadline: an authority/knowledge expiry must not already be in the past. */
export function isExpirySafe(type: string, dueMs: number, nowMs: number): boolean {
  return type !== 'expiry' || dueMs > nowMs;
}
export function isExpiry(type: string): boolean {
  return type === 'expiry';
}
