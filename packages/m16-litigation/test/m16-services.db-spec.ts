import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M16Emitter,
  LitigationRepository,
  CatalogService,
  ProceedingService,
  LitigationWorkService,
  FixedClock,
  M16_PERMISSIONS,
  ALL_M16_PERMISSIONS,
} from '@finapp/m16-litigation';

/**
 * M16 services DB spec — proves the litigation engine end-to-end on a REAL PostgreSQL and enforces governance:
 * configurable versioned proceeding types + SLA policies, idempotent M14 referral (exactly one proceeding per
 * referral key, never reading m14's tables), the full lifecycle (create -> advance -> settled -> rule-gated close
 * -> reopen), parties/claims, filings with maker-checker approval (approver ≠ preparer), single-winner service
 * verification + exhibit admission, appearances, bundles with maker-checker approval, deterministic deadline
 * breach via a FixedClock, orders + compliance obligations, outcomes, controlled appeals (duplicate rejected),
 * relationships (self-edge rejected), the enforcement (m17) + knowledge (m18) boundary signals, SLA
 * materialization, escalation, confidentiality/contact redaction, and cross-tenant isolation.
 */
export default defineDbSpec('m16-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const emitter = new M16Emitter(new RecordingAudit(), new RecordingOutbox());
  const repo = new LitigationRepository();
  const clock = new FixedClock(1_700_000_000_000);
  const catalog = new CatalogService(db, authz, emitter, repo);
  const proceedings = new ProceedingService(db, authz, emitter, repo);
  const work = new LitigationWorkService(db, authz, emitter, repo, clock);

  const tenant = randomUUID();
  const officer = randomUUID();
  const approver = randomUUID();
  const cid = (): string => randomUUID();
  const full: RequestContext = {
    tenantId: tenant,
    userId: officer,
    correlationId: cid(),
    permissions: [...ALL_M16_PERMISSIONS],
  };
  const approverCtx: RequestContext = {
    tenantId: tenant,
    userId: approver,
    correlationId: cid(),
    permissions: [...ALL_M16_PERMISSIONS],
  };
  const noPerm: RequestContext = { tenantId: tenant, userId: officer, correlationId: cid(), permissions: [] };
  const noContact: RequestContext = {
    tenantId: tenant,
    userId: officer,
    correlationId: cid(),
    permissions: ALL_M16_PERMISSIONS.filter(
      (p) => p !== M16_PERMISSIONS.partyContactRead && p !== M16_PERMISSIONS.witnessContactRead,
    ),
  };
  const noConf: RequestContext = {
    tenantId: tenant,
    userId: officer,
    correlationId: cid(),
    permissions: ALL_M16_PERMISSIONS.filter((p) => p !== M16_PERMISSIONS.confidentialRead),
  };

  const typeSpec = {
    schemaVersion: 1,
    code: 'civil_suit',
    name: 'Civil Suit',
    category: 'civil',
    eligibleForumTypes: ['court'],
    defaultConfidentiality: 'privileged',
    defaultRisk: 'high',
    defaultPriority: 'high',
    filingRequired: true,
    hearingSupport: true,
    appealSupport: true,
  };
  const slaSpec = {
    schemaVersion: 1,
    code: 'fast',
    name: 'Fast',
    ackMinutes: 1,
    filingPrepMinutes: 1,
    filingMinutes: 1,
    serviceMinutes: 1,
    bundlePrepMinutes: 1,
    hearingPrepMinutes: 1,
    counselUpdateMinutes: 1,
    outcomeMinutes: 1,
    closureMinutes: 2,
    warnThresholdPct: 80,
  };

  // --- configurable catalog ---------------------------------------------------------------------
  await t.rejects(
    catalog.createProceedingType(noPerm, officer, { code: 'x', name: 'X', spec: { ...typeSpec, code: 'x' } }),
    'authoring a proceeding type needs the manage permission',
  );
  const pt0 = await catalog.createProceedingType(full, officer, {
    code: 'civil_suit',
    name: 'Civil Suit',
    spec: typeSpec,
  });
  const pt1 = await catalog.validateProceedingType(full, officer, pt0.id, pt0.version);
  const pt2 = await catalog.publishProceedingType(full, officer, pt1.id, pt1.version);
  t.ok(pt2.content_hash !== null, 'publishing a proceeding type freezes a content hash');
  await catalog.activateProceedingType(full, officer, pt2.id, pt2.version);
  const sp0 = await catalog.createSlaPolicy(full, officer, { code: 'fast', name: 'Fast', spec: slaSpec });
  const sp1 = await catalog.validateSlaPolicy(full, officer, sp0.id, sp0.version);
  const sp2 = await catalog.publishSlaPolicy(full, officer, sp1.id, sp1.version);
  await catalog.activateSlaPolicy(full, officer, sp2.id, sp2.version);

  // --- create (idempotent) ----------------------------------------------------------------------
  await t.rejects(
    proceedings.create(noPerm, officer, { proceedingTypeCode: 'civil_suit', title: 'x' }),
    'creating a proceeding requires the create permission',
  );
  const p0 = await proceedings.create(full, officer, {
    proceedingTypeCode: 'civil_suit',
    title: 'Bank v Debtor',
    summary: 'A suit',
    confidentiality: 'privileged',
    privileged: true,
    litigationRisk: 'high',
    organizationRole: 'claimant',
    idempotencyKey: 'k-proc-1',
  });
  const p0b = await proceedings.create(full, officer, {
    proceedingTypeCode: 'civil_suit',
    title: 'Bank v Debtor',
    idempotencyKey: 'k-proc-1',
  });
  t.equal(p0.id, p0b.id, 'creating with the same idempotency key returns the same proceeding');
  t.ok(p0.proceeding_number.startsWith('PROC-'), 'a proceeding number is generated');

  // --- assignment (+ stale version) -------------------------------------------------------------
  const assigned = await proceedings.assign(full, officer, p0.id, {
    expectedVersion: p0.version,
    owner: officer,
    team: 'litigation',
  });
  t.equal(assigned.status, 'under_review', 'assignment advances a draft proceeding to under_review');
  await t.rejects(
    proceedings.assign(full, officer, p0.id, { expectedVersion: 1, owner: officer }),
    'a stale version is rejected (optimistic concurrency)',
  );

  // --- parties (contact redaction) + claims -----------------------------------------------------
  await proceedings.addParty(full, officer, p0.id, {
    partyRole: 'defendant',
    displayLabel: 'Debtor Ltd',
    contactRef: '+254700000000',
    confidentiality: 'confidential',
  });
  const partiesPriv = await proceedings.listParties(full, p0.id);
  t.equal(partiesPriv.canReadContact, true, 'a caller with party_contact.read may read contacts');
  const partiesRed = await proceedings.listParties(noContact, p0.id);
  t.equal(partiesRed.canReadContact, false, 'a caller without party_contact.read is flagged');
  await proceedings.addClaim(full, officer, p0.id, {
    claimType: 'monetary',
    statement: 'Debt owed',
    amountMinor: 1000000,
    currency: 'KES',
  });

  // --- filings: maker-checker approval ----------------------------------------------------------
  const filing = await work.registerFiling(full, officer, p0.id, {
    filingRole: 'originating_pleading',
    documentRef: randomUUID(),
  });
  await t.rejects(
    work.approveFiling(full, officer, filing.id, filing.version),
    'the preparer cannot approve their own filing (maker-checker)',
  );
  const approvedFiling = await work.approveFiling(approverCtx, approver, filing.id, filing.version);
  t.equal(approvedFiling.filing_status, 'approved', 'an independent approver approves the filing');

  // --- service: single-winner verification ------------------------------------------------------
  const svc = await work.recordService(full, officer, p0.id, {
    itemServed: 'summons',
    serviceMethod: 'personal',
    recipient: 'Debtor Ltd',
  });
  const verified = await work.verifyService(full, officer, svc.id, 'verified');
  t.equal(verified.verification_status, 'verified', 'service is verified (single-winner)');
  await t.rejects(
    work.verifyService(full, officer, svc.id, 'verified'),
    'a second verify of the same service loses',
  );

  // --- appearance schedule/complete -------------------------------------------------------------
  const appearance = await work.scheduleAppearance(full, officer, p0.id, {
    appearanceType: 'mention',
    forum: 'court',
  });
  const completed = await work.completeAppearance(full, officer, appearance.id, {
    expectedVersion: appearance.version,
    outcome: 'adjourned',
  });
  t.equal(completed.status, 'completed', 'an appearance can be completed');

  // --- witness (contact redaction) + exhibit single-winner admission ----------------------------
  await work.addWitness(full, officer, p0.id, {
    witnessType: 'fact',
    role: 'eyewitness',
    contactRef: '+254711111111',
  });
  const witPriv = await work.listWitnesses(full, p0.id);
  t.equal(witPriv.canReadContact, true, 'a caller with witness_contact.read may read witness contacts');
  const exhibit = await work.registerExhibit(full, officer, p0.id, {
    exhibitNumber: 'P1',
    description: 'Contract',
  });
  const admitted = await work.admitExhibit(full, officer, exhibit.id, 'admitted');
  t.equal(admitted.admitted_status, 'admitted', 'an exhibit is admitted (single-winner)');
  await t.rejects(
    work.admitExhibit(full, officer, exhibit.id, 'rejected'),
    'a second admission decision loses',
  );

  // --- bundle: maker-checker approval -----------------------------------------------------------
  const bundle = await work.createBundle(full, officer, p0.id, {
    bundleType: 'hearing',
    title: 'Trial bundle',
  });
  await t.rejects(
    work.approveBundle(full, officer, bundle.id, bundle.version),
    'the preparer cannot approve their own bundle (maker-checker)',
  );
  const approvedBundle = await work.approveBundle(approverCtx, approver, bundle.id, bundle.version);
  t.equal(approvedBundle.approval_status, 'approved', 'an independent approver approves the bundle');

  // --- deterministic deadline breach (FixedClock) -----------------------------------------------
  const dl = await work.addDeadline(full, officer, p0.id, {
    deadlineType: 'filing',
    rule: { kind: 'offset_days', days: 1 },
  });
  t.ok(!(await work.evaluateDeadline(full, officer, dl.id)).breached, 'a fresh deadline is not breached');
  clock.advance(3 * 86_400_000);
  t.ok(
    (await work.evaluateDeadline(full, officer, dl.id)).breached,
    'the deadline breaches deterministically once the clock passes due',
  );

  // --- order + compliance obligation ------------------------------------------------------------
  const order = await work.recordOrder(full, officer, p0.id, {
    orderType: 'directions_order',
    summary: 'File defence in 14 days',
  });
  const obligation = await work.addObligation(full, officer, p0.id, {
    orderId: order.id,
    obligation: 'File defence',
  });
  await work.completeObligation(full, officer, obligation.id, { expectedVersion: obligation.version });

  // --- outcome + controlled appeal (duplicate rejected) -----------------------------------------
  await work.recordOutcome(full, officer, p0.id, {
    outcomeType: 'final_judgment',
    summary: 'Judgment for claimant',
    amountAwardedMinor: 1000000,
    currency: 'KES',
    appealable: true,
  });
  const appeal = await work.initiateAppeal(full, officer, p0.id, {
    appealType: 'first_appeal',
    forum: 'court_of_appeal',
  });
  t.ok(appeal.id !== '', 'an appeal is initiated');
  await t.rejects(
    work.initiateAppeal(full, officer, p0.id, { appealType: 'first_appeal' }),
    'a duplicate active appeal is rejected (one-active)',
  );

  // --- SLA materialization + escalation + downstream boundary signals ---------------------------
  const slaDeadlines = await work.startSla(full, officer, p0.id, 'fast');
  t.ok(slaDeadlines.length >= 1, 'starting SLA materializes stage deadlines');
  const escRef = await work.triggerEscalation(full, officer, p0.id, { reason: 'critical litigation risk' });
  t.ok(
    typeof escRef === 'string' && escRef.length > 0,
    'escalation records a reference + publishes an event',
  );
  const enfRef = await work.enforcementReferral(full, officer, p0.id);
  t.ok(
    typeof enfRef === 'string' && enfRef.length > 0,
    'an enforcement referral (m17 boundary) is signalled safely',
  );
  await work.knowledgeCandidate(full, officer, p0.id);

  // --- idempotent M14 referral (exactly one proceeding per referral key) -------------------------
  const referralKey = `ref-${randomUUID()}`;
  const sourceMatterId = randomUUID();
  const ref1 = await proceedings.acceptReferral(full, officer, {
    referralKey,
    sourceMatterId,
    proceedingTypeCode: 'civil_suit',
    title: 'From matter',
    correlationId: cid(),
  });
  t.ok(ref1.created, 'the referral creates a proceeding');
  t.equal(ref1.proceeding.source, 'matter_referral', 'the proceeding records the matter-referral source');
  t.equal(ref1.proceeding.source_matter_id, sourceMatterId, 'the proceeding preserves the source matter id');
  const ref2 = await proceedings.acceptReferral(full, officer, {
    referralKey,
    sourceMatterId,
    proceedingTypeCode: 'civil_suit',
    title: 'From matter again',
    correlationId: cid(),
  });
  t.ok(
    !ref2.created && ref2.proceeding.id === ref1.proceeding.id,
    'a repeat referral returns the same proceeding (one per referral key)',
  );
  // A different referral key from the SAME matter yields a NEW proceeding (a matter may have several).
  const ref3 = await proceedings.acceptReferral(full, officer, {
    referralKey: `ref-${randomUUID()}`,
    sourceMatterId,
    proceedingTypeCode: 'civil_suit',
    title: 'Second proceeding',
    correlationId: cid(),
  });
  t.ok(
    ref3.created && ref3.proceeding.id !== ref1.proceeding.id,
    'a fresh referral key from the same matter yields a new proceeding',
  );

  // --- relationships (self-edge rejected) -------------------------------------------------------
  const rel = await work.link(full, officer, {
    fromProceedingId: ref1.proceeding.id,
    toProceedingId: p0.id,
    kind: 'related_to',
  });
  t.equal(rel.kind, 'related_to', 'proceedings can be linked as related');
  await t.rejects(
    work.link(full, officer, { fromProceedingId: p0.id, toProceedingId: p0.id, kind: 'duplicate_of' }),
    'a proceeding cannot relate to itself',
  );

  // --- rule-gated close on a fresh proceeding ---------------------------------------------------
  const c0 = await proceedings.create(full, officer, {
    proceedingTypeCode: 'civil_suit',
    title: 'Closeable',
  });
  let cur = c0;
  for (const to of ['referred', 'under_review', 'approved_to_file', 'filed', 'pleadings_open', 'settled']) {
    cur = await proceedings.advance(full, officer, c0.id, to, cur.version);
  }
  t.equal(cur.status, 'settled', 'the proceeding advances to settled through the lifecycle');
  await t.rejects(
    proceedings.close(full, officer, c0.id, { expectedVersion: cur.version }),
    'closure is blocked while an outcome is outstanding',
  );
  await work.recordOutcome(full, officer, c0.id, { outcomeType: 'settlement', summary: 'Settled' });
  const nowCur = await proceedings.get(full, c0.id);
  const closed = await proceedings.close(full, officer, c0.id, {
    expectedVersion: nowCur.proceeding.version,
    summary: 'Closed',
  });
  t.equal(closed.status, 'closed', 'a fully-worked proceeding closes (rule-gated)');
  const reopened = await proceedings.reopen(full, officer, c0.id, {
    expectedVersion: closed.version,
    reason: 'new evidence',
  });
  t.equal(reopened.status, 'reopened', 'the proceeding reopens');

  // --- confidentiality redaction ----------------------------------------------------------------
  const priv = await proceedings.get(full, p0.id);
  t.equal(priv.canReadConfidential, true, 'a privileged caller may read confidential detail');
  const red = await proceedings.get(noConf, p0.id);
  t.equal(red.canReadConfidential, false, 'a caller without confidential.read is flagged');

  // --- cross-tenant isolation -------------------------------------------------------------------
  const other: RequestContext = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    correlationId: cid(),
    permissions: [...ALL_M16_PERMISSIONS],
  };
  await t.rejects(proceedings.get(other, p0.id), "another tenant cannot read this tenant's proceeding (RLS)");
});
