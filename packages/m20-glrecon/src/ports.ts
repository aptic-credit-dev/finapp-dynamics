/**
 * Integration ports. M20 reuses the platform's shared engines rather than rebuilding them: authorization via m02,
 * audit via m03, workflow + the ONE transactional outbox via m06, the finance foundation via m19 (opaque account/
 * period/currency refs) — all through kernel DI tokens / events / opaque references, never by importing their
 * internals. Line matching REUSES the m15a engine. The `Clock` port keeps exception + reconciling-item aging
 * deterministic and replayable (no ambient `Date.now`).
 *
 * M20 is GL reconciliation. It OWNS no chart of accounts (m19), no bank reconciliation (m15), no journals/postings
 * (m21) and no approval workflow (m22). It emits `glrecon.lifecycle`; its payloads carry ids/states/scores/variances
 * (INTEGER MINOR UNITS) only — never GL account numbers, raw source content or float (ADR-007). It NEVER posts a
 * journal, writes to the general ledger, or approves anything; journal recommendations are DRAFT only.
 */

/** A monotonic wall-clock source (epoch ms). Aging math takes this so it is testable. */
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
