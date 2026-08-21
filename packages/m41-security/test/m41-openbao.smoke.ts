import { defineSuite } from '@finapp/test-runner';
import type { RequestContext } from '@finapp/kernel';
import {
  OpenBaoSecretProvider,
  loadOpenBaoConfigFromEnv,
  type OpenBaoConfig,
  type OpenBaoTransport,
} from '../src/index.ts';

/**
 * M41 → OpenBao adapter PURE smoke suite. Proves the adapter maps transit operations to the SecretProviderPort
 * contract and — above all — that it FAILS CLOSED on every error path (unreachable/throw, auth failure, non-2xx,
 * malformed body/ref), returning the exact `secret_provider_unavailable` shape of the default provider. It uses an
 * in-process mock of the OpenBao HTTP API — NO real network, NO real instance, NO secret value anywhere.
 */

const CTX = { correlationId: 'test', tenantId: null } as unknown as RequestContext;
const CFG: OpenBaoConfig = {
  address: 'https://vault.test:8200',
  tlsSkipVerify: false,
  auth: { method: 'approle', roleId: 'role-x', secretId: 'secret-x' },
  transitMount: 'transit',
  transitKeyPrefix: 'finapp-',
  requestTimeoutMs: 1000,
};
const CLOCK = (): number => 1_000_000; // fixed clock; token TTL math is deterministic

/** In-memory Vault-compatible mock. Tracks transit keys + how often AppRole login was called. */
function mockTransport(opts?: {
  loginStatus?: number;
  failEvery?: (path: string, method: string) => boolean;
  throwOn?: (path: string) => boolean;
}): OpenBaoTransport & { loginCount: number } {
  const keys = new Map<string, { latest_version: number; min_decryption_version: number }>();
  const handle = (input: {
    method: string;
    path: string;
    token?: string;
    body?: unknown;
  }): { status: number; body: unknown } => {
    if (opts?.throwOn?.(input.path)) throw new Error('network down');
    if (input.path === '/v1/auth/approle/login') {
      state.loginCount += 1;
      if ((opts?.loginStatus ?? 200) !== 200) return { status: opts?.loginStatus ?? 200, body: null };
      return { status: 200, body: { auth: { client_token: 'TESTTOKEN', lease_duration: 3600 } } };
    }
    if (opts?.failEvery?.(input.path, input.method)) return { status: 500, body: null };
    const m = /^\/v1\/transit\/keys\/([^/]+)(\/config)?$/.exec(input.path);
    if (m !== null) {
      const key = decodeURIComponent(m[1]!);
      const isConfig = m[2] === '/config';
      if (input.method === 'GET') {
        const k = keys.get(key);
        return k === undefined ? { status: 404, body: null } : { status: 200, body: { data: k } };
      }
      if (input.method === 'POST' && !isConfig) {
        keys.set(key, { latest_version: 1, min_decryption_version: 1 });
        return { status: 200, body: { data: keys.get(key) } };
      }
      if (input.method === 'POST' && isConfig) return { status: 200, body: null };
      if (input.method === 'DELETE') {
        keys.delete(key);
        return { status: 204, body: null };
      }
    }
    return { status: 404, body: null };
  };
  const state = {
    loginCount: 0,
    request(input: { method: string; path: string; token?: string; body?: unknown }) {
      return Promise.resolve(handle(input));
    },
  };
  return state;
}

export default defineSuite('m41-openbao', async (t) => {
  // --- config loader: default fail-closed unless fully + safely configured ------------------------
  t.equal(loadOpenBaoConfigFromEnv({}), null, 'no FINAPP_OPENBAO_ADDR → null (fail-closed default)');
  t.equal(
    loadOpenBaoConfigFromEnv({ FINAPP_OPENBAO_ADDR: 'http://vault:8200' }),
    null,
    'non-https address without allow-http → null (TLS required)',
  );
  t.equal(
    loadOpenBaoConfigFromEnv({ FINAPP_OPENBAO_ADDR: 'https://vault:8200' }),
    null,
    'https but no credentials → null (not configured)',
  );
  const loaded = loadOpenBaoConfigFromEnv({
    FINAPP_OPENBAO_ADDR: 'https://vault:8200',
    FINAPP_OPENBAO_ROLE_ID: 'r',
    FINAPP_OPENBAO_SECRET_ID: 's',
  });
  t.ok(loaded !== null && loaded.address === 'https://vault:8200', 'full approle config → OpenBaoConfig');
  t.ok(loaded !== null && !loaded.tlsSkipVerify, 'tls verification on by default');

  // --- provision happy path: opaque ref, no material, no token leak -------------------------------
  const okProvider = new OpenBaoSecretProvider(CFG, mockTransport(), CLOCK);
  const prov = await okProvider.provision(CTX, { secretRef: 'secret:tenant/app/db', algorithm: null });
  t.equal(prov.ok, true, 'provision succeeds against a healthy vault');
  t.ok(
    typeof prov.providerRef === 'string' && prov.providerRef.startsWith('openbao:transit:'),
    'provision returns an opaque transit provider ref',
  );
  t.ok(!/TESTTOKEN|secret-x/.test(prov.providerRef ?? ''), 'provider ref leaks no token/secret material');

  // --- resolveMetadata: available for a real ref, unavailable for a bad ref -----------------------
  const meta = await okProvider.resolveMetadata(CTX, prov.providerRef ?? '');
  t.equal(meta.available, true, 'resolveMetadata reports available for a provisioned ref');
  const badMeta = await okProvider.resolveMetadata(CTX, 'not-an-openbao-ref');
  t.equal(badMeta.available, false, 'resolveMetadata fails closed on a malformed ref');
  t.equal(badMeta.reasonCode, 'secret_provider_unavailable', 'malformed ref → unavailable reason code');

  // --- destroy: ok on happy path ------------------------------------------------------------------
  const destroyed = await okProvider.destroy(CTX, prov.providerRef ?? '');
  t.equal(destroyed.ok, true, 'destroy crypto-erases the key');
  const destroyBad = await okProvider.destroy(CTX, 'garbage');
  t.equal(destroyBad.ok, false, 'destroy fails closed on a malformed ref');

  // --- FAIL CLOSED: auth failure ------------------------------------------------------------------
  const authFail = new OpenBaoSecretProvider(CFG, mockTransport({ loginStatus: 403 }), CLOCK);
  const pf = await authFail.provision(CTX, { secretRef: 'secret:x', algorithm: null });
  t.equal(pf.ok, false, 'provision fails closed when AppRole login is rejected');
  t.equal(pf.reasonCode, 'secret_provider_unavailable', 'auth failure → unavailable reason code');
  const rf = await authFail.resolveMetadata(CTX, 'openbao:transit:finapp-x#v1');
  t.equal(rf.available, false, 'resolveMetadata fails closed when auth fails');

  // --- FAIL CLOSED: network throw -----------------------------------------------------------------
  const netFail = new OpenBaoSecretProvider(CFG, mockTransport({ throwOn: () => true }), CLOCK);
  const pn = await netFail.provision(CTX, { secretRef: 'secret:x', algorithm: null });
  t.equal(pn.ok, false, 'provision fails closed when the transport throws');
  const dn = await netFail.destroy(CTX, 'openbao:transit:finapp-x#v1');
  t.equal(dn.ok, false, 'destroy fails closed when the transport throws');

  // --- FAIL CLOSED: non-2xx on a read -------------------------------------------------------------
  const readFail = new OpenBaoSecretProvider(
    CFG,
    mockTransport({ failEvery: (_p, mth) => mth === 'GET' }),
    CLOCK,
  );
  const p5 = await readFail.provision(CTX, { secretRef: 'secret:x', algorithm: null });
  t.equal(p5.ok, false, 'provision fails closed on a 500 from the vault');

  // --- token caching: AppRole login happens once across multiple ops ------------------------------
  const tp = mockTransport();
  const cacheProvider = new OpenBaoSecretProvider(CFG, tp, CLOCK);
  await cacheProvider.provision(CTX, { secretRef: 'secret:a', algorithm: null });
  await cacheProvider.provision(CTX, { secretRef: 'secret:b', algorithm: null });
  t.equal(tp.loginCount, 1, 'the token is cached: AppRole login is called once for two operations');

  // --- never throws out of a port method (fail-closed parity with UnavailableSecretProvider) ------
  const threw = await okProvider
    .provision(CTX, { secretRef: 'secret:z', algorithm: 'aes256-gcm96' })
    .then(() => false)
    .catch(() => true);
  t.equal(threw, false, 'a port method never throws — it resolves to an outcome');
});
