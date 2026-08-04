/**
 * Integration ports. Because M23 is FRAMEWORK ONLY and no production connector exists, the `DispatchPort` here NEVER
 * calls an external system — the only shipped adapter, `FrameworkOnlyDispatch`, RECORDS a dispatch intent and returns a
 * Framework-Only marker (ADR-096). A real connector is deferred behind this port until proven against a real system
 * with confirmed posting contracts (CLAUDE.md: never claim untested integrations are production-ready). There is NO
 * network, HTTP, socket or SSRF surface in this module. The `Clock` port keeps retry/backoff evidence deterministic
 * and replayable (no ambient `Date.now`).
 */

export interface Clock {
  now(): number;
}
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}
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

/** The outcome of a (Framework-Only) dispatch — intent recorded, NO external call performed. */
export interface DispatchOutcome {
  readonly dispatched: boolean;
  /** Always true in the MVP; typed `boolean` so the service's fail-closed guard against a non-Framework-Only adapter is live. */
  readonly frameworkOnly: boolean;
  readonly reasonCode: string;
}

/** A port a real connector would implement post-MVP. The MVP ships ONLY the Framework-Only adapter. */
export interface DispatchPort {
  dispatch(input: {
    executionId: string;
    destinationType: string;
    approvalRef: string;
  }): Promise<DispatchOutcome>;
}

/**
 * The ONLY dispatch adapter in the MVP. It performs NO external call — it returns a Framework-Only marker so the
 * execution can record a `dispatched` attempt as evidence. It is impossible to make this adapter reach a network.
 */
export class FrameworkOnlyDispatch implements DispatchPort {
  async dispatch(_input: {
    executionId: string;
    destinationType: string;
    approvalRef: string;
  }): Promise<DispatchOutcome> {
    // FRAMEWORK ONLY: the input is intentionally ignored — no external request is made; intent is recorded only.
    await Promise.resolve();
    return { dispatched: true, frameworkOnly: true, reasonCode: 'dispatched_framework_only' };
  }
}
