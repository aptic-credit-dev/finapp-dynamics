/**
 * M39 ports — two fail-closed seams, deterministic offline doubles for tests (no network, no provider):
 *
 *  (1) `FeatureControlPort` — how m39 consults m30's feature-flag/absolute-control engine for the effective-access stack. m39
 *      owns NO flag engine; m30 is authoritative. The DEFAULT `UnavailableFeatureControl` FAILS CLOSED — a feature is treated
 *      as NOT enabled (deny), never guessed as enabled. The real adapter wraps m30's `PlatformFeatureService.isFeatureEnabled`.
 *
 *  (2) `BillingProviderPort` — how m39 would settle a billing cycle with an external payment/invoicing PROVIDER. Per
 *      OPEN_QUESTIONS #2 the real provider is DEFERRED (billing is modelled internally); the DEFAULT
 *      `UnavailableBillingProvider` FAILS CLOSED — no external collection, a provider reference is never fabricated.
 *
 * m39 never executes arbitrary code, opens no network connection, and creates no payment here.
 */
import type { RequestContext } from '@finapp/kernel';

export interface FeatureDecision {
  readonly enabled: boolean;
  readonly absoluteBlocked: boolean;
}

/** The seam m39 uses to consult m30 for the FEATURE/ABSOLUTE leg of the access stack. Fail closed. */
export interface FeatureControlPort {
  evaluateFeature(ctx: RequestContext, capabilityKey: string): Promise<FeatureDecision>;
}

/** FAIL-CLOSED default — m30 is not wired: a feature is treated as NOT enabled (deny), never guessed. */
export class UnavailableFeatureControl implements FeatureControlPort {
  evaluateFeature(): Promise<FeatureDecision> {
    return Promise.resolve({ enabled: false, absoluteBlocked: false });
  }
}

/** A DETERMINISTIC offline double for tests: enabled (or blocked) by construction. */
export class FixtureFeatureControl implements FeatureControlPort {
  private readonly enabled: boolean;
  private readonly absolute: boolean;
  constructor(opts?: { enabled?: boolean; absoluteBlocked?: boolean }) {
    this.enabled = opts?.enabled ?? true;
    this.absolute = opts?.absoluteBlocked ?? false;
  }
  evaluateFeature(): Promise<FeatureDecision> {
    return Promise.resolve({ enabled: this.enabled, absoluteBlocked: this.absolute });
  }
}

export interface BillingSettlement {
  readonly settled: boolean;
  readonly reasonCode: string;
}

/** The seam m39 would use to settle a billing cycle with an external provider. Deferred (OPEN_QUESTIONS #2). Fail closed. */
export interface BillingProviderPort {
  settleCycle(
    ctx: RequestContext,
    input: { subscriptionId: string; amountMinor: bigint | number; currency: string },
  ): Promise<BillingSettlement>;
}

/** FAIL-CLOSED default — no real provider: nothing is collected externally; billing is modelled internally only. */
export class UnavailableBillingProvider implements BillingProviderPort {
  settleCycle(): Promise<BillingSettlement> {
    return Promise.resolve({ settled: false, reasonCode: 'billing_provider_unavailable' });
  }
}

/** A DETERMINISTIC offline double for tests only — never a real payment. */
export class FixtureBillingProvider implements BillingProviderPort {
  settleCycle(): Promise<BillingSettlement> {
    return Promise.resolve({ settled: true, reasonCode: 'settled_fixture' });
  }
}
