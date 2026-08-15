/**
 * M41 ports — the DEFERRED crypto/secret provider seam. m41 owns the governed secret/key METADATA + lifecycle, but the actual
 * secret material + cryptography live in a real provider (KMS/HSM/Vault) that is NOT YET APPROVED (OPEN_QUESTIONS #10/#16).
 * `SecretProviderPort` is that seam: it provisions/rotates/destroys/resolves material behind an OPAQUE provider reference and
 * NEVER returns a secret value into application state. The DEFAULT `UnavailableSecretProvider` FAILS CLOSED — every operation is
 * unavailable, so no material is ever fabricated, stored or leaked. A real provider (approved later) drops in behind the port.
 * m41 runs no crypto here, opens no network, and stores no secret value.
 */
import type { RequestContext } from '@finapp/kernel';

export interface ProviderOutcome {
  readonly ok: boolean;
  readonly reasonCode: string;
  /** An OPAQUE provider/key reference — never a secret value, never material. */
  readonly providerRef?: string;
}

export interface ProviderMetadata {
  readonly available: boolean;
  readonly reasonCode: string;
}

/** The seam m41 uses to provision/rotate/destroy/resolve secret material with a real provider. Fail closed. Never a value. */
export interface SecretProviderPort {
  /** Provision new material for a secret/key version; returns an opaque provider reference (never material). */
  provision(
    ctx: RequestContext,
    input: { secretRef: string; algorithm: string | null },
  ): Promise<ProviderOutcome>;
  /** Metadata-only availability of the material behind a provider reference (never returns a value). */
  resolveMetadata(ctx: RequestContext, providerRef: string): Promise<ProviderMetadata>;
  /** Cryptographically destroy the material behind a provider reference (metadata/audit are retained by m41). */
  destroy(ctx: RequestContext, providerRef: string): Promise<ProviderOutcome>;
}

/** FAIL-CLOSED default — no approved provider is wired: every operation is unavailable; no material is ever produced. */
export class UnavailableSecretProvider implements SecretProviderPort {
  provision(): Promise<ProviderOutcome> {
    return Promise.resolve({ ok: false, reasonCode: 'secret_provider_unavailable' });
  }
  resolveMetadata(): Promise<ProviderMetadata> {
    return Promise.resolve({ available: false, reasonCode: 'secret_provider_unavailable' });
  }
  destroy(): Promise<ProviderOutcome> {
    return Promise.resolve({ ok: false, reasonCode: 'secret_provider_unavailable' });
  }
}

/** A DETERMINISTIC offline double for tests ONLY — returns an OPAQUE provider ref, NEVER a secret value; no network, no crypto. */
export class FixtureSecretProvider implements SecretProviderPort {
  provision(): Promise<ProviderOutcome> {
    return Promise.resolve({
      ok: true,
      reasonCode: 'provisioned_fixture',
      providerRef: 'provider:fixture-key',
    });
  }
  resolveMetadata(): Promise<ProviderMetadata> {
    return Promise.resolve({ available: true, reasonCode: 'material_available_fixture' });
  }
  destroy(): Promise<ProviderOutcome> {
    return Promise.resolve({ ok: true, reasonCode: 'destroyed_fixture' });
  }
}
