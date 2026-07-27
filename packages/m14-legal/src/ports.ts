/**
 * Integration ports (G2/G16/G18/G21). M14 reuses the platform's shared engines rather than rebuilding them:
 * workflow via m06, rules via m07, escalation + notifications via m08, documents/evidence via m09 — all reached
 * through EVENTS/CONTRACTS, never by importing their internals. The `Clock` port keeps SLA + deadline + limitation
 * calculations deterministic and replayable (no ambient `Date.now`, ADR-062).
 *
 * The M13 → M14 conversion is EVENT-DRIVEN and one-directional: m13 emits `case.converted_to_matter`
 * (fire-and-forget); m14 CONSUMES it, creates exactly one matter per source case (idempotent), and signals
 * completion by emitting `MatterConvertedFromCase` on `legal.lifecycle`. m14 never reads m13-owned tables and
 * needs no callback into m13, so there is no handoff-source port here — only the intake shape.
 */

/** A monotonic wall-clock source (epoch ms). SLA + deadline math take this so they are testable/replayable. */
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

/** The SAFE reference fields carried across the M13 → M14 conversion boundary — never case narratives/contacts. */
export interface CaseConversion {
  readonly sourceCaseId: string;
  readonly matterTypeCode: string;
  readonly title: string;
  readonly recommendedMatterType?: string;
  readonly legalStatus?: string;
  readonly courtReference?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
}

/**
 * An external-system intake adapter (G2). M14 stores NORMALIZED fields + a safe payload hash/reference — never an
 * unrestricted external payload. Real integrations are deferred adapters behind this port; m14 ships a
 * deterministic double.
 */
export interface NormalizedIntake {
  readonly source: string;
  readonly externalReference: string;
  readonly matterTypeCode: string;
  readonly title: string;
  readonly jurisdiction?: string;
  readonly branch?: string;
  readonly department?: string;
  readonly payloadHash?: string;
}

export interface IntakeAdapter {
  readonly source: string;
  normalize(raw: Readonly<Record<string, unknown>>): NormalizedIntake;
}
