import { readFileSync } from 'node:fs';
import { defineSuite } from '@finapp/test-runner';
import {
  appDetailView,
  credentialMetaView,
  productDetailView,
  subscriptionReadView,
} from '../src/devportal/views.ts';

/**
 * M35 Developer Portal — read-model DTO no-material PURE assertion (+ web no-recovery-path scan). The developer
 * portal read surface must NEVER serialise credential secret material: a stored credential is a one-way sha256:
 * hash XOR an opaque secretref: pointer, and there is NO read path to either. This suite feeds each read view a
 * synthetic row salted with FORBIDDEN material fields (secret_hash / secret_ref / secret / plaintext / value / …)
 * and proves the DTO output contains NONE of them — a credential view exposes only id/appId/keyId/purpose/status/
 * version + timestamps. It additionally scans the web API client to prove no credential-secret REVEAL / RECOVERY
 * path exists (the only plaintext exposure is the canonical one-time issue/rotate response, never re-readable).
 */
const FORBIDDEN = [
  'secret_hash',
  'secretHash',
  'secret_ref',
  'secretRef',
  'secret',
  'value',
  'plaintext',
  'plaintextSecret',
  'keyMaterial',
  'material',
  'token',
  'password',
  'privateKey',
  'ciphertext',
];
function forbiddenHits(obj: unknown, path = ''): string[] {
  const hits: string[] = [];
  if (Array.isArray(obj)) obj.forEach((v, i) => hits.push(...forbiddenHits(v, `${path}[${i}]`)));
  else if (obj && typeof obj === 'object')
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (FORBIDDEN.includes(k)) hits.push(`${path}.${k}`);
      hits.push(...forbiddenHits(v, `${path}.${k}`));
    }
  return hits;
}

// Every forbidden material key, salted into each row so we prove the view IGNORES them and projects only its safe
// allowlist (the views never spread their input). The cast is deliberate — the row shape is intentionally dirty.
const MATERIAL_SALT = {
  secret_hash: `sha256:${'a'.repeat(64)}`,
  secret_ref: 'secretref:staging/x',
  secret: 'dps_PLAINTEXT-SHOULD-NEVER-APPEAR',
  value: 'nope',
  plaintext: 'nope',
  plaintextSecret: 'nope',
  keyMaterial: 'nope',
  token: 'nope',
  password: 'nope',
  privateKey: 'nope',
  ciphertext: 'nope',
};

export default defineSuite('api-devportal-views', (t) => {
  const app = appDetailView({
    ...MATERIAL_SALT,
    tenant_id: 'tt',
    id: 'a1',
    scope: 'tenant',
    app_key: 'acme',
    name: 'Acme',
    description: 'desc',
    homepage_url: 'https://x',
    owner_ref: 'u1',
    status: 'active',
    version: 2,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
  });
  t.equal(forbiddenHits(app).length, 0, 'appDetailView exposes no secret-material field');
  t.equal(app.createdAt, '2026-08-01T00:00:00Z', 'appDetailView exposes lifecycle timestamps');

  // The load-bearing one: credential METADATA must never carry the hash, the reference, or any value.
  const cred = credentialMetaView({
    ...MATERIAL_SALT,
    tenant_id: 'tt',
    id: 'c1',
    app_id: 'a1',
    key_id: 'dpk_abc',
    purpose: 'api',
    status: 'active',
    version: 1,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  });
  t.equal(forbiddenHits(cred).length, 0, 'credentialMetaView exposes NO secret material (hash/ref/value)');
  t.ok(!('secret_hash' in (cred as Record<string, unknown>)), 'credentialMetaView has no secret_hash key');
  t.ok(!('secret_ref' in (cred as Record<string, unknown>)), 'credentialMetaView has no secret_ref key');
  t.ok(!('secret' in (cred as Record<string, unknown>)), 'credentialMetaView has no secret key');
  t.equal(
    Object.keys(cred).sort().join(','),
    'appId,createdAt,id,keyId,purpose,status,updatedAt,version',
    'credentialMetaView projects only safe metadata keys',
  );

  const product = productDetailView({
    ...MATERIAL_SALT,
    tenant_id: 'tt',
    id: 'p1',
    scope: 'tenant',
    product_key: 'billing',
    title: 'Billing',
    summary: 'sum',
    category: 'finance',
    visibility: 'tenant',
    source_kind: 'internal',
    source_ref: null,
    state: 'published',
    validation_passed: true,
    version: 4,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  });
  t.equal(forbiddenHits(product).length, 0, 'productDetailView exposes no secret-material field');

  const sub = subscriptionReadView({
    ...MATERIAL_SALT,
    tenant_id: 'tt',
    id: 's1',
    app_id: 'a1',
    product_id: 'p1',
    status: 'active',
    requested_by: 'u1',
    approved_by: 'u2',
    version: 2,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  });
  t.equal(forbiddenHits(sub).length, 0, 'subscriptionReadView exposes no secret-material field');
  t.ok(
    sub.approvedBy !== sub.requestedBy,
    'subscriptionReadView carries maker-checker evidence (approver != requester)',
  );

  // --- web client: NO credential-secret reveal / recovery path -----------------------------------
  // The only plaintext exposure is the canonical ONE-TIME issue/rotate response (returned by the m35 service and
  // never persisted or re-readable). There must be no client function that fetches a stored credential's secret.
  const webApi = readFileSync(new URL('../../web/src/api.ts', import.meta.url), 'utf8');
  const FORBIDDEN_WEB = [
    /credentials\/[^'"`]*\/reveal/i, // no reveal-credential endpoint
    /revealCredential/i,
    /getCredentialSecret/i,
    /getDevCredentialSecret/i,
    /credentialSecret\s*=/i,
    /recoverSecret/i,
  ];
  for (const re of FORBIDDEN_WEB)
    t.ok(!re.test(webApi), `web API client has no credential-secret recovery path (${re})`);
  // Sanity: the canonical one-time issue/rotate functions DO exist (this is the only plaintext exposure).
  t.ok(webApi.includes('issueDevCredential'), 'the canonical one-time issue-credential client fn exists');
  t.ok(webApi.includes('rotateDevCredential'), 'the canonical one-time rotate-credential client fn exists');
});
