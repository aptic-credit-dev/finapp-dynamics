/**
 * M37 ports. Two seams, deterministic offline doubles for tests (no network, no provider):
 *  (1) `ArtifactRegistryPort` — how m37 CONSUMES m33/m34/m35/m36 BY CONTRACT: before a release is REQUESTED it checks the
 *      OPAQUE (kind, ref) maps to a releasable artifact in its OWNING module (e.g. an m33 connector or an m34 listing that is
 *      PUBLISHED). `ArtifactRegistryAdapter` wraps m33's read-only `ConnectorService.getConnector` and m34's
 *      `ListingService.getListing` (read-only; m37 never reads an m33/m34 table and executes no release — that is the owning
 *      module's runtime responsibility). An `internal` artifact has no external owner and is intrinsically releasable. FAILS
 *      CLOSED (an unknown kind, or a kind with no reader wired, is unavailable — never guessed).
 *  (2) the SECRET-RESOLVER seam is reused from m30 (opaque `secretref:` -> availability metadata only, never a value; real
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

/** Availability of an opaque artifact reference in its owning module (releasable or not). Read-only. */
export interface ArtifactAvailability {
  readonly available: boolean;
  readonly reasonCode: string;
}

/** The seam m37 uses to consume m33/m34/m35/m36 — an artifact is releasable iff PUBLISHED/active in its owner. Fail closed. */
export interface ArtifactRegistryPort {
  isArtifactReleasable(
    ctx: RequestContext,
    artifactKind: string,
    artifactRef: string,
  ): Promise<ArtifactAvailability>;
}

/** The narrow m33 read contract the adapter needs (structurally satisfied by m33 ConnectorService). */
export type M33ConnectorReader = Pick<ConnectorService, 'getConnector'>;
/** The narrow m34 read contract the adapter needs (structurally satisfied by m34 ListingService). */
export type M34MarketplaceReader = Pick<ListingService, 'getListing'>;

const AVAILABLE: ArtifactAvailability = { available: true, reasonCode: 'artifact_available' };
const UNAVAILABLE: ArtifactAvailability = { available: false, reasonCode: 'artifact_unavailable' };

/** The REAL adapter: consumes m33's/m34's read-only lookups. m37 never reads an m33/m34 table. An `internal` artifact has no
 * external owner and is intrinsically releasable. Any kind whose reader is not wired fails closed. */
export class ArtifactRegistryAdapter implements ArtifactRegistryPort {
  private readonly connectors: M33ConnectorReader | null;
  private readonly marketplace: M34MarketplaceReader | null;
  constructor(connectors: M33ConnectorReader | null = null, marketplace: M34MarketplaceReader | null = null) {
    this.connectors = connectors;
    this.marketplace = marketplace;
  }
  async isArtifactReleasable(
    ctx: RequestContext,
    artifactKind: string,
    artifactRef: string,
  ): Promise<ArtifactAvailability> {
    if (artifactKind === 'internal') return AVAILABLE;
    try {
      if (artifactKind === 'connector' && this.connectors !== null) {
        const c = await this.connectors.getConnector(ctx, artifactRef);
        return c !== null && c.state === 'published' ? AVAILABLE : UNAVAILABLE;
      }
      if (artifactKind === 'marketplace' && this.marketplace !== null) {
        const l = await this.marketplace.getListing(ctx, artifactRef);
        return l !== null && l.state === 'published' ? AVAILABLE : UNAVAILABLE;
      }
    } catch {
      return UNAVAILABLE;
    }
    return UNAVAILABLE;
  }
}

/** A DETERMINISTIC offline double: a `${kind}:${ref}` in the known set is releasable; `internal` always is; nothing else. */
export class FixtureArtifactRegistry implements ArtifactRegistryPort {
  private readonly known: ReadonlySet<string>;
  constructor(known: Iterable<string> = []) {
    this.known = new Set(known);
  }
  isArtifactReleasable(
    _ctx: RequestContext,
    artifactKind: string,
    artifactRef: string,
  ): Promise<ArtifactAvailability> {
    if (artifactKind === 'internal') return Promise.resolve(AVAILABLE);
    return Promise.resolve(this.known.has(`${artifactKind}:${artifactRef}`) ? AVAILABLE : UNAVAILABLE);
  }
}

/** FAIL-CLOSED: used when the owning modules are not reachable. Never guesses (an `internal` artifact is still releasable). */
export class UnavailableArtifactRegistry implements ArtifactRegistryPort {
  isArtifactReleasable(_ctx: RequestContext, artifactKind: string): Promise<ArtifactAvailability> {
    return Promise.resolve(artifactKind === 'internal' ? AVAILABLE : UNAVAILABLE);
  }
}
