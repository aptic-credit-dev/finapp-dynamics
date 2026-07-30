/**
 * Integration ports. M15 reuses the platform's shared engines rather than rebuilding them: authorization via m02,
 * audit via m03, workflow + the ONE transactional outbox via m06, rules via m07, documents via m09, the finance
 * foundation via m19 — all through kernel DI tokens / events / opaque references, never by importing their
 * internals. The `Clock` port keeps exception aging + effective-dating deterministic and replayable (no ambient
 * `Date.now`).
 *
 * M15 is bank reconciliation + the matching engine (m15a). It OWNS no chart of accounts (m19), no GL reconciliation
 * (m20), no journals/postings (m21) and no approval workflow (m22). It emits `reconciliation.lifecycle`; its
 * payloads carry ids/states/scores/variances (INTEGER MINOR UNITS) only — never account numbers, raw statement
 * content or float (ADR-007). Deterministic matching stands alone; AI suggestions (m27) are optional.
 */

/** A monotonic wall-clock source (epoch ms). Effective-dating + validity math take this so they are testable. */
export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/** A fixed clock for deterministic tests. */
export class FixedClock implements Clock {
  private ms: number;
  constructor(ms: number) {
    this.ms = ms;
  }
  now(): number {
    return this.ms;
  }
  advance(byMs: number): void {
    this.ms += byMs;
  }
}
