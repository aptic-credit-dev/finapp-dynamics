/**
 * Integration ports. M18 reuses the platform's shared engines rather than rebuilding them: workflow via m06,
 * rules via m07, escalation + notifications via m08, documents via m09 — all reached through EVENTS/CONTRACTS,
 * never by importing their internals. The `Clock` port keeps review/expiry/deadline calculations deterministic
 * and replayable (no ambient `Date.now`, ADR-074).
 *
 * M18 is a LEGAL KNOWLEDGE module: it OWNS no storage (document bytes live in m09) and no case/matter/proceeding/
 * recovery lifecycle. It REFERENCES m09 documents, m14 matters, m16 litigation proceedings and m17 recoveries
 * through OPAQUE ids carried on a `CrossModuleRef` — it never reads those modules' private tables and imposes no
 * lifecycle coupling (ADR-075). A reference's `refType` records which module the target id belongs to; the tenant
 * guarantees isolation via RLS.
 */

/** A monotonic wall-clock source (epoch ms). Review/expiry/deadline math take this so they are testable/replayable. */
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

/** A safe reference from a knowledge record to another module's object — an OPAQUE id + its module type. */
export interface CrossModuleRef {
  readonly refType: string; // 'document' (m09) | 'matter' (m14) | 'litigation' (m16) | 'recovery' (m17) | 'authority' | 'precedent' | 'external'
  readonly targetId: string;
  readonly label?: string;
}

/**
 * An external-system knowledge intake adapter. M18 stores NORMALIZED fields + a safe payload hash/reference —
 * never an unrestricted external payload. Real integrations (legal-research vendors) are deferred adapters behind
 * this port; m18 ships a deterministic double and NO production legal-research vendor integration.
 */
export interface NormalizedKnowledgeIntake {
  readonly source: string;
  readonly externalReference: string;
  readonly knowledgeType: string;
  readonly title: string;
  readonly jurisdiction?: string;
  readonly practiceArea?: string;
  readonly payloadHash?: string;
}

export interface KnowledgeIntakeAdapter {
  readonly source: string;
  normalize(raw: Readonly<Record<string, unknown>>): NormalizedKnowledgeIntake;
}
