/**
 * M34 ports. Two seams:
 *  (1) `ConnectorRegistryPort` — how m34 CONSUMES m33 BY CONTRACT: it checks whether an OPAQUE connector reference maps to
 *      a PUBLISHED m33 connector before a listing is published / an installation is activated. `M33ConnectorRegistryAdapter`
 *      wraps m33's `ConnectorService.getConnector` (read-only; m34 never reads m33 tables and never executes a connector —
 *      that is m33's responsibility). It FAILS CLOSED. Deterministic offline doubles ship for tests.
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

export { DeterministicSecretResolver, UnavailableSecretResolver };
export type { SecretResolver };

/** Availability of an opaque m33 connector reference (published or not). Read-only. */
export interface ConnectorAvailability {
  readonly available: boolean;
  readonly reasonCode: string;
}

/** The seam m34 uses to consume m33's connector registry — a connector is available iff PUBLISHED in m33. Fail closed. */
export interface ConnectorRegistryPort {
  isConnectorAvailable(ctx: RequestContext, connectorRef: string): Promise<ConnectorAvailability>;
}

/** The narrow m33 read contract the adapter needs (structurally satisfied by m33 ConnectorService). */
export type M33ConnectorReader = Pick<ConnectorService, 'getConnector'>;

/** The REAL adapter: consumes m33's `ConnectorService.getConnector` (read-only). m34 never reads m33 tables. */
export class M33ConnectorRegistryAdapter implements ConnectorRegistryPort {
  private readonly connectors: M33ConnectorReader;
  constructor(connectors: M33ConnectorReader) {
    this.connectors = connectors;
  }
  async isConnectorAvailable(ctx: RequestContext, connectorRef: string): Promise<ConnectorAvailability> {
    try {
      const c = await this.connectors.getConnector(ctx, connectorRef);
      return c !== null && c.state === 'published'
        ? { available: true, reasonCode: 'connector_available' }
        : { available: false, reasonCode: 'connector_unavailable' };
    } catch {
      return { available: false, reasonCode: 'connector_unavailable' };
    }
  }
}

/** A DETERMINISTIC offline double: a connector in the known set is available (published); nothing else is (no network). */
export class FixtureConnectorRegistry implements ConnectorRegistryPort {
  private readonly known: ReadonlySet<string>;
  constructor(known: Iterable<string> = []) {
    this.known = new Set(known);
  }
  isConnectorAvailable(_ctx: RequestContext, connectorRef: string): Promise<ConnectorAvailability> {
    return Promise.resolve(
      this.known.has(connectorRef)
        ? { available: true, reasonCode: 'connector_available' }
        : { available: false, reasonCode: 'connector_unavailable' },
    );
  }
}

/** FAIL-CLOSED: used when m33 is not reachable. Never guesses. */
export class UnavailableConnectorRegistry implements ConnectorRegistryPort {
  isConnectorAvailable(): Promise<ConnectorAvailability> {
    return Promise.resolve({ available: false, reasonCode: 'connector_unavailable' });
  }
}
