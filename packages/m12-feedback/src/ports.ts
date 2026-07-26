/**
 * Integration ports (F1/F20/F24/F26/F28). M12 reuses the platform's shared engines rather than rebuilding them:
 * escalation via m08, notifications via m08, documents via m09, workflow via m06, rules via m07 — all reached
 * through EVENTS/CONTRACTS, never by importing their internals. These ports are the explicit seams. m12 ships
 * deterministic test doubles; a deployment wires real adapters. The `Clock` port keeps SLA calculations
 * deterministic and replayable (no ambient `Date.now`).
 */

/** A monotonic wall-clock source (epoch ms). SLA math takes this so it is testable/replayable (ADR-054). */
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

/**
 * A source-system adapter for ingesting feedback-eligible transactions. m12 stores NORMALIZED fields + a safe
 * payload hash/reference — never an unrestricted external payload (F1). Real integrations (ApticOne, AutoBonds,
 * BimaPro, Imarisha, …) are deferred adapters behind this port; m12 ships a deterministic double.
 */
export interface NormalizedTransaction {
  readonly sourceSystem: string;
  readonly externalTransactionId: string;
  readonly transactionType: string;
  readonly product: string;
  readonly productCategory?: string;
  readonly branch?: string;
  readonly department?: string;
  readonly relationshipOfficer?: string;
  readonly transactionDate?: string;
  readonly amountMinor?: number;
  readonly currency?: string;
  readonly customerRef: string;
  readonly transactionStatus?: string;
  readonly payloadHash?: string;
}

export interface SourceSystemAdapter {
  readonly code: string;
  normalize(raw: Readonly<Record<string, unknown>>): NormalizedTransaction;
}
