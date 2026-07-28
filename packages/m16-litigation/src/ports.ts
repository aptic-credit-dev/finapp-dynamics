/**
 * Integration ports. M16 reuses the platform's shared engines rather than rebuilding them: workflow via m06,
 * rules via m07, escalation + notifications via m08, documents/evidence/bundles via m09 — all reached through
 * EVENTS/CONTRACTS, never by importing their internals. The `Clock` port keeps SLA + deadline + limitation
 * calculations deterministic and replayable (no ambient `Date.now`, ADR-066).
 *
 * The M14 → M16 referral is a GOVERNED INBOUND CONTRACT and one-directional: a caller refers an M14 legal matter
 * to litigation through `/litigation/from-matter` carrying only SAFE reference fields (matter id + metadata). M16
 * creates exactly one proceeding per referral (idempotent), preserves the matter id + correlation/causation, and
 * signals completion by emitting `ProceedingReferredFromMatter` on `litigation.lifecycle`. M16 NEVER reads
 * M14-owned tables and holds no matter table — the matter id is an opaque reference (ADR-065).
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

/**
 * The SAFE reference fields carried across the M14 → M16 referral boundary — never matter narratives/contacts.
 * `referralKey` is the idempotency key: exactly ONE proceeding is created per referral key, but a single matter
 * may be referred several times (several proceedings), so the key — not the matter id — is unique.
 */
export interface MatterReferral {
  readonly referralKey: string;
  readonly sourceMatterId: string;
  readonly proceedingTypeCode: string;
  readonly title: string;
  readonly forum?: string;
  readonly jurisdiction?: string;
  readonly organizationRole?: string;
  readonly externalCaseNumber?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
}

/**
 * An external-system intake adapter. M16 stores NORMALIZED fields + a safe payload hash/reference — never an
 * unrestricted external payload. Real integrations are deferred adapters behind this port; m16 ships a
 * deterministic double.
 */
export interface NormalizedProceedingIntake {
  readonly source: string;
  readonly externalReference: string;
  readonly proceedingTypeCode: string;
  readonly title: string;
  readonly forum?: string;
  readonly jurisdiction?: string;
  readonly payloadHash?: string;
}

export interface ProceedingIntakeAdapter {
  readonly source: string;
  normalize(raw: Readonly<Record<string, unknown>>): NormalizedProceedingIntake;
}
