/**
 * Integration ports (F4/F10/F15/F17/F20/F26). M13 reuses the platform's shared engines rather than rebuilding
 * them: workflow via m06, rules via m07, escalation + notifications via m08, documents + evidence via m09, and
 * the feedback handoff via m12 — all reached through EVENTS/CONTRACTS and these explicit seams, never by importing
 * their internals. m13 ships deterministic test doubles; a deployment wires real adapters. The `Clock` port keeps
 * SLA + deadline calculations deterministic and replayable (no ambient `Date.now`, ADR-058).
 */
import type { RequestContext } from '@finapp/kernel';

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
 * The controlled M12 → M13 handoff seam (F4). M13 never reads m12's tables; it resolves a pending handoff and
 * completes it through this port. A deployment binds it to an adapter over m12's RecordsService; tests bind a
 * deterministic double. The handoff carries SAFE reference fields only — never customer contact details.
 */
export interface FeedbackHandoff {
  readonly handoffId: string;
  readonly feedbackId: string;
  readonly status: string;
  readonly recommendedCaseType: string | null;
  readonly severity: string | null;
  readonly category: string | null;
  readonly product: string | null;
  readonly customerRef: string | null;
  readonly sourceTransactionId: string | null;
}

export interface FeedbackHandoffSource {
  /** Resolve a pending handoff by id under the caller's authority. Returns null if unknown. */
  getHandoff(ctx: RequestContext, handoffId: string): Promise<FeedbackHandoff | null>;
  /** Complete the handoff once the case exists — transitions the feedback to converted_to_case (m12 side). */
  completeHandoff(
    ctx: RequestContext,
    actor: string | null,
    handoffId: string,
    caseRef: string,
  ): Promise<void>;
}

/** A deterministic in-memory handoff source for tests / Framework-Only wiring. */
export class InMemoryHandoffSource implements FeedbackHandoffSource {
  private readonly handoffs = new Map<string, FeedbackHandoff>();
  readonly completed: { handoffId: string; caseRef: string }[] = [];
  seed(h: FeedbackHandoff): void {
    this.handoffs.set(h.handoffId, h);
  }
  getHandoff(_ctx: RequestContext, handoffId: string): Promise<FeedbackHandoff | null> {
    return Promise.resolve(this.handoffs.get(handoffId) ?? null);
  }
  completeHandoff(
    _ctx: RequestContext,
    _actor: string | null,
    handoffId: string,
    caseRef: string,
  ): Promise<void> {
    this.completed.push({ handoffId, caseRef });
    return Promise.resolve();
  }
}

/**
 * An external-system intake adapter (F4). M13 stores NORMALIZED fields + a safe payload hash/reference — never an
 * unrestricted external payload. Real integrations are deferred adapters behind this port; m13 ships a
 * deterministic double.
 */
export interface NormalizedIntake {
  readonly source: string;
  readonly externalReference: string;
  readonly caseTypeCode: string;
  readonly title: string;
  readonly customerRef?: string;
  readonly product?: string;
  readonly branch?: string;
  readonly department?: string;
  readonly payloadHash?: string;
}

export interface IntakeAdapter {
  readonly source: string;
  normalize(raw: Readonly<Record<string, unknown>>): NormalizedIntake;
}
