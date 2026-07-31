import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import { GLRECON_LIFECYCLE_FAMILY } from '@finapp/contracts';
import {
  M20Emitter,
  GlreconRepository,
  CatalogService,
  ImportService,
  ReconciliationService,
  MatchService,
  CertificationService,
  RecommendationService,
  M20_PERMISSIONS,
  ALL_M20_PERMISSIONS,
} from '@finapp/m20-glrecon';

/**
 * M20 services DB spec — proves GL reconciliation END TO END on a REAL PostgreSQL: GL account + versioned ruleset; GL
 * + source ingestion (INTEGER MINOR UNITS) with the balance invariant (opening + debits − credits = calculated
 * closing) enforced on import; a reconciliation run through deterministic matching (exact auto-match + append-only
 * candidate evidence + exceptions) with the balance-invariant evidence recorded; confirm; the completion gate (no
 * complete with an open required exception); balance certification blocked by open exceptions unless a PRIVILEGED
 * override with a reason is supplied; a DRAFT journal recommendation that hands off (never posts); optimistic-
 * concurrency CAS; GLRECON_ audit + glrecon.lifecycle events with NO raw amounts/descriptions in payloads; and
 * cross-tenant isolation.
 */
export default defineDbSpec('m20-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M20Emitter(audit, outbox);
  const repo = new GlreconRepository();
  const catalog = new CatalogService(db, authz, emitter, repo);
  const imports = new ImportService(db, authz, emitter, repo);
  const recon = new ReconciliationService(db, authz, emitter, repo);
  const match = new MatchService(db, authz, emitter, repo);
  const certs = new CertificationService(db, authz, emitter, repo);
  const recs = new RecommendationService(db, authz, emitter, repo);

  const tenant = randomUUID();
  const actor = randomUUID();
  const ctxOf = (perms: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId: actor,
    correlationId: randomUUID(),
    permissions: [...perms],
  });
  const full = ctxOf(ALL_M20_PERMISSIONS);
  const SECRET_DESC = `GL-NARRATIVE-${randomUUID()}`;

  // --- account + ruleset ------------------------------------------------------------------------
  const acct = await catalog.registerAccount(full, actor, {
    code: 'GL-1000',
    name: 'Cash',
    normalSide: 'debit',
  });
  const rs = await catalog.createRuleset(full, actor, {
    code: 'default',
    dateWindowDays: 5,
    amountToleranceMinor: 0,
    requireOppositeDirection: true,
  });
  await catalog.addRule(full, actor, rs.id, { ruleCode: 'AMT', ruleKind: 'exact_amount', weight: 50 });
  await catalog.addRule(full, actor, rs.id, { ruleCode: 'REF', ruleKind: 'exact_reference', weight: 30 });
  await catalog.addRule(full, actor, rs.id, { ruleCode: 'DATE', ruleKind: 'date_window', weight: 20 });
  const published = await catalog.publishRuleset(full, actor, rs.id, rs.version);
  t.equal(published.status, 'active', 'a matching ruleset publishes to active');

  // --- GL import with the balance invariant -----------------------------------------------------
  const glImp = await imports.importGl(full, actor, {
    glAccountId: acct.id,
    sourceFormat: 'csv',
    fileHash: 'GL1',
    periodStart: '2026-01-01',
    periodEnd: '2026-01-31',
    openingBalanceMinor: 0,
    closingBalanceMinor: 15000, // = 0 + (10000 + 5000) debits - 0 credits
    lines: [
      {
        txnDate: '2026-01-10',
        amountMinor: 10000,
        direction: 'debit',
        reference: 'INV-001',
        description: SECRET_DESC,
      },
      { txnDate: '2026-01-10', amountMinor: 5000, direction: 'debit', reference: 'NOPE' },
    ],
  });
  t.equal(glImp.lineCount, 2, 'two GL lines imported (integer minor units)');
  t.ok(
    glImp.balance !== null && glImp.balance.closing_balance_minor === '15000',
    'the GL balance satisfies the invariant',
  );

  await t.rejects(
    imports.importGl(full, actor, {
      glAccountId: acct.id,
      sourceFormat: 'csv',
      fileHash: 'GLBAD',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      openingBalanceMinor: 0,
      closingBalanceMinor: 999, // invariant violated: 0 + 100 - 0 != 999
      lines: [{ txnDate: '2026-02-01', amountMinor: 100, direction: 'debit' }],
    }),
    'a GL import whose closing breaks the invariant is rejected',
  );
  await t.rejects(
    imports.importGl(full, actor, { glAccountId: acct.id, sourceFormat: 'csv', fileHash: 'GL1', lines: [] }),
    'a duplicate GL import (same account + file hash) is rejected',
  );

  // --- source import ----------------------------------------------------------------------------
  await imports.importSource(full, actor, {
    glAccountId: acct.id,
    sourceFormat: 'api',
    fileHash: 'SRC1',
    entries: [{ entryDate: '2026-01-10', amountMinor: 10000, direction: 'credit', reference: 'INV-001' }],
  });

  // --- run + balance invariant + deterministic matching -----------------------------------------
  const run = await recon.createRun(full, actor, {
    glAccountId: acct.id,
    rulesetId: rs.id,
    periodStart: '2026-01-01',
    periodEnd: '2026-01-31',
    openingBalanceMinor: 0,
    closingBalanceMinor: 15000,
  });
  t.equal(run.status, 'draft', 'a new run is draft');
  const executed = await recon.executeRun(full, actor, run.id, run.version);
  t.equal(executed.status, 'review_required', 'executing advances the run to review_required');
  t.ok(executed.matched_count >= 1, 'the exact GL line was auto-matched against the source line');

  const runBalances = await recon.listRunBalances(full, run.id);
  t.ok(runBalances.length === 1, 'the balance invariant was computed + recorded (append-only)');
  t.ok(
    runBalances[0]?.balanced === true,
    'the GL calculated closing balances against the source closing (variance 0)',
  );
  t.equal(
    runBalances[0]?.calculated_closing_minor,
    '15000',
    'calculated closing = opening + debits - credits',
  );

  const candidates = await recon.listCandidates(full, run.id);
  t.ok(candidates.length >= 1, 'the engine recorded append-only candidate evidence');
  const exact = candidates.find((c) => c.confidence_band === 'exact');
  t.ok(
    exact !== undefined && exact.reason_codes.includes('amount_exact') && exact.amount_variance_minor === '0',
    'candidate evidence is explainable (exact band + reason codes + zero variance)',
  );

  const matches = await match.listMatches(full, run.id);
  const proposed = matches.find((m) => m.status === 'proposed');
  t.ok(proposed !== undefined, 'the deterministic engine auto-proposed a match');
  if (proposed !== undefined) {
    const confirmed = await match.confirmMatch(full, actor, proposed.id, proposed.version);
    t.equal(confirmed.status, 'confirmed', 'a proposed match confirms');
  }

  // --- completion gate: an open required exception blocks completion ----------------------------
  const openExc = await match.listExceptions(full, run.id, 'open');
  t.ok(openExc.length >= 1, 'the unmatched GL line raised a required exception');
  await t.rejects(
    recon.complete(full, actor, run.id, executed.version),
    'a run cannot complete while a required exception is open (fail closed)',
  );

  // --- balance certification: blocked by open exceptions unless a privileged override -----------
  const cert = await certs.createCertification(full, actor, run.id);
  t.ok(cert.unresolved_exception_count >= 1, 'the certification records the open exception count');
  await t.rejects(
    certs.certifyBalance(full, actor, cert.id, cert.version, { override: false }),
    'a balance with open exceptions cannot be certified without an override',
  );
  const noOverridePerm = ctxOf(
    ALL_M20_PERMISSIONS.filter((p) => p !== M20_PERMISSIONS.certificationOverride),
  );
  await t.rejects(
    certs.certifyBalance(noOverridePerm, actor, cert.id, cert.version, {
      override: true,
      overrideReason: 'management sign-off',
    }),
    'certifying over open blockers requires the privileged override permission (default deny)',
  );
  await t.rejects(
    certs.certifyBalance(full, actor, cert.id, cert.version, { override: true, overrideReason: '' }),
    'an override with an empty reason is rejected (fail closed)',
  );
  const overridden = await certs.certifyBalance(full, actor, cert.id, cert.version, {
    override: true,
    overrideReason: 'management sign-off; residual under review',
  });
  t.ok(
    overridden.status === 'certified' && overridden.is_override,
    'a privileged override certifies with a reason',
  );

  // --- resolve the exception, then complete -----------------------------------------------------
  const exc = openExc[0];
  if (exc !== undefined) {
    const resolved = await match.resolveException(
      full,
      actor,
      exc.id,
      exc.version,
      'posted correcting entry',
    );
    t.equal(resolved.status, 'resolved', 'an exception resolves');
  }
  const currentRun = await recon.getRun(full, run.id);
  const completed = await recon.complete(full, actor, run.id, currentRun.version);
  t.equal(completed.status, 'completed', 'the run completes once no required exception is open');

  // --- DRAFT journal recommendation (never posts) -----------------------------------------------
  const rec = await recs.createRecommendation(full, actor, {
    runId: run.id,
    debitAccountRef: randomUUID(),
    creditAccountRef: randomUUID(),
    amountMinor: 5000,
    description: 'suggest correcting entry for unmatched GL line',
    reasonCode: 'unmatched_gl',
  });
  t.ok(rec.is_draft && rec.status === 'proposed', 'a recommendation is a DRAFT proposal (never posted)');
  const handed = await recs.handOffRecommendation(full, actor, rec.id, rec.version, randomUUID());
  t.ok(
    handed.status === 'handed_off' && handed.is_draft,
    'a recommendation hands off to m21 but stays draft',
  );

  // --- optimistic concurrency (stale execute rejects) -------------------------------------------
  const run2 = await recon.createRun(full, actor, { glAccountId: acct.id, rulesetId: rs.id });
  await t.rejects(
    recon.executeRun(full, actor, run2.id, run2.version + 99),
    'a stale expectedVersion is rejected (optimistic concurrency)',
  );

  // --- audit + event payloads carry NO raw amounts or descriptions ------------------------------
  const events = outbox.events.filter((e) => e.family === GLRECON_LIFECYCLE_FAMILY);
  t.ok(events.length >= 5, 'glrecon.lifecycle events were published on the shared outbox');
  const serialized = JSON.stringify(events);
  t.ok(
    !serialized.includes(SECRET_DESC),
    'no raw GL narrative appears in any event payload (data minimisation)',
  );
  const auditSerialized = JSON.stringify(audit.entries);
  t.ok(
    !auditSerialized.includes(SECRET_DESC),
    'no raw GL narrative appears in any audit entry (data minimisation)',
  );

  // --- cross-tenant isolation -------------------------------------------------------------------
  const other = ctxOf(ALL_M20_PERMISSIONS);
  const otherTenant = { ...other, tenantId: randomUUID() };
  await t.rejects(recon.getRun(otherTenant, run.id), "another tenant cannot read this tenant's run (RLS)");
});
