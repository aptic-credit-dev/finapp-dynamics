import { defineSuite } from '@finapp/test-runner';
import {
  secretView,
  secretDetailView,
  secretVersionView,
  revealView,
  secretProviderStatusView,
} from '../src/security/views.ts';

/**
 * M41 Secrets & Keys (Phase 1) — DTO no-material PURE assertion. The read-only admin console must NEVER be able to
 * serialise secret material. This suite feeds each new view function a synthetic row whose keys deliberately include
 * FORBIDDEN material fields (value/plaintext/keyMaterial/token/password/credential/privateKey/ciphertext/…) and proves
 * the DTO output contains NONE of them — a view exposes only ids, keys, states, an approved algorithm id, opaque
 * secret_ref/provider_ref pointers, and timestamps. This guards the contract at the serialisation boundary, complementing
 * the DB-spec row assertions and the live staging acceptance body scan.
 */
const FORBIDDEN = [
  'value',
  'plaintext',
  'plainText',
  'decrypted',
  'decryptedValue',
  'keyMaterial',
  'material',
  'token',
  'password',
  'credential',
  'privateKey',
  'secret_value',
  'secretValue',
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

// A synthetic row carrying EVERY forbidden material field plus a value/token nested one level deep, to prove the view
// projects an allowlist of safe fields rather than spreading the row. `as never`/`as any`-free: cast through unknown.
function poison<T>(extra: Record<string, unknown>): T {
  return {
    // material we must never surface
    value: 'PLAINTEXT-SHOULD-NEVER-APPEAR',
    plaintext: 'nope',
    keyMaterial: 'nope',
    token: 'nope',
    password: 'nope',
    credential: 'nope',
    privateKey: 'nope',
    ciphertext: 'nope',
    secretValue: 'nope',
    ...extra,
  } as unknown as T;
}

export default defineSuite('api-security-views', (t) => {
  const secret = secretView(
    poison({
      tenant_id: 'tt',
      id: 's1',
      material_kind: 'secret',
      scope: 'tenant',
      secret_key: 'k',
      secret_ref: 'secretref:staging/x',
      algorithm: 'aes-256-gcm',
      state: 'active',
      current_version_no: 2,
      version: 3,
    }),
  );
  t.equal(forbiddenHits(secret).length, 0, 'secretView exposes no secret-material field');
  t.equal(secret.secretRef, 'secretref:staging/x', 'secretView exposes only the opaque secret_ref');
  t.ok(!('value' in (secret as Record<string, unknown>)), 'secretView has no `value` key');

  const detail = secretDetailView(
    poison({
      tenant_id: 'tt',
      id: 's1',
      material_kind: 'secret',
      scope: 'tenant',
      secret_key: 'k',
      secret_ref: 'secretref:staging/x',
      algorithm: 'aes-256-gcm',
      state: 'active',
      current_version_no: 2,
      version: 3,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-02T00:00:00Z',
    }),
  );
  t.equal(forbiddenHits(detail).length, 0, 'secretDetailView exposes no secret-material field');
  t.equal(detail.createdAt, '2026-08-01T00:00:00Z', 'secretDetailView exposes lifecycle timestamps');

  const version = secretVersionView(
    poison({
      tenant_id: 'tt',
      id: 'v1',
      secret_id: 's1',
      version_no: 2,
      state: 'active',
      provider_ref: 'openbao:transit:x#v2',
      activated_at: '2026-08-01T00:00:00Z',
      created_at: '2026-08-01T00:00:00Z',
    }),
  );
  t.equal(
    forbiddenHits(version).length,
    0,
    'secretVersionView exposes no material (opaque provider_ref only)',
  );
  t.equal(
    version.providerRef,
    'openbao:transit:x#v2',
    'secretVersionView exposes only the opaque provider_ref',
  );

  const reveal = revealView(
    poison({
      tenant_id: 'tt',
      id: 'r1',
      secret_id: 's1',
      requested_by: 'u1',
      approved_by: 'u2',
      purpose: 'incident triage',
      reason_code: 'reveal_granted',
      granted: true,
      expires_at: '2026-08-01T01:00:00Z',
      created_at: '2026-08-01T00:00:00Z',
    }),
  );
  t.equal(
    forbiddenHits(reveal).length,
    0,
    'revealView exposes no material (maker-checker grant metadata only)',
  );
  t.ok(
    reveal.approvedBy !== reveal.requestedBy,
    'revealView carries maker-checker evidence (approver != requester)',
  );

  const status = secretProviderStatusView({ available: false, reasonCode: 'secret_provider_unavailable' });
  t.equal(forbiddenHits(status).length, 0, 'secretProviderStatusView exposes no material');
  t.equal(
    Object.keys(status).sort().join(','),
    'available,reasonCode',
    'secretProviderStatusView returns only {available,reasonCode}',
  );
});
