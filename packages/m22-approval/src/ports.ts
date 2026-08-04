/**
 * Integration ports. M22 reuses the platform's shared engines rather than rebuilding them: authorization via m02,
 * audit via m03, workflow + SLA + deterministic timers + the ONE transactional outbox via m06, and notifications via
 * m08 — all through kernel DI tokens / events / opaque references, never by importing their internals and never by
 * standing up a second workflow, timer or notification engine (CLAUDE.md). The `Clock` port keeps escalation +
 * SLA-driven evidence deterministic and replayable (no ambient `Date.now`), so escalation timeouts are clock-driven
 * and testable. A `timer_ref` is an OPAQUE m06 SLA-timer id, a `workflow_ref` an OPAQUE m06 workflow-instance id, and a
 * `notification_ref` an OPAQUE m08 notification id — m22 records them as evidence but owns none of those engines.
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

/** A fixed clock for deterministic (clock-driven) escalation tests. */
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
