/**
 * M35 ports — three fail-closed seams, all deterministic offline doubles for tests (no network, no provider):
 *  (1) `CatalogSourcePort` — how m35 CONSUMES m34/m33 BY CONTRACT: before a product that surfaces a marketplace listing
 *      (m34) or a connector (m33) is PUBLISHED, it checks the OPAQUE source reference maps to a PUBLISHED upstream record.
 *      `CatalogSourceAdapter` wraps m34's read-only `ListingService.getListing` and/or m33's `ConnectorService.getConnector`
 *      (read-only; m35 never reads an m33/m34 table and owns no connector/marketplace engine). An `internal` product has no
 *      external source and is intrinsically available. FAILS CLOSED.
 *  (2) `UsageQuotaPort` — how m35 CONSUMES m39-saas (SaaS entitlements/quotas/usage metering) BY CONTRACT for PUBLIC
 *      exposure. m39 is UNBUILT, so the default binding is `UnavailableUsageQuota` — public subscription approval FAILS
 *      CLOSED (denied) until m39 is built. m35 owns NO quota/metering engine.
 *  (3) the SECRET-RESOLVER seam is reused from m30 (opaque `secretref:` -> availability metadata only, never a value; real
 *      backend = m41-security), re-exported for convenience.
 */
import type { RequestContext } from '@finapp/kernel';
import {
  DeterministicSecretResolver,
  UnavailableSecretResolver,
  type SecretResolver,
} from '@finapp/m30-platform';
import type { ConnectorService } from '@finapp/m33-integration';
import type { ListingService } from '@finapp/m34-marketplace';

export { DeterministicSecretResolver, UnavailableSecretResolver };
export type { SecretResolver };

/** Availability of an opaque upstream source reference (published or not). Read-only. */
export interface SourceAvailability {
  readonly available: boolean;
  readonly reasonCode: string;
}

/** The seam m35 uses to consume m34/m33 — a source is publishable iff its upstream record is PUBLISHED. Fail closed. */
export interface CatalogSourcePort {
  isSourcePublishable(
    ctx: RequestContext,
    sourceKind: string,
    sourceRef: string,
  ): Promise<SourceAvailability>;
}

/** The narrow m34 read contract the adapter needs (structurally satisfied by m34 ListingService). */
export type M34MarketplaceReader = Pick<ListingService, 'getListing'>;
/** The narrow m33 read contract the adapter needs (structurally satisfied by m33 ConnectorService). */
export type M33ConnectorReader = Pick<ConnectorService, 'getConnector'>;

const AVAILABLE: SourceAvailability = { available: true, reasonCode: 'source_available' };
const UNAVAILABLE: SourceAvailability = { available: false, reasonCode: 'source_unavailable' };

/** The REAL adapter: consumes m34's/m33's read-only lookups. m35 never reads an m33/m34 table. An `internal` product has
 * no external source and is intrinsically available. Anything else fails closed. */
export class CatalogSourceAdapter implements CatalogSourcePort {
  private readonly marketplace: M34MarketplaceReader | null;
  private readonly connectors: M33ConnectorReader | null;
  constructor(marketplace: M34MarketplaceReader | null = null, connectors: M33ConnectorReader | null = null) {
    this.marketplace = marketplace;
    this.connectors = connectors;
  }
  async isSourcePublishable(
    ctx: RequestContext,
    sourceKind: string,
    sourceRef: string,
  ): Promise<SourceAvailability> {
    if (sourceKind === 'internal') return AVAILABLE;
    try {
      if (sourceKind === 'marketplace' && this.marketplace !== null) {
        const l = await this.marketplace.getListing(ctx, sourceRef);
        return l !== null && l.state === 'published' ? AVAILABLE : UNAVAILABLE;
      }
      if (sourceKind === 'connector' && this.connectors !== null) {
        const c = await this.connectors.getConnector(ctx, sourceRef);
        return c !== null && c.state === 'published' ? AVAILABLE : UNAVAILABLE;
      }
    } catch {
      return UNAVAILABLE;
    }
    return UNAVAILABLE;
  }
}

/** A DETERMINISTIC offline double: a `${kind}:${ref}` in the known set is publishable; `internal` always is; nothing else. */
export class FixtureSourceCatalog implements CatalogSourcePort {
  private readonly known: ReadonlySet<string>;
  constructor(known: Iterable<string> = []) {
    this.known = new Set(known);
  }
  isSourcePublishable(
    _ctx: RequestContext,
    sourceKind: string,
    sourceRef: string,
  ): Promise<SourceAvailability> {
    if (sourceKind === 'internal') return Promise.resolve(AVAILABLE);
    return Promise.resolve(this.known.has(`${sourceKind}:${sourceRef}`) ? AVAILABLE : UNAVAILABLE);
  }
}

/** FAIL-CLOSED: used when m33/m34 are not reachable. Never guesses (an `internal` product is still intrinsically available). */
export class UnavailableSourceCatalog implements CatalogSourcePort {
  isSourcePublishable(_ctx: RequestContext, sourceKind: string): Promise<SourceAvailability> {
    return Promise.resolve(sourceKind === 'internal' ? AVAILABLE : UNAVAILABLE);
  }
}

/** A public-exposure quota decision from m39-saas (entitlements/quotas). Read-only. */
export interface QuotaDecision {
  readonly allowed: boolean;
  readonly reasonCode: string;
}

/** The seam m35 uses to consume m39-saas for PUBLIC exposure. m35 owns no quota/metering engine. Fail closed. */
export interface UsageQuotaPort {
  checkSubscriptionQuota(
    ctx: RequestContext,
    input: { appRef: string; productRef: string; visibility: string },
  ): Promise<QuotaDecision>;
}

/** A DETERMINISTIC offline double: allows (or denies) by construction. For tests only — m39 is not built. */
export class FixtureUsageQuota implements UsageQuotaPort {
  private readonly allow: boolean;
  constructor(allow = true) {
    this.allow = allow;
  }
  checkSubscriptionQuota(): Promise<QuotaDecision> {
    return Promise.resolve(
      this.allow
        ? { allowed: true, reasonCode: 'quota_available' }
        : { allowed: false, reasonCode: 'quota_denied' },
    );
  }
}

/** FAIL-CLOSED: the DEFAULT binding while m39-saas is unbuilt — a public subscription is DENIED, never guessed. */
export class UnavailableUsageQuota implements UsageQuotaPort {
  checkSubscriptionQuota(): Promise<QuotaDecision> {
    return Promise.resolve({ allowed: false, reasonCode: 'quota_unavailable' });
  }
}
