/**
 * Integration ports. M17 reuses the platform's shared engines rather than rebuilding them: workflow via m06,
 * rules via m07, escalation + notifications via m08, documents via m09 — all reached through EVENTS/CONTRACTS,
 * never by importing their internals. The `Clock` port keeps SLA + deadline calculations deterministic and
 * replayable (no ambient `Date.now`, ADR-070).
 *
 * The M16 → M17 enforcement referral is a GOVERNED INBOUND CONTRACT and one-directional: a caller refers an M16
 * proceeding's enforceable outcome to recovery through `/recovery/from-proceeding` carrying only SAFE reference
 * fields (proceeding id + optional matter id + instrument metadata). M17 creates exactly one recovery per referral
 * (idempotent), preserves the ids + correlation/causation, and signals completion by emitting
 * `RecoveryReferredFromProceeding` on `recovery.lifecycle`. M17 NEVER reads M16- or M14-owned tables and holds no
 * proceeding/matter table — the ids are opaque references (ADR-069). ALL amounts are references only: m17 performs
 * no cash application, no ledger posting, no accounting write-off (ADR-071).
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
 * The SAFE reference fields carried across the M16 → M17 enforcement-referral boundary — never proceeding/matter
 * narratives or debtor contacts. `referralKey` is the idempotency key: exactly ONE recovery is created per referral
 * key, but a single proceeding may produce several enforcement referrals, so the key — not the proceeding id — is
 * unique.
 */
export interface EnforcementReferral {
  readonly referralKey: string;
  readonly sourceProceedingId: string;
  readonly recoveryTypeCode: string;
  readonly title: string;
  readonly sourceMatterId?: string;
  readonly instrumentType?: string;
  readonly principalAmountMinor?: number;
  readonly currency?: string;
  readonly jurisdiction?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
}

/**
 * An external-system intake adapter. M17 stores NORMALIZED fields + a safe payload hash/reference — never an
 * unrestricted external payload. Real integrations are deferred adapters behind this port; m17 ships a
 * deterministic double.
 */
export interface NormalizedRecoveryIntake {
  readonly source: string;
  readonly externalReference: string;
  readonly recoveryTypeCode: string;
  readonly title: string;
  readonly instrumentType?: string;
  readonly jurisdiction?: string;
  readonly payloadHash?: string;
}

export interface RecoveryIntakeAdapter {
  readonly source: string;
  normalize(raw: Readonly<Record<string, unknown>>): NormalizedRecoveryIntake;
}
