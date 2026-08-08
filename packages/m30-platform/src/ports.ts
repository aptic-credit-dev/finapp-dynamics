/**
 * M30 ports. THE SECRET-RESOLVER PORT is the seam where real secret/key management (m41-security) plugs in later — M30
 * itself NEVER resolves or returns a secret VALUE. The port exposes only availability/metadata about an opaque
 * `secretref:` pointer; it FAILS CLOSED when no resolver is bound. Only DETERMINISTIC offline doubles ship (no
 * production secrets adapter, no network). The public READ ports (config resolve / feature evaluate) are the contract
 * other modules consume — they return values/enabled-state and, for secret-bearing config, the opaque REFERENCE only,
 * never a resolved secret value.
 */
import type { RequestContext } from '@finapp/kernel';
import { isSecretReference } from './domain.ts';

/** Metadata-only resolution of an opaque secret reference. NEVER returns a secret value (m41 owns real resolution). */
export interface SecretResolver {
  readonly kind: string;
  resolveMetadata(
    ctx: RequestContext,
    secretRef: string,
  ): Promise<{ available: boolean; reasonCode: string }>;
}

/** The deterministic offline double: a well-formed `secretref:` is "available" (metadata only); no value, no network. */
export class DeterministicSecretResolver implements SecretResolver {
  readonly kind = 'deterministic';
  resolveMetadata(
    _ctx: RequestContext,
    secretRef: string,
  ): Promise<{ available: boolean; reasonCode: string }> {
    return Promise.resolve(
      isSecretReference(secretRef)
        ? { available: true, reasonCode: 'secret_reference_resolvable' }
        : { available: false, reasonCode: 'invalid_secret_reference' },
    );
  }
}

/** The FAIL-CLOSED resolver: used when no real secret backend (m41) is bound. Never resolves; never returns a value. */
export class UnavailableSecretResolver implements SecretResolver {
  readonly kind = 'unavailable';
  resolveMetadata(): Promise<{ available: boolean; reasonCode: string }> {
    return Promise.resolve({ available: false, reasonCode: 'secret_unavailable' });
  }
}

/** A resolved config value for a consumer. A secret-bearing setting yields the opaque REFERENCE only, never a value. */
export interface ResolvedConfig {
  readonly found: boolean;
  readonly valueType: string | null;
  readonly secretBearing: boolean;
  readonly value: unknown;
  readonly secretRef: string | null;
}

/** The public config read contract other modules consume (opaque ids; never a resolved secret value). */
export interface PlatformConfigResolvePort {
  resolveConfig(ctx: RequestContext, input: { scope: string; configKey: string }): Promise<ResolvedConfig>;
}

/** The public feature-evaluation contract other modules consume. A flag is NEVER an authorization substitute. */
export interface PlatformFeatureEvaluatePort {
  isFeatureEnabled(ctx: RequestContext, input: { scope: string; featureKey: string }): Promise<boolean>;
}
