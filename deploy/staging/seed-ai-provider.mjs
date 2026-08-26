/**
 * Stage-8 staging-only SYNTHETIC M24 AI provider/model seed. Registers + APPROVES a DETERMINISTIC provider + model
 * (no network, no secret material — a fail-closed framework double) so the M28 copilot's canonical m24 generation
 * pipeline can produce a governed, cited answer. NON-PRODUCTION ONLY. Idempotent (reuses an existing 'stg-exec'
 * provider/model). It prints only the provider/model IDS (no secret). m28/m32 own no provider — the copilot consumes
 * m24 BY CONTRACT.
 *
 * Run INSIDE the api container:
 *   docker compose exec -T api node --input-type=module < deploy/staging/seed-ai-provider.mjs
 */
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { PgDb } from '@finapp/kernel/pg';
import { RbacAuthz } from '@finapp/m02-rbac';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { CatalogService, M24Emitter, AiRepository, ALL_M24_PERMISSIONS } from '@finapp/m24-ai-foundation';

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run: NODE_ENV=production (staging-only synthetic AI provider seed).');
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}
const T1 = 'ac1fd32d-0929-4729-9b50-b57ec5b5286b';
const appRole = process.env.DATABASE_APP_ROLE || 'finapp_app';

const pool = new pg.Pool({ connectionString: url });
const db = new PgDb({ pool, appRole });
const authz = new RbacAuthz();
const catalog = new CatalogService(
  db,
  authz,
  new M24Emitter(new RecordingAudit(), new RecordingOutbox()),
  new AiRepository(),
);
const ctx = {
  tenantId: T1,
  userId: randomUUID(),
  correlationId: randomUUID(),
  permissions: [...ALL_M24_PERMISSIONS],
};

async function existing() {
  // reuse an already-approved provider + its model if present (idempotent reruns)
  const p = await pool.query(
    `SELECT id, version, status FROM ai_provider WHERE tenant_id=$1 AND code='stg-exec' LIMIT 1`,
    [T1],
  );
  if (p.rows[0] == null) return null;
  const provider = p.rows[0];
  const m = await pool.query(
    `SELECT id FROM ai_model WHERE tenant_id=$1 AND provider_id=$2 AND code='stg-exec-sm' LIMIT 1`,
    [T1, provider.id],
  );
  return { providerId: provider.id, modelId: m.rows[0]?.id ?? null, status: provider.status };
}

try {
  let out = await existing();
  if (out && out.modelId) {
    // ensure approved
    if (out.status !== 'approved') {
      const cur = await pool.query(`SELECT version FROM ai_provider WHERE id=$1`, [out.providerId]);
      await catalog.approveProvider(ctx, ctx.userId, out.providerId, cur.rows[0].version);
    }
    console.log(JSON.stringify({ ok: true, reused: true, ...out }, null, 0));
  } else {
    const provider = await catalog.registerProvider(ctx, ctx.userId, {
      code: 'stg-exec',
      classifications: ['confidential', 'restricted'],
      secretReference: `secretref:vault/${randomUUID()}`,
    });
    await catalog.approveProvider(ctx, ctx.userId, provider.id, provider.version);
    const model = await catalog.registerModel(ctx, ctx.userId, {
      providerId: provider.id,
      code: 'stg-exec-sm',
      ratePer1kMinor: 20,
    });
    console.log(
      JSON.stringify({ ok: true, reused: false, providerId: provider.id, modelId: model.id }, null, 0),
    );
  }
} catch (e) {
  console.error('seed-ai-provider failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
