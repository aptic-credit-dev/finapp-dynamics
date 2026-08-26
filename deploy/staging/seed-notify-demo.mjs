/**
 * Stage-8 staging-only SYNTHETIC M08 inbox seed. Inserts in-app inbox notifications so the Notifications workspace
 * has content to read + mark-read. NON-PRODUCTION ONLY. Idempotent (deterministic ids + ON CONFLICT DO NOTHING).
 * No real PII. This is the least-invasive canonical-shape seed (inbox rows are normally produced by the worker
 * dispatch path, which is not HTTP-exposed and has no provider bound in staging) — it writes the same safe,
 * rendered title/body an in-app delivery would, tenant-scoped under RLS. It never touches money or secrets.
 *
 * Run INSIDE the api container:
 *   docker compose exec -T api node --input-type=module < deploy/staging/seed-notify-demo.mjs
 */
import pg from 'pg';

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run: NODE_ENV=production (staging-only synthetic inbox seed).');
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}
const T1 = 'ac1fd32d-0929-4729-9b50-b57ec5b5286b';
const DEMO_MGR = '00000000-0000-4000-8000-0000000b0000'; // stg_demo_manager identity
const NOTIFY_USER = '00000000-0000-4000-8000-0000000c0100'; // stg_notify_user identity

// deterministic id base per row for idempotent reruns
const rid = (n) => `00000000-0000-4000-8000-0000000c1${n}00`;

const ROWS = [
  {
    n: '1',
    to: DEMO_MGR,
    sev: 'critical',
    status: 'unread',
    title: 'Feedback escalated to HOD',
    body: 'A critical negative feedback (SYN-FB-4) was escalated and requires HOD attention.',
    mod: 'm12-feedback',
    et: 'feedback_record',
  },
  {
    n: '2',
    to: DEMO_MGR,
    sev: 'warning',
    status: 'unread',
    title: 'Reconciliation exceptions open',
    body: 'The July bank reconciliation has 3 unmatched items awaiting review.',
    mod: 'm20-glrecon',
    et: 'reconciliation_run',
  },
  {
    n: '3',
    to: DEMO_MGR,
    sev: 'info',
    status: 'read',
    title: 'Journal submitted for approval',
    body: 'FX revaluation correction journal was submitted and awaits maker-checker approval.',
    mod: 'm21-journal',
    et: 'journal',
  },
  {
    n: '4',
    to: DEMO_MGR,
    sev: 'warning',
    status: 'unread',
    title: 'Recovery arrangement default',
    body: 'A recovery arrangement has defaulted and moved to enforcement pending.',
    mod: 'm17-recovery',
    et: 'recovery_case',
  },
  {
    n: '5',
    to: NOTIFY_USER,
    sev: 'critical',
    status: 'unread',
    title: 'Security control non-compliant',
    body: 'A GDPR control was assessed non-compliant in the GRC register.',
    mod: 'm41-security',
    et: 'grc_control',
  },
  {
    n: '6',
    to: NOTIFY_USER,
    sev: 'info',
    status: 'read',
    title: 'Litigation filing filed',
    body: 'A litigation filing completed the submit → review → approve → file maker-checker chain.',
    mod: 'm16-litigation',
    et: 'litigation_filing',
  },
];

const pool = new pg.Pool({ connectionString: url });
try {
  await pool.query(`SET app.tenant_id = '${T1}'`);
  let inserted = 0;
  for (const r of ROWS) {
    const res = await pool.query(
      `INSERT INTO inbox_notification
         (tenant_id, id, recipient_id, severity, title, body, status, origin_module, origin_entity_type,
          delivered_at, read_at, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - ($10 || ' hours')::interval,
               CASE WHEN $7='read' THEN now() ELSE NULL END, 1)
       ON CONFLICT (tenant_id, id) DO NOTHING`,
      [T1, rid(r.n), r.to, r.sev, r.title, r.body, r.status, r.mod, r.et, String(Number(r.n) * 2)],
    );
    inserted += res.rowCount ?? 0;
  }
  const counts = await pool.query(
    `SELECT recipient_id, status, count(*)::int c FROM inbox_notification WHERE tenant_id=$1
       AND recipient_id = ANY($2) GROUP BY recipient_id, status ORDER BY recipient_id, status`,
    [T1, [DEMO_MGR, NOTIFY_USER]],
  );
  await pool.query(`RESET app.tenant_id`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        newly_inserted: inserted,
        inbox_counts: counts.rows,
        note: 'staging-only synthetic in-app inbox',
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error('seed-notify-demo failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
