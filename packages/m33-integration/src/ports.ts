/**
 * M33 ports. Three seams:
 *  (1) `M33IntegrationCapabilityCatalog` IMPLEMENTS m31's `IntegrationCapabilityCatalogPort` — the studio deferred port
 *      resolves HERE: a capability reference is available iff it maps to a PUBLISHED connector capability. m31 is the
 *      consumer; m33 provides the real implementation (its historical ports/fixtures are unchanged).
 *  (2) `ConnectorRuntimePort` — the FRAMEWORK-ONLY connector runtime seam. Only deterministic offline doubles ship
 *      (`FrameworkConnectorRuntime`); the FAIL-CLOSED `UnavailableConnectorRuntime` refuses when no real runtime is bound.
 *      There is NO production network egress, NO real provider call — connectors are Framework Only / Sandbox Ready until
 *      proven (CLAUDE.md).
 *  (3) the SECRET-RESOLVER seam is reused from m30 (opaque `secretref:` -> availability metadata only, never a value;
 *      real backend = m41-security), re-exported for convenience.
 */
import type { RequestContext } from '@finapp/kernel';
import type { IntegrationCapabilityCatalogPort, IntegrationCapability } from '@finapp/m31-studio';
import {
  DeterministicSecretResolver,
  UnavailableSecretResolver,
  type SecretResolver,
} from '@finapp/m30-platform';

export { DeterministicSecretResolver, UnavailableSecretResolver };
export type { SecretResolver, IntegrationCapability };

/** The governed provider m33 uses to answer m31's capability catalog (a published capability is available). */
export interface CapabilityAvailabilityProvider {
  isCapabilityAvailable(ctx: RequestContext, capabilityRef: string): Promise<IntegrationCapability>;
}

/** The REAL implementation of m31's deferred `IntegrationCapabilityCatalogPort`. Read-only; delegates to the provider. */
export class M33IntegrationCapabilityCatalog implements IntegrationCapabilityCatalogPort {
  private readonly provider: CapabilityAvailabilityProvider;
  constructor(provider: CapabilityAvailabilityProvider) {
    this.provider = provider;
  }
  getCapability(ctx: RequestContext, capabilityRef: string): Promise<IntegrationCapability> {
    return this.provider.isCapabilityAvailable(ctx, capabilityRef);
  }
}

/** A framework-only connector run request (declarative; no executable). */
export interface ConnectorRunInput {
  readonly connectorKey: string;
  readonly capabilityKey: string;
  readonly direction: string;
  readonly connectionId: string;
}
/** The result of a framework-only run. `rowCount` is a count, never data; there is no external payload. */
export interface ConnectorRunResult {
  readonly status: 'succeeded' | 'failed';
  readonly rowCount: number;
  readonly reasonCode: string;
}

/** The FRAMEWORK-ONLY connector runtime seam. Deterministic offline doubles only — no network, no real provider call. */
export interface ConnectorRuntimePort {
  readonly kind: string;
  execute(ctx: RequestContext, input: ConnectorRunInput): Promise<ConnectorRunResult>;
}

/** A DETERMINISTIC offline double: a run "succeeds" with a fixed count, offline (no network, no provider). */
export class FrameworkConnectorRuntime implements ConnectorRuntimePort {
  readonly kind = 'framework';
  private readonly rows: (input: ConnectorRunInput) => number;
  constructor(rows: (input: ConnectorRunInput) => number = () => 0) {
    this.rows = rows;
  }
  execute(_ctx: RequestContext, input: ConnectorRunInput): Promise<ConnectorRunResult> {
    return Promise.resolve({ status: 'succeeded', rowCount: this.rows(input), reasonCode: 'framework_only' });
  }
}

/** FAIL-CLOSED: used when no real connector runtime (m34+/production credentials) is bound. Never calls out; never guesses. */
export class UnavailableConnectorRuntime implements ConnectorRuntimePort {
  readonly kind = 'unavailable';
  execute(): Promise<ConnectorRunResult> {
    return Promise.resolve({ status: 'failed', rowCount: 0, reasonCode: 'connector_runtime_unavailable' });
  }
}
