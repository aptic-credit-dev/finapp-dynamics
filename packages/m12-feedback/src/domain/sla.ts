/**
 * Feedback SLA policy spec + deterministic SLA calculation (F18-F19). A policy is a versioned, immutable
 * document (mirrors m09 doctype). Due dates and warn/breach state are computed as PURE functions of a supplied
 * clock (epoch ms) + accumulated paused duration — there is no ambient `Date.now`, so SLA behaviour is fully
 * testable and replayable (ADR-054). m12 does NOT build a timer engine; it uses these deterministic calculations
 * and delegates timer dispatch/escalation to m06/m08.
 */
import { FeedbackError } from './limits.ts';

export const SLA_POLICY_SCHEMA_VERSION = 1;

export interface SlaPolicySpec {
  readonly schemaVersion: number;
  readonly code: string;
  readonly name: string;
  readonly ackMinutes: number;
  readonly assignMinutes: number;
  readonly responseMinutes: number;
  readonly resolutionMinutes: number;
  readonly closureMinutes: number;
  readonly warnThresholdPct: number;
}

export interface SlaSpecError {
  readonly path: string;
  readonly code: string;
}
export interface SlaSpecValidation {
  readonly ok: boolean;
  readonly errors: readonly SlaSpecError[];
}

const IDENT_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const MINUTE_FIELDS = [
  'ackMinutes',
  'assignMinutes',
  'responseMinutes',
  'resolutionMinutes',
  'closureMinutes',
] as const;

export function validateSlaPolicySpec(candidate: unknown): SlaSpecValidation {
  const errors: SlaSpecError[] = [];
  const push = (p: string, c: string): void => void errors.push({ path: p, code: c });
  if (typeof candidate !== 'object' || candidate === null)
    return { ok: false, errors: [{ path: '<root>', code: 'NOT_AN_OBJECT' }] };
  const s = candidate as Record<string, unknown>;
  if (s['schemaVersion'] !== SLA_POLICY_SCHEMA_VERSION) push('schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION');
  if (typeof s['code'] !== 'string' || !IDENT_RE.test(s['code'])) push('code', 'INVALID_CODE');
  if (typeof s['name'] !== 'string' || s['name'].trim() === '') push('name', 'NAME_REQUIRED');
  for (const f of MINUTE_FIELDS) {
    const v = s[f];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) push(f, 'INVALID_MINUTES');
  }
  const warn = s['warnThresholdPct'];
  if (typeof warn !== 'number' || warn < 0 || warn > 100) push('warnThresholdPct', 'INVALID_WARN_PCT');
  return { ok: errors.length === 0, errors };
}

const MIN_MS = 60_000;

export interface SlaDueDates {
  readonly ackAtMs: number;
  readonly assignAtMs: number;
  readonly responseAtMs: number;
  readonly resolutionAtMs: number;
  readonly closureAtMs: number;
}

/** Compute stage due times (epoch ms) from the policy + SLA start. Deterministic. */
export function computeDueDates(policy: SlaPolicySpec, startMs: number): SlaDueDates {
  if (!Number.isFinite(startMs)) throw new FeedbackError('INVALID_START', 'SLA start is invalid');
  return {
    ackAtMs: startMs + policy.ackMinutes * MIN_MS,
    assignAtMs: startMs + policy.assignMinutes * MIN_MS,
    responseAtMs: startMs + policy.responseMinutes * MIN_MS,
    resolutionAtMs: startMs + policy.resolutionMinutes * MIN_MS,
    closureAtMs: startMs + policy.closureMinutes * MIN_MS,
  };
}

export interface SlaStageState {
  readonly breached: boolean;
  readonly warn: boolean;
}

/**
 * Evaluate a single stage against a supplied clock, accounting for paused duration. `warn` fires once the
 * elapsed working time has passed `warnThresholdPct` of the window; `breached` once the (pause-adjusted) due
 * time is passed. PURE — the caller supplies `nowMs` and accumulated `pausedMs`.
 */
export function slaStageState(input: {
  startMs: number;
  dueMs: number;
  nowMs: number;
  pausedMs: number;
  warnThresholdPct: number;
}): SlaStageState {
  const effectiveNow = input.nowMs - input.pausedMs;
  const window = input.dueMs - input.startMs;
  const warnAt = input.startMs + Math.floor((window * input.warnThresholdPct) / 100);
  return {
    breached: effectiveNow > input.dueMs,
    warn: effectiveNow >= warnAt && effectiveNow <= input.dueMs,
  };
}
