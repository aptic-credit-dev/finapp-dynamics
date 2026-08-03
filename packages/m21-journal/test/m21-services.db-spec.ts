import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import { JOURNAL_LIFECYCLE_FAMILY, POSTING_REQUEST_LIFECYCLE_FAMILY } from '@finapp/contracts';
import {
  M21Emitter,
  JournalRepository,
  CatalogService,
  RecommendationService,
  DraftService,
  ValidationService,
  PostingService,
  M21_PERMISSIONS,
  ALL_M21_PERMISSIONS,
} from '@finapp/m21-journal';

/**
 * M21 services DB spec — proves the journal engine END TO END on a REAL PostgreSQL: idempotent recommendation intake
 * (m20 handoff) -> accept -> convert into a BALANCED draft; direct draft creation + line edits with the balance
 * recomputed in INTEGER MINOR UNITS; deterministic validation (unbalanced -> reason code; balanced -> validated);
 * closed-period rejection; submit-for-approval; approval-gated posting-request preparation with maker != checker (SoD);
 * posting-result evidence + the draft posting terminal; the no-duplicate-post guard; optimistic-concurrency CAS;
 * JOURNAL_ audit + journal.lifecycle / posting_request.lifecycle events with NO raw narrative in payloads; and
 * cross-tenant isolation. m21 NEVER approves or pushes to an external system.
 */
export default defineDbSpec('m21-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M21Emitter(audit, outbox);
  const repo = new JournalRepository();
  const catalog = new CatalogService(db, authz, emitter, repo);
  const recs = new RecommendationService(db, authz, emitter, repo);
  const drafts = new DraftService(db, authz, emitter, repo);
  const validation = new ValidationService(db, authz, emitter, repo);
  const posting = new PostingService(db, authz, emitter, repo);

  const tenant = randomUUID();
  const actor = randomUUID();
  const approver = randomUUID();
  const entity = randomUUID();
  const currency = randomUUID();
  const ctxOf = (perms: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId: actor,
    correlationId: randomUUID(),
    permissions: [...perms],
  });
  const full = ctxOf(ALL_M21_PERMISSIONS);
  const SECRET_DESC = `JOURNAL-NARRATIVE-${randomUUID()}`;

  // --- configurable reference data --------------------------------------------------------------
  const type = await catalog.createType(full, actor, { code: 'STD', name: 'Standard', kind: 'standard' });
  const publishedType = await catalog.publishType(full, actor, type.id, type.version);
  t.equal(publishedType.status, 'active', 'a journal type publishes to active');

  // --- idempotent recommendation intake (m20 handoff) -------------------------------------------
  const handoff = randomUUID();
  const rec = await recs.ingestRecommendation(full, actor, {
    sourceType: 'gl_reconciliation',
    handoffRef: handoff,
    entityRef: entity,
    currencyRef: currency,
    amountMinor: 5000,
    description: SECRET_DESC,
    reasonCode: 'unmatched_gl',
    confidenceBand: 'strong',
    lines: [
      { accountRef: randomUUID(), direction: 'debit', amountMinor: 5000, currencyRef: currency },
      { accountRef: randomUUID(), direction: 'credit', amountMinor: 5000, currencyRef: currency },
    ],
  });
  t.equal(rec.status, 'proposed', 'an ingested recommendation is proposed');
  const again = await recs.ingestRecommendation(full, actor, { handoffRef: handoff, amountMinor: 5000 });
  t.equal(again.id, rec.id, 'recommendation intake is idempotent per m20 handoff_ref');

  await t.rejects(
    recs.ingestRecommendation(full, actor, { amountMinor: 100.5 }),
    'a float recommendation amount is rejected (no float money)',
  );

  // --- accept + convert into a BALANCED draft ---------------------------------------------------
  const accepted = await recs.acceptRecommendation(full, actor, rec.id, rec.version);
  t.equal(accepted.status, 'accepted', 'a recommendation accepts');
  const converted = await recs.convertRecommendation(full, actor, rec.id, accepted.version, {
    periodStatus: 'open',
    journalDate: '2026-01-31',
  });
  t.equal(converted.recommendation.status, 'converted', 'an accepted recommendation converts');
  t.ok(
    converted.draft.is_balanced && converted.draft.total_debits_minor === '5000',
    'conversion mints a balanced draft (debits == credits, minor units)',
  );

  // --- direct draft + line edits + deterministic validation -------------------------------------
  const draft = await drafts.createDraft(full, actor, {
    entityRef: entity,
    currencyRef: currency,
    periodStatus: 'open',
    journalTypeId: type.id,
    description: 'manual entry',
    lines: [
      { accountRef: randomUUID(), direction: 'debit', amountMinor: 10000, currencyRef: currency },
      { accountRef: randomUUID(), direction: 'credit', amountMinor: 9000, currencyRef: currency },
    ],
  });
  t.ok(
    !draft.is_balanced && draft.total_debits_minor === '10000',
    'a fresh draft with unequal legs is not balanced',
  );

  const v1 = await validation.runValidation(full, actor, draft.id, draft.version);
  t.ok(
    !v1.result.isValid && v1.result.findings.some((f) => f.reasonCode === 'unbalanced'),
    'an unbalanced draft fails validation with a reason code',
  );

  const cur = await drafts.getDraft(full, draft.id);
  const creditLine = cur.lines.find((l) => l.direction === 'credit');
  t.ok(creditLine !== undefined, 'the draft has a credit line to correct');
  const afterEdit = await drafts.updateLine(full, actor, creditLine!.id, creditLine!.version, {
    accountRef: creditLine!.account_ref,
    direction: 'credit',
    amountMinor: 10000,
    currencyRef: currency,
  });
  t.ok(afterEdit.draft.is_balanced, 'correcting the credit balances the draft (debits == credits)');

  const v2 = await validation.runValidation(full, actor, afterEdit.draft.id, afterEdit.draft.version);
  t.ok(
    v2.result.isValid && v2.draftStatus === 'validated',
    'a balanced draft validates and advances to validated',
  );
  t.ok(
    v2.result.findings.some((f) => f.reasonCode === 'balanced'),
    'a valid draft reports the balanced reason code',
  );

  // --- balance evidence recorded (append-only) --------------------------------------------------
  const balances = await db.withTenant(full, (tx) => repo.listDraftBalances(tx, draft.id));
  t.ok(
    balances.length >= 2 && balances.some((b) => b.balanced),
    'balance-invariant evidence is recorded append-only',
  );

  // --- submit for approval (m22) ----------------------------------------------------------------
  const validated = await drafts.getDraft(full, draft.id);
  const submitted = await drafts.submitDraft(full, actor, draft.id, validated.draft.version);
  t.equal(submitted.status, 'submitted', 'a validated, balanced draft submits for approval');

  // --- closed-period rejection ------------------------------------------------------------------
  const closedDraft = await drafts.createDraft(full, actor, {
    entityRef: entity,
    currencyRef: currency,
    periodStatus: 'closed',
    lines: [
      { accountRef: randomUUID(), direction: 'debit', amountMinor: 2000, currencyRef: currency },
      { accountRef: randomUUID(), direction: 'credit', amountMinor: 2000, currencyRef: currency },
    ],
  });
  const vClosed = await validation.runValidation(full, actor, closedDraft.id, closedDraft.version);
  t.ok(
    !vClosed.result.isValid && vClosed.result.findings.some((f) => f.reasonCode === 'closed_period'),
    'a balanced draft in a closed period fails validation (no posting into a closed period)',
  );

  // --- approval-gated posting request + maker != checker (SoD) ----------------------------------
  const preq = await posting.createPostingRequest(full, actor, draft.id, {
    idempotencyKey: `pk-${randomUUID()}`,
  });
  t.equal(preq.status, 'prepared', 'a posting request is prepared for a submitted draft');
  await t.rejects(
    posting.authorizePostingRequest(full, actor, preq.id, preq.version, {
      approvalRef: randomUUID(),
      approvedBy: actor,
    }),
    'the approver must not be the requester (segregation of duties)',
  );
  const authorized = await posting.authorizePostingRequest(full, actor, preq.id, preq.version, {
    approvalRef: randomUUID(),
    approvedBy: approver,
  });
  t.equal(
    authorized.status,
    'ready',
    'recording an m22 approval (by a different actor) marks the request ready',
  );

  // --- posting-result evidence + draft posting terminal + no duplicate posting ------------------
  const posted = await posting.recordPostingResult(full, actor, preq.id, {
    status: 'succeeded',
    externalSystem: 'core-gl',
    externalRef: 'EXT-123',
    idempotencyKey: `res-${randomUUID()}`,
  });
  t.ok(
    posted.request.status === 'succeeded' && posted.result.status === 'succeeded',
    'a succeeded posting result moves the request terminal',
  );
  const postedDraft = await drafts.getDraft(full, draft.id);
  t.equal(postedDraft.draft.status, 'posted', 'the draft is marked posted after a successful posting result');
  await t.rejects(
    posting.createPostingRequest(full, actor, draft.id, {}),
    'a second posting request for an already-posted draft is rejected (no duplicate posting)',
  );

  // --- optimistic concurrency (stale submit rejects) --------------------------------------------
  const draft2 = await drafts.createDraft(full, actor, {
    entityRef: entity,
    currencyRef: currency,
    periodStatus: 'open',
    lines: [
      { accountRef: randomUUID(), direction: 'debit', amountMinor: 100, currencyRef: currency },
      { accountRef: randomUUID(), direction: 'credit', amountMinor: 100, currencyRef: currency },
    ],
  });
  await validation.runValidation(full, actor, draft2.id, draft2.version);
  await t.rejects(
    drafts.submitDraft(full, actor, draft2.id, draft2.version + 99),
    'a stale expectedVersion is rejected (optimistic concurrency)',
  );

  // --- default deny: an actor lacking the permission is refused ---------------------------------
  const noSubmit = ctxOf(ALL_M21_PERMISSIONS.filter((p) => p !== M21_PERMISSIONS.draftSubmit));
  await t.rejects(
    drafts.submitDraft(noSubmit, actor, draft2.id, draft2.version + 1),
    'submitting without the submit permission is refused (default deny)',
  );

  // --- audit + event payloads carry NO raw narrative --------------------------------------------
  const events = outbox.events.filter(
    (e) => e.family === JOURNAL_LIFECYCLE_FAMILY || e.family === POSTING_REQUEST_LIFECYCLE_FAMILY,
  );
  t.ok(
    events.length >= 8,
    'journal.lifecycle + posting_request.lifecycle events were published on the shared outbox',
  );
  t.ok(
    !JSON.stringify(events).includes(SECRET_DESC),
    'no raw journal narrative appears in any event payload (data minimisation)',
  );
  t.ok(
    !JSON.stringify(audit.entries).includes(SECRET_DESC),
    'no raw journal narrative appears in any audit entry (data minimisation)',
  );

  // --- cross-tenant isolation -------------------------------------------------------------------
  const otherTenant: RequestContext = { ...full, tenantId: randomUUID() };
  await t.rejects(
    drafts.getDraft(otherTenant, draft.id),
    "another tenant cannot read this tenant's draft (RLS)",
  );
});
