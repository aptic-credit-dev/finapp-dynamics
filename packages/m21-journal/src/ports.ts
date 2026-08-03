/**
 * Integration ports. M21 reuses the platform's shared engines rather than rebuilding them: authorization via m02,
 * audit via m03, workflow + the ONE transactional outbox via m06, the finance foundation via m19 (opaque entity/
 * period/account/currency refs), the reconciliation handoff via m20 (opaque source/handoff refs) — all through
 * kernel DI tokens / events / opaque references, never by importing their internals. The `Clock` port keeps any
 * time-derived evidence deterministic and replayable (no ambient `Date.now`).
 *
 * M21 is the journal engine (DRAFT-first MVP). It OWNS no chart of accounts / fiscal periods (m19), no GL
 * reconciliation (m20), no approval workflow (m22) and no integration/posting push (m23/m33). It emits
 * `journal.lifecycle` + `posting_request.lifecycle`; payloads carry ids/states/totals (INTEGER MINOR UNITS as
 * strings)/reason-codes/dates only — never account numbers, line narratives or float (ADR-007). It NEVER approves
 * a journal, posts to a ledger/ERP/core system, or auto-posts; posting is deferred.
 */

/** A monotonic wall-clock source (epoch ms). Any time-derived math takes this so it is testable. */
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
