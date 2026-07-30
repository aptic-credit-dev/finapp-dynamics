import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import { RECONCILIATION_LIFECYCLE_FAMILY } from '@finapp/contracts';
import {
  M15Emitter,
  ReconRepository,
  CatalogService,
  ImportService,
  ReconciliationService,
  MatchService,
  M15_AUDIT_CODES,
  ALL_M15_PERMISSIONS,
} from '@finapp/m15-recon';

/**
 * M15 services DB spec — proves bank reconciliation END TO END on a REAL PostgreSQL: bank accounts + versioned
 * rulesets; statement + ledger ingestion (INTEGER MINOR UNITS) with DUPLICATE protection; a reconciliation run
 * through deterministic matching (exact auto-match + append-only candidate evidence + exceptions); confirm; a manual
 * SPLIT match that must balance exactly; exception resolve; the completion gate (no complete with an open required
 * exception); reopen; optimistic-concurrency CAS; RECON_ audit + reconciliation.lifecycle events with NO account
 * numbers / raw statement content in payloads; and cross-tenant isolation.
 */
export default defineDbSpec('m15-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M15Emitter(audit, outbox);
  const repo = new ReconRepository();
  const catalog = new CatalogService(db, authz, emitter, repo);
  const imports = new ImportService(db, authz, emitter, repo);
  const recon = new ReconciliationService(db, authz, emitter, repo);
  const match = new MatchService(db, authz, emitter, repo);

  const tenant = randomUUID();
  const actor = randomUUID();
  const ctxOf = (perms: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId: actor,
    correlationId: randomUUID(),
    permissions: [...perms],
  });
  const full = ctxOf(ALL_M15_PERMISSIONS);
  const SECRET_ACCT = `ACCT-SECRET-${randomUUID()}`;
  const SECRET_DESC = `STMT-NARRATIVE-${randomUUID()}`;

  // --- bank account + ruleset -------------------------------------------------------------------
  const acct = await catalog.registerBankAccount(full, actor, {
    bankName: 'Acme Bank',
    accountLabel: 'Main',
    accountRefMasked: SECRET_ACCT,
  });
  const rs = await catalog.createRuleset(full, actor, {
    code: 'default',
    dateWindowDays: 5,
    amountToleranceMinor: 0,
    requireOppositeDirection: true,
  });
  await catalog.addRule(full, actor, rs.id, { ruleCode: 'AMT', ruleKind: 'exact_amount', weight: 50 });
  await catalog.addRule(full, actor, rs.id, { ruleCode: 'REF', ruleKind: 'exact_reference', weight: 30 });
  await catalog.addRule(full, actor, rs.id, { ruleCode: 'DATE', ruleKind: 'date_window', weight: 10 });
  await catalog.addRule(full, actor, rs.id, { ruleCode: 'DESC', ruleKind: 'similarity', weight: 10 });
  const published = await catalog.publishRuleset(full, actor, rs.id, rs.version);
  t.equal(published.status, 'active', 'a matching ruleset publishes to active');

  // --- imports + duplicate protection -----------------------------------------------------------
  const stmt = await imports.importStatement(full, actor, {
    bankAccountId: acct.id,
    sourceFormat: 'csv',
    fileHash: 'H1',
    lines: [
      {
        txnDate: '2026-01-10',
        amountMinor: 10000,
        direction: 'credit',
        reference: 'INV-001',
        description: SECRET_DESC,
      },
      { txnDate: '2026-01-10', amountMinor: 5000, direction: 'credit', reference: 'INV-002' },
    ],
  });
  t.equal(stmt.accepted, 2, 'two statement lines are imported (integer minor units)');
  await t.rejects(
    imports.importStatement(full, actor, {
      bankAccountId: acct.id,
      sourceFormat: 'csv',
      fileHash: 'H1',
      lines: [],
    }),
    'a duplicate statement import (same account + file hash) is rejected',
  );
  await imports.importLedger(full, actor, {
    bankAccountId: acct.id,
    sourceFormat: 'api',
    fileHash: 'L1',
    entries: [
      {
        entryDate: '2026-01-10',
        amountMinor: 10000,
        direction: 'debit',
        reference: 'INV-001',
        description: 'acme inv',
      },
      { entryDate: '2026-01-25', amountMinor: 5000, direction: 'debit', reference: 'ZZZ' },
    ],
  });

  // --- run + deterministic matching -------------------------------------------------------------
  const run = await recon.createRun(full, actor, { bankAccountId: acct.id, rulesetId: rs.id });
  t.equal(run.status, 'draft', 'a new run is draft');
  const matched = await recon.runMatching(full, actor, run.id, run.version);
  t.equal(matched.status, 'review', 'matching advances the run to review');
  t.ok(matched.matched_count >= 1, 'the exact statement line was auto-matched');
  const candidates = await recon.listCandidates(full, run.id);
  t.ok(candidates.length >= 1, 'the engine recorded append-only candidate evidence');
  t.ok(
    candidates.some((c) => c.confidence_band === 'exact' && c.reason_codes.includes('amount_exact')),
    'candidate evidence is explainable (exact band + reason codes)',
  );
  const matches = await match.listMatches(full, { runId: run.id });
  t.ok(
    matches.some((m) => m.matched_by === 'system' && m.status === 'proposed'),
    'an exact match was auto-proposed by the engine',
  );
  const exceptions = await match.listExceptions(full, { runId: run.id });
  t.ok(
    exceptions.some((e) => e.status === 'open'),
    'the out-of-window line raised an exception',
  );

  // --- confirm ----------------------------------------------------------------------------------
  const proposed = matches.find((m) => m.status === 'proposed');
  if (proposed !== undefined) {
    const confirmed = await match.confirm(full, actor, proposed.id, proposed.version);
    t.equal(confirmed.status, 'confirmed', 'a proposed match confirms');
    await t.rejects(
      match.confirm(full, actor, proposed.id, proposed.version),
      'a stale expectedVersion is rejected (optimistic concurrency)',
    );
  }

  // --- completion gate: refuse with an open required exception ----------------------------------
  await t.rejects(
    recon.complete(full, actor, run.id, matched.version),
    'a run cannot complete with an open required exception',
  );
  const openExc = exceptions.find((e) => e.status === 'open');
  if (openExc !== undefined) {
    const resolved = await match.resolveException(
      full,
      actor,
      openExc.id,
      openExc.version,
      'manually ticked',
    );
    t.equal(resolved.status, 'resolved', 'an exception can be resolved');
  }
  const done = await recon.complete(full, actor, run.id, matched.version);
  t.equal(done.status, 'completed', 'the run completes once required exceptions are resolved');
  const summaries = await recon.listSummaries(full, run.id);
  t.ok(summaries.length >= 1, 'a run summary is written on completion (append-only)');

  // --- reopen (privileged) ----------------------------------------------------------------------
  const reopened = await recon.reopen(full, actor, run.id, done.version, 'late correction');
  t.equal(reopened.status, 'reopened', 'a completed run can be reopened (privileged)');

  // --- manual SPLIT match must balance exactly --------------------------------------------------
  const stmt2 = await imports.importStatement(full, actor, {
    bankAccountId: acct.id,
    sourceFormat: 'csv',
    fileHash: 'H2',
    lines: [{ txnDate: '2026-02-01', amountMinor: 10000, direction: 'credit', reference: 'SPLIT-1' }],
  });
  await imports.importLedger(full, actor, {
    bankAccountId: acct.id,
    sourceFormat: 'api',
    fileHash: 'L2',
    entries: [
      { entryDate: '2026-02-01', amountMinor: 6000, direction: 'debit', reference: 'S1' },
      { entryDate: '2026-02-01', amountMinor: 4000, direction: 'debit', reference: 'S2' },
    ],
  });
  const lines2 = await imports.listStatementLines(full, stmt2.import.id);
  const ledgerImports = await imports.listLedgerImports(full, acct.id);
  const l2 = ledgerImports.find((li) => li.file_hash === 'L2');
  const entries2 = l2 !== undefined ? await imports.listLedgerEntries(full, l2.id) : [];
  const run2 = await recon.createRun(full, actor, { bankAccountId: acct.id, rulesetId: rs.id });
  const s1 = lines2[0];
  if (s1 !== undefined && entries2.length === 2) {
    const split = await match.manualMatch(full, actor, {
      runId: run2.id,
      statementLineIds: [s1.id],
      ledgerEntryIds: entries2.map((e) => e.id),
    });
    t.equal(split.match_type, 'split', 'a manual 1:many match is classified split');
    t.equal(split.matched_by, 'manual', 'a manual match is flagged manual');
    const decisions = await match.listManualDecisions(full, run2.id);
    t.ok(decisions.length >= 1, 'the manual override is recorded as append-only evidence');
  }
  await t.rejects(
    match.manualMatch(full, actor, {
      runId: run2.id,
      statementLineIds: s1 !== undefined ? [s1.id] : [randomUUID()],
      ledgerEntryIds: entries2.length > 0 && entries2[0] !== undefined ? [entries2[0].id] : [randomUUID()],
    }),
    'an unbalanced manual match is rejected (minor-unit sums must be equal)',
  );

  // --- audit + events: RECON_ codes; reconciliation.lifecycle; no account/statement leak ---------
  const codes = new Set<string>(audit.entries.map((e) => e.code));
  for (const code of [
    M15_AUDIT_CODES.runCreated,
    M15_AUDIT_CODES.statementImported,
    M15_AUDIT_CODES.matchProposed,
    M15_AUDIT_CODES.matchConfirmed,
    M15_AUDIT_CODES.exceptionRaised,
    M15_AUDIT_CODES.exceptionResolved,
    M15_AUDIT_CODES.runCompleted,
    M15_AUDIT_CODES.runReopened,
    M15_AUDIT_CODES.manualDecisionRecorded,
    M15_AUDIT_CODES.rulesetPublished,
  ]) {
    t.ok(codes.has(code), `audit code ${code} is emitted`);
  }
  t.ok(
    audit.entries.every((e) => e.code.startsWith('RECON_')),
    'every recorded audit code is a RECON_ code',
  );
  t.ok(
    outbox.events.every((e) => e.family === RECONCILIATION_LIFECYCLE_FAMILY),
    'every event flows on reconciliation.lifecycle (one outbox)',
  );
  const auditBlob = JSON.stringify(audit.entries);
  const eventBlob = JSON.stringify(outbox.events);
  t.ok(
    !auditBlob.includes(SECRET_ACCT) && !eventBlob.includes(SECRET_ACCT),
    'no masked account ref leaks into audit/event payloads',
  );
  t.ok(
    !auditBlob.includes(SECRET_DESC) && !eventBlob.includes(SECRET_DESC),
    'no raw statement narrative leaks into audit/event payloads',
  );

  // --- cross-tenant isolation -------------------------------------------------------------------
  const foreign: RequestContext = { ...ctxOf(ALL_M15_PERMISSIONS), tenantId: randomUUID() };
  await t.rejects(recon.getRun(foreign, run.id), "another tenant cannot read this tenant's run (RLS)");
  const foreignAccts = await catalog.listBankAccounts(foreign);
  t.equal(foreignAccts.length, 0, "another tenant sees none of this tenant's bank accounts (RLS)");
});
