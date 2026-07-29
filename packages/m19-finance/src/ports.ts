/**
 * Integration ports. M19 reuses the platform's shared engines rather than rebuilding them: authorization via m02,
 * audit via m03, workflow + the ONE transactional outbox via m06 — all through kernel DI tokens and events, never
 * by importing their internals. The `Clock` port keeps effective-dating (period boundaries, FX rate dates, tax
 * effective dates, config publication) deterministic and replayable (no ambient `Date.now`).
 *
 * M19 is the finance FOUNDATION / reference-data layer. It OWNS no journals, no postings, no reconciliation and no
 * approval workflow (m21/m15/m20/m22). It emits `finance.lifecycle` (period open/close/lock, account/currency/
 * config lifecycle) so downstream posting (m21) can honour "no posting into a closed period" — but it never posts
 * a ledger entry itself, and its payloads never carry monetary amounts, balances or float (ADR-007).
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
