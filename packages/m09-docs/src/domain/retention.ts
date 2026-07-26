/**
 * Retention + disposition + legal-hold rules — PURE, deterministic (prompt §E12-E14). The service supplies the
 * anchor timestamp (epoch ms) and current time; the domain computes the earliest disposition date and decides
 * eligibility. The overriding invariant: an active legal hold ALWAYS blocks disposal, and retention expiry can
 * never override a hold (ADR-050). Disposal is never automatic — it requires an authorized disposition workflow.
 */
import { DocError } from './limits.ts';
import type { RetentionPolicySpec } from './doctype.ts';

const DAY_MS = 86_400_000;

/** Earliest disposition date (epoch ms) = anchor + retentionDays. */
export function earliestDispositionMs(policy: RetentionPolicySpec, anchorMs: number): number {
  if (!Number.isFinite(anchorMs)) throw new DocError('INVALID_ANCHOR', 'anchor timestamp is invalid');
  return anchorMs + policy.retentionDays * DAY_MS;
}

export interface DispositionEligibility {
  readonly eligible: boolean;
  readonly reason: 'eligible' | 'retained' | 'legal_hold' | 'review_required';
}

/**
 * Decide whether a document may become disposition-eligible. A legal hold blocks unconditionally; otherwise the
 * earliest disposition date must have passed. `reviewRequired` policies still become eligible but must go
 * through pending_review before approval (the service enforces the transition).
 */
export function evaluateDisposition(input: {
  earliestDispositionMs: number;
  nowMs: number;
  legalHold: boolean;
}): DispositionEligibility {
  if (input.legalHold) return { eligible: false, reason: 'legal_hold' };
  if (input.nowMs < input.earliestDispositionMs) return { eligible: false, reason: 'retained' };
  return { eligible: true, reason: 'eligible' };
}

/** A hard guard the service calls before any disposal step — throws if a hold is active (fail closed). */
export function assertNotHeld(legalHold: boolean): void {
  if (legalHold) throw new DocError('LEGAL_HOLD_ACTIVE', 'an active legal hold prevents disposal');
}

/** Is a document with this expiry (epoch ms, or null) considered expired at nowMs? */
export function isExpired(expiresAtMs: number | null, nowMs: number): boolean {
  return expiresAtMs !== null && nowMs >= expiresAtMs;
}
