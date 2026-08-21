/**
 * OpenBao secret provider — the REAL backend adapter behind M41's fail-closed `SecretProviderPort` (ADR-132).
 *
 * It provisions / resolves / destroys secret MATERIAL inside a self-hosted OpenBao (Vault-API-compatible) using the
 * **transit** engine, so the key material NEVER leaves the vault and NEVER enters application state: every method
 * returns an OPAQUE provider reference (a `transit` key path + version), never a secret value. It authenticates with
 * a machine identity (AppRole) — no static long-lived token by default — over TLS with CA verification.
 *
 * FAIL CLOSED IS ABSOLUTE: every method wraps all I/O and returns the SAME shape the default `UnavailableSecretProvider`
 * returns on ANY error (unreachable host, TLS failure, auth failure, non-2xx, malformed body, timeout). A method here
 * never throws and never returns a partial success. Errors are reduced to a reason code + a safe status category —
 * response bodies and tokens are NEVER logged, returned, or embedded (they can carry material).
 *
 * This module opens a network connection ONLY when an OpenBao instance is explicitly configured
 * (`loadOpenBaoConfigFromEnv` returns null otherwise, so the composition root keeps the fail-closed default). It runs
 * no home-grown crypto (all crypto is OpenBao transit), stores no secret value, and adds no secret-value column.
 */
import type { RequestContext } from '@finapp/kernel';
import type { ProviderMetadata, ProviderOutcome, SecretProviderPort } from '../ports.ts';

/** Reason codes this adapter emits. Failure ALWAYS collapses to `secret_provider_unavailable` (fail-closed parity). */
const UNAVAILABLE = 'secret_provider_unavailable' as const;

/** A minimal HTTP transport so the adapter is testable with an in-process mock (no real network in tests). */
export interface OpenBaoTransport {
  request(input: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string; // absolute path beginning with /v1/...
    token?: string; // vault token header; omitted for the login call
    body?: unknown; // JSON-serialisable request body
  }): Promise<{ status: number; body: unknown }>;
}

export interface OpenBaoAuthApprole {
  readonly method: 'approle';
  readonly roleId: string;
  readonly secretId: string;
}
export interface OpenBaoAuthToken {
  readonly method: 'token';
  readonly token: string;
}
export type OpenBaoAuth = OpenBaoAuthApprole | OpenBaoAuthToken;

export interface OpenBaoConfig {
  /** e.g. https://vault.internal:8200 — the private-network address (no public listener). */
  readonly address: string;
  /** Optional OpenBao/Vault namespace header. */
  readonly namespace?: string;
  /** PEM CA bundle used to verify the server certificate. Strongly recommended. */
  readonly caCertPem?: string;
  /** Disables TLS verification. Default false; NEVER true in production. */
  readonly tlsSkipVerify: boolean;
  readonly auth: OpenBaoAuth;
  /** transit mount path (default `transit`). */
  readonly transitMount: string;
  /** Prefix for the per-secret transit key name (default `finapp-`). */
  readonly transitKeyPrefix: string;
  /** Per-request timeout (ms). */
  readonly requestTimeoutMs: number;
}

/** An opaque provider ref this adapter mints/parses: `openbao:transit:<key>#v<version>`. Never material. */
function makeProviderRef(key: string, version: number): string {
  return `openbao:transit:${key}#v${version}`;
}
function parseProviderRef(ref: string): { key: string; version: number } | null {
  const m = /^openbao:transit:([^#]+)#v(\d+)$/.exec(ref);
  const key = m?.[1];
  const version = m?.[2];
  if (key === undefined || version === undefined) return null;
  return { key, version: Number(version) };
}

/** Vault key names allow [A-Za-z0-9_-]; derive a safe, stable per-secret key name from the secretRef. */
function keyNameFor(prefix: string, secretRef: string): string {
  const safe = secretRef.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200);
  return `${prefix}${safe}`;
}

/** Map an M41 approved-algorithm hint to a transit key type; default to an authenticated AEAD cipher. */
function transitKeyType(algorithm: string | null): string {
  switch (algorithm) {
    case 'ed25519':
      return 'ed25519';
    case 'ecdsa-p256':
      return 'ecdsa-p256';
    case 'rsa-2048':
      return 'rsa-2048';
    case 'rsa-4096':
      return 'rsa-4096';
    default:
      return 'aes256-gcm96';
  }
}

interface TokenCache {
  token: string;
  expiresAtMs: number;
}

export class OpenBaoSecretProvider implements SecretProviderPort {
  private readonly cfg: OpenBaoConfig;
  private readonly transport: OpenBaoTransport;
  private tokenCache: TokenCache | null = null;
  /** Injected clock so tests are deterministic; defaults to Date.now at call time via a thunk. */
  private readonly now: () => number;

  constructor(cfg: OpenBaoConfig, transport?: OpenBaoTransport, now?: () => number) {
    this.cfg = cfg;
    this.transport = transport ?? new NodeOpenBaoTransport(cfg);
    this.now = now ?? ((): number => Date.now());
  }

  async provision(
    _ctx: RequestContext,
    input: { secretRef: string; algorithm: string | null },
  ): Promise<ProviderOutcome> {
    return this.guard(async () => {
      const token = await this.authToken();
      const key = keyNameFor(this.cfg.transitKeyPrefix, input.secretRef);
      const base = `/v1/${this.cfg.transitMount}/keys/${encodeURIComponent(key)}`;
      // Ensure the transit key exists (idempotent create). A 400 "existing key" is fine.
      const read = await this.transport.request({ method: 'GET', path: base, token });
      if (read.status === 404) {
        const created = await this.transport.request({
          method: 'POST',
          path: base,
          token,
          body: { type: transitKeyType(input.algorithm) },
        });
        if (created.status < 200 || created.status >= 300) return this.fail();
      } else if (read.status < 200 || read.status >= 300) {
        return this.fail();
      }
      const after = await this.transport.request({ method: 'GET', path: base, token });
      if (after.status < 200 || after.status >= 300) return this.fail();
      const version = latestVersion(after.body);
      if (version === null) return this.fail();
      return { ok: true, reasonCode: 'provisioned', providerRef: makeProviderRef(key, version) };
    });
  }

  async resolveMetadata(_ctx: RequestContext, providerRef: string): Promise<ProviderMetadata> {
    try {
      const parsed = parseProviderRef(providerRef);
      if (parsed === null) return { available: false, reasonCode: UNAVAILABLE };
      const token = await this.authToken();
      const res = await this.transport.request({
        method: 'GET',
        path: `/v1/${this.cfg.transitMount}/keys/${encodeURIComponent(parsed.key)}`,
        token,
      });
      if (res.status < 200 || res.status >= 300) return { available: false, reasonCode: UNAVAILABLE };
      const version = latestVersion(res.body);
      const minDecrypt = minDecryptionVersion(res.body);
      const usable = version !== null && parsed.version <= version && parsed.version >= minDecrypt;
      return usable
        ? { available: true, reasonCode: 'material_available' }
        : { available: false, reasonCode: UNAVAILABLE };
    } catch {
      return { available: false, reasonCode: UNAVAILABLE };
    }
  }

  async destroy(_ctx: RequestContext, providerRef: string): Promise<ProviderOutcome> {
    return this.guard(async () => {
      const parsed = parseProviderRef(providerRef);
      if (parsed === null) return this.fail();
      const token = await this.authToken();
      const base = `/v1/${this.cfg.transitMount}/keys/${encodeURIComponent(parsed.key)}`;
      // Crypto-erase: allow deletion, then delete the key (all versions). Metadata/audit are retained by M41.
      const cfgRes = await this.transport.request({
        method: 'POST',
        path: `${base}/config`,
        token,
        body: { deletion_allowed: true },
      });
      if (cfgRes.status < 200 || cfgRes.status >= 300) return this.fail();
      const del = await this.transport.request({ method: 'DELETE', path: base, token });
      if (del.status < 200 || del.status >= 300) return this.fail();
      return { ok: true, reasonCode: 'destroyed' };
    });
  }

  /** Authenticate (cached). AppRole login exchanges role/secret ids for a short-TTL token; token method passes through. */
  private async authToken(): Promise<string> {
    if (this.cfg.auth.method === 'token') return this.cfg.auth.token;
    const cached = this.tokenCache;
    if (cached !== null && cached.expiresAtMs - 5_000 > this.now()) return cached.token;
    const res = await this.transport.request({
      method: 'POST',
      path: '/v1/auth/approle/login',
      body: { role_id: this.cfg.auth.roleId, secret_id: this.cfg.auth.secretId },
    });
    if (res.status < 200 || res.status >= 300) throw new Error('auth_failed');
    const token = clientToken(res.body);
    if (token === null) throw new Error('auth_no_token');
    const ttl = leaseDurationSec(res.body);
    this.tokenCache = { token, expiresAtMs: this.now() + ttl * 1000 };
    return token;
  }

  private fail(): ProviderOutcome {
    return { ok: false, reasonCode: UNAVAILABLE };
  }

  /** Runs an op; ANY thrown error (network/TLS/timeout/parse/auth) collapses to the fail-closed outcome. */
  private async guard(op: () => Promise<ProviderOutcome>): Promise<ProviderOutcome> {
    try {
      return await op();
    } catch {
      return this.fail();
    }
  }
}

// --- response readers (defensive; unknown JSON, never trust shape) ----------------------------------

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}
function dataOf(body: unknown): Record<string, unknown> | null {
  const root = asRecord(body);
  return root === null ? null : asRecord(root['data']);
}
function latestVersion(body: unknown): number | null {
  const data = dataOf(body);
  const v = data?.['latest_version'];
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}
function minDecryptionVersion(body: unknown): number {
  const data = dataOf(body);
  const v = data?.['min_decryption_version'];
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 1;
}
function clientToken(body: unknown): string | null {
  const root = asRecord(body);
  const auth = root === null ? null : asRecord(root['auth']);
  const t = auth?.['client_token'];
  return typeof t === 'string' && t.length > 0 ? t : null;
}
function leaseDurationSec(body: unknown): number {
  const root = asRecord(body);
  const auth = root === null ? null : asRecord(root['auth']);
  const d = auth?.['lease_duration'];
  return typeof d === 'number' && d > 0 ? d : 60;
}

// --- config from environment (returns null → composition root keeps the fail-closed default) --------

/**
 * Build an `OpenBaoConfig` from environment, or return null when OpenBao is not configured (or is misconfigured).
 * Returning null is the fail-closed default: the composition root then binds `UnavailableSecretProvider`. A
 * half-configured provider is treated as NOT configured (null) rather than bound in a broken state.
 */
export function loadOpenBaoConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): OpenBaoConfig | null {
  const address = (env['FINAPP_OPENBAO_ADDR'] ?? '').trim();
  if (address === '') return null; // not configured → fail-closed default
  if (!address.startsWith('https://') && env['FINAPP_OPENBAO_ALLOW_HTTP'] !== '1') return null; // require TLS
  const method = (env['FINAPP_OPENBAO_AUTH_METHOD'] ?? 'approle').trim();
  let auth: OpenBaoAuth | null = null;
  if (method === 'approle') {
    const roleId = (env['FINAPP_OPENBAO_ROLE_ID'] ?? '').trim();
    const secretId = (env['FINAPP_OPENBAO_SECRET_ID'] ?? '').trim();
    if (roleId !== '' && secretId !== '') auth = { method: 'approle', roleId, secretId };
  } else if (method === 'token') {
    const token = (env['FINAPP_OPENBAO_TOKEN'] ?? '').trim();
    if (token !== '') auth = { method: 'token', token };
  }
  if (auth === null) return null; // missing/invalid credentials → not configured
  const timeout = Number(env['FINAPP_OPENBAO_TIMEOUT_MS'] ?? '5000');
  const cfg: OpenBaoConfig = {
    address,
    tlsSkipVerify: env['FINAPP_OPENBAO_TLS_SKIP_VERIFY'] === '1',
    auth,
    transitMount: (env['FINAPP_OPENBAO_TRANSIT_MOUNT'] ?? 'transit').trim() || 'transit',
    transitKeyPrefix: (env['FINAPP_OPENBAO_TRANSIT_KEY_PREFIX'] ?? 'finapp-').trim() || 'finapp-',
    requestTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 5000,
    ...(env['FINAPP_OPENBAO_NAMESPACE'] !== undefined && env['FINAPP_OPENBAO_NAMESPACE'] !== ''
      ? { namespace: env['FINAPP_OPENBAO_NAMESPACE'] }
      : {}),
    ...(env['FINAPP_OPENBAO_CA_CERT_PEM'] !== undefined && env['FINAPP_OPENBAO_CA_CERT_PEM'] !== ''
      ? { caCertPem: env['FINAPP_OPENBAO_CA_CERT_PEM'] }
      : {}),
  };
  return cfg;
}

// --- Node HTTPS transport (real network; used only when a real instance is configured) --------------

/**
 * Node HTTPS transport with CA verification and a hard timeout. It sends/returns JSON only; it NEVER logs the token,
 * the request body, or the response body (any of which can carry material). Kept lazy-loaded so a pure smoke test
 * that injects a mock transport never imports `node:https`.
 */
export class NodeOpenBaoTransport implements OpenBaoTransport {
  private readonly cfg: OpenBaoConfig;
  constructor(cfg: OpenBaoConfig) {
    this.cfg = cfg;
  }
  async request(input: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    token?: string;
    body?: unknown;
  }): Promise<{ status: number; body: unknown }> {
    const https = await import('node:https');
    const url = new URL(this.cfg.address.replace(/\/+$/, '') + input.path);
    const payload = input.body === undefined ? undefined : Buffer.from(JSON.stringify(input.body));
    const headers: Record<string, string> = { accept: 'application/json' };
    if (input.token !== undefined) headers['x-vault-token'] = input.token;
    if (this.cfg.namespace !== undefined) headers['x-vault-namespace'] = this.cfg.namespace;
    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(payload.length);
    }
    return await new Promise((resolve, reject) => {
      const req = https.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method: input.method,
          headers,
          rejectUnauthorized: !this.cfg.tlsSkipVerify,
          ...(this.cfg.caCertPem !== undefined ? { ca: this.cfg.caCertPem } : {}),
          timeout: this.cfg.requestTimeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed: unknown = null;
            try {
              parsed = text === '' ? null : JSON.parse(text);
            } catch {
              parsed = null; // malformed → caller treats as failure; never surfaced
            }
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('timeout')));
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }
}
