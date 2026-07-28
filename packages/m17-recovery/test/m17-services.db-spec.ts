import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M17Emitter,
  RecoveryRepository,
  CatalogService,
  RecoveryService,
  RecoveryWorkService,
  FixedClock,
  M17_PERMISSIONS,
  ALL_M17_PERMISSIONS,
} from '@finapp/m17-recovery';

/**
 * M17 services DB spec — proves the recovery & enforcement engine end-to-end on a REAL PostgreSQL and enforces
 * governance: configurable versioned recovery types + SLA policies, idempotent M16 enforcement referral (exactly
 * one recovery per referral key, never reading m16/m14's tables), the full lifecycle (create -> advance ->
 * settled -> rule-gated close -> reopen), debtors/parties, instruments, strategy, demands, negotiations,
 * arrangements with maker-checker approval (approver ≠ proposer), installments (schedule metadata only),
 * enforcement actions, security (registration + realization), agents + reports, receipt REFERENCES (no cash
 * application), waivers, write-off RECOMMENDATION with maker-checker approval (approver ≠ recommender), outcomes,
 * deterministic deadline breach via a FixedClock, relationships (self-edge rejected), SLA materialization,
 * escalation, confidentiality/contact redaction, and cross-tenant isolation.
 */
export default defineDbSpec('m17-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const emitter = new M17Emitter(new RecordingAudit(), new RecordingOutbox());
  const repo = new RecoveryRepository();
  const clock = new FixedClock(1_700_000_000_000);
  const catalog = new CatalogService(db, authz, emitter, repo);
  const recoveries = new RecoveryService(db, authz, emitter, repo);
  const work = new RecoveryWorkService(db, authz, emitter, repo, clock);

  const tenant = randomUUID();
  const officer = randomUUID();
  const approver = randomUUID();
  const cid = (): string => randomUUID();
  const full: RequestContext = {
    tenantId: tenant,
    userId: officer,
    correlationId: cid(),
    permissions: [...ALL_M17_PERMISSIONS],
  };
  const approverCtx: RequestContext = {
    tenantId: tenant,
    userId: approver,
    correlationId: cid(),
    permissions: [...ALL_M17_PERMISSIONS],
  };
  const noPerm: RequestContext = { tenantId: tenant, userId: officer, correlationId: cid(), permissions: [] };
  const noContact: RequestContext = {
    tenantId: tenant,
    userId: officer,
    correlationId: cid(),
    permissions: ALL_M17_PERMISSIONS.filter((p) => p !== M17_PERMISSIONS.partyContactRead),
  };
  const noConf: RequestContext = {
    tenantId: tenant,
    userId: officer,
    correlationId: cid(),
    permissions: ALL_M17_PERMISSIONS.filter((p) => p !== M17_PERMISSIONS.confidentialRead),
  };

  const typeSpec = {
    schemaVersion: 1,
    code: 'judgment_recovery',
    name: 'Judgment Recovery',
    category: 'litigation',
    eligibleInstruments: ['judgment'],
    eligibleStrategies: ['demand', 'enforcement'],
    defaultConfidentiality: 'privileged',
    defaultRisk: 'high',
    defaultPriority: 'high',
    enforcementSupport: true,
  };
  const slaSpec = {
    schemaVersion: 1,
    code: 'fast',
    name: 'Fast',
    ackMinutes: 1,
    strategyMinutes: 1,
    demandMinutes: 1,
    responseMinutes: 1,
    arrangementReviewMinutes: 1,
    enforcementFilingMinutes: 1,
    agentReportMinutes: 1,
    reviewMinutes: 1,
    closureMinutes: 2,
    warnThresholdPct: 80,
  };

  // --- configurable catalog ---------------------------------------------------------------------
  await t.rejects(
    catalog.createRecoveryType(noPerm, officer, { code: 'x', name: 'X', spec: { ...typeSpec, code: 'x' } }),
    'authoring a recovery type needs the manage permission',
  );
  const rt0 = await catalog.createRecoveryType(full, officer, {
    code: 'judgment_recovery',
    name: 'Judgment Recovery',
    spec: typeSpec,
  });
  const rt1 = await catalog.validateRecoveryType(full, officer, rt0.id, rt0.version);
  const rt2 = await catalog.publishRecoveryType(full, officer, rt1.id, rt1.version);
  t.ok(rt2.content_hash !== null, 'publishing a recovery type freezes a content hash');
  await catalog.activateRecoveryType(full, officer, rt2.id, rt2.version);
  const sp0 = await catalog.createSlaPolicy(full, officer, { code: 'fast', name: 'Fast', spec: slaSpec });
  const sp1 = await catalog.validateSlaPolicy(full, officer, sp0.id, sp0.version);
  const sp2 = await catalog.publishSlaPolicy(full, officer, sp1.id, sp1.version);
  await catalog.activateSlaPolicy(full, officer, sp2.id, sp2.version);

  // --- create (idempotent) ----------------------------------------------------------------------
  await t.rejects(
    recoveries.create(noPerm, officer, { recoveryTypeCode: 'judgment_recovery', title: 'x' }),
    'creating a recovery requires the create permission',
  );
  const r0 = await recoveries.create(full, officer, {
    recoveryTypeCode: 'judgment_recovery',
    title: 'Bank v Debtor',
    summary: 'A debt',
    confidentiality: 'privileged',
    privileged: true,
    recoveryRisk: 'high',
    principalAmountMinor: 1000000,
    currency: 'KES',
    idempotencyKey: 'k-rec-1',
  });
  const r0b = await recoveries.create(full, officer, {
    recoveryTypeCode: 'judgment_recovery',
    title: 'Bank v Debtor',
    idempotencyKey: 'k-rec-1',
  });
  t.equal(r0.id, r0b.id, 'creating with the same idempotency key returns the same recovery');
  t.ok(r0.recovery_number.startsWith('REC-'), 'a recovery number is generated');

  // --- assignment (+ stale version) -------------------------------------------------------------
  const assigned = await recoveries.assign(full, officer, r0.id, {
    expectedVersion: r0.version,
    owner: officer,
    team: 'recovery',
  });
  t.equal(assigned.status, 'under_review', 'assignment advances a draft recovery to under_review');
  await t.rejects(
    recoveries.assign(full, officer, r0.id, { expectedVersion: 1, owner: officer }),
    'a stale version is rejected (optimistic concurrency)',
  );

  // --- parties (contact redaction) + strategy ---------------------------------------------------
  await recoveries.addParty(full, officer, r0.id, {
    partyRole: 'principal_debtor',
    displayLabel: 'Debtor Ltd',
    contactRef: '+254700000000',
    confidentiality: 'confidential',
  });
  const partiesPriv = await recoveries.listParties(full, r0.id);
  t.equal(partiesPriv.canReadContact, true, 'a caller with party_contact.read may read contacts');
  const partiesRed = await recoveries.listParties(noContact, r0.id);
  t.equal(partiesRed.canReadContact, false, 'a caller without party_contact.read is flagged');
  const nowR = await recoveries.get(full, r0.id);
  await recoveries.selectStrategy(full, officer, r0.id, {
    expectedVersion: nowR.recovery.version,
    strategy: 'enforcement',
    rationale: 'judgment obtained',
  });

  // --- instrument + demand + negotiation --------------------------------------------------------
  await work.registerInstrument(full, officer, r0.id, {
    instrumentType: 'judgment',
    reference: 'HCCC-1',
    faceAmountMinor: 1000000,
    currency: 'KES',
  });
  const demand = await work.issueDemand(full, officer, r0.id, {
    demandType: 'statutory_demand',
    amountDemandedMinor: 1000000,
    currency: 'KES',
  });
  await work.respondDemand(full, officer, demand.id, {
    expectedVersion: demand.version,
    responseStatus: 'disputed',
  });
  const neg = await work.openNegotiation(full, officer, r0.id, {
    offeredAmountMinor: 600000,
    currency: 'KES',
  });
  await work.closeNegotiation(full, officer, neg.id, { expectedVersion: neg.version, outcome: 'failed' });

  // --- arrangement maker-checker ----------------------------------------------------------------
  const arr = await work.proposeArrangement(full, officer, r0.id, {
    arrangementType: 'installment',
    totalAmountMinor: 1000000,
    installmentCount: 4,
    installmentAmountMinor: 250000,
    currency: 'KES',
  });
  await t.rejects(
    work.approveArrangement(full, officer, arr.id, arr.version),
    'the proposer cannot approve their own arrangement (maker-checker)',
  );
  const arrApproved = await work.approveArrangement(approverCtx, approver, arr.id, arr.version);
  t.equal(arrApproved.status, 'active', 'an independent approver activates the arrangement');
  const inst = await work.addInstallment(full, officer, arr.id, {
    recoveryId: r0.id,
    sequenceNumber: 1,
    dueDate: '2026-09-01',
    expectedAmountMinor: 250000,
    currency: 'KES',
  });
  const instRec = await work.recordInstallment(full, officer, inst.id, {
    expectedVersion: inst.version,
    status: 'met',
  });
  t.equal(instRec.status, 'met', 'an installment can be recorded as met (schedule metadata)');

  // --- enforcement + security -------------------------------------------------------------------
  const enf = await work.initiateEnforcement(full, officer, r0.id, {
    actionType: 'garnishee',
    reference: 'GARN-1',
    expectedAmountMinor: 400000,
    currency: 'KES',
  });
  await work.completeEnforcement(full, officer, enf.id, { expectedVersion: enf.version, outcome: 'partial' });
  const sec = await work.registerSecurity(full, officer, r0.id, {
    securityType: 'motor_vehicle',
    description: 'Truck',
    estimatedValueMinor: 800000,
    currency: 'KES',
  });
  const secReal = await work.realizeSecurity(full, officer, sec.id, {
    expectedVersion: sec.version,
    realizedAmountMinor: 500000,
    realizedDate: '2026-09-15',
  });
  t.equal(secReal.status, 'realized', 'security realization records a reference amount');

  // --- agent + report + receipt (reference only) + waiver ---------------------------------------
  const agent = await work.instructAgent(full, officer, r0.id, {
    agentRef: 'AGENCY-1',
    agentType: 'debt_collector',
  });
  await work.addAgentReport(full, officer, r0.id, {
    agentId: agent.id,
    statusSummary: 'contact made',
    amountCollectedMinor: 100000,
    currency: 'KES',
  });
  const receipt = await work.recordReceipt(full, officer, r0.id, {
    receiptType: 'bank_transfer',
    externalReference: 'TXN-99',
    amountMinor: 250000,
    currency: 'KES',
    financeReference: 'AR-REF-1',
  });
  t.ok(receipt.id !== '', 'a recovery receipt reference is recorded (no cash application)');
  await work.grantWaiver(full, officer, r0.id, {
    waiverType: 'interest',
    amountMinor: 50000,
    currency: 'KES',
    reason: 'goodwill',
    authority: 'head_of_recovery',
  });

  // --- write-off recommendation maker-checker ---------------------------------------------------
  const wo = await work.recommendWriteOff(full, officer, r0.id, {
    reasonCode: 'cost_exceeds_recovery',
    amountMinor: 150000,
    currency: 'KES',
    narrative: 'residual',
  });
  await t.rejects(
    work.approveWriteOff(full, officer, wo.id, { expectedVersion: wo.version }),
    'the recommender cannot approve their own write-off (maker-checker)',
  );
  const woApproved = await work.approveWriteOff(approverCtx, approver, wo.id, {
    expectedVersion: wo.version,
  });
  t.equal(
    woApproved.approval_status,
    'approved',
    'an independent approver approves the write-off recommendation',
  );

  // --- deterministic deadline breach (FixedClock) -----------------------------------------------
  const dl = await work.addDeadline(full, officer, r0.id, {
    deadlineType: 'demand_response',
    rule: { kind: 'offset_days', days: 1 },
  });
  t.ok(!(await work.evaluateDeadline(full, officer, dl.id)).breached, 'a fresh deadline is not breached');
  clock.advance(3 * 86_400_000);
  t.ok(
    (await work.evaluateDeadline(full, officer, dl.id)).breached,
    'the deadline breaches deterministically once the clock passes due',
  );

  // --- SLA + escalation -------------------------------------------------------------------------
  const slaDeadlines = await work.startSla(full, officer, r0.id, 'fast');
  t.ok(slaDeadlines.length >= 1, 'starting SLA materializes stage deadlines');
  const escRef = await work.triggerEscalation(full, officer, r0.id, { reason: 'critical recovery risk' });
  t.ok(
    typeof escRef === 'string' && escRef.length > 0,
    'escalation records a reference + publishes an event',
  );

  // --- idempotent M16 referral (exactly one recovery per referral key) --------------------------
  const referralKey = `ref-${randomUUID()}`;
  const sourceProceedingId = randomUUID();
  const ref1 = await recoveries.acceptReferral(full, officer, {
    referralKey,
    sourceProceedingId,
    recoveryTypeCode: 'judgment_recovery',
    title: 'From proceeding',
    correlationId: cid(),
  });
  t.ok(ref1.created, 'the referral creates a recovery');
  t.equal(
    ref1.recovery.source,
    'enforcement_referral',
    'the recovery records the enforcement-referral source',
  );
  t.equal(
    ref1.recovery.source_proceeding_id,
    sourceProceedingId,
    'the recovery preserves the source proceeding id',
  );
  const ref2 = await recoveries.acceptReferral(full, officer, {
    referralKey,
    sourceProceedingId,
    recoveryTypeCode: 'judgment_recovery',
    title: 'Again',
    correlationId: cid(),
  });
  t.ok(
    !ref2.created && ref2.recovery.id === ref1.recovery.id,
    'a repeat referral returns the same recovery (one per referral key)',
  );
  const ref3 = await recoveries.acceptReferral(full, officer, {
    referralKey: `ref-${randomUUID()}`,
    sourceProceedingId,
    recoveryTypeCode: 'judgment_recovery',
    title: 'Second recovery',
    correlationId: cid(),
  });
  t.ok(
    ref3.created && ref3.recovery.id !== ref1.recovery.id,
    'a fresh referral key from the same proceeding yields a new recovery',
  );

  // --- relationships (self-edge rejected) -------------------------------------------------------
  const rel = await work.link(full, officer, {
    fromRecoveryId: ref1.recovery.id,
    toRecoveryId: r0.id,
    kind: 'related_to',
  });
  t.equal(rel.kind, 'related_to', 'recoveries can be linked as related');
  await t.rejects(
    work.link(full, officer, { fromRecoveryId: r0.id, toRecoveryId: r0.id, kind: 'duplicate_of' }),
    'a recovery cannot relate to itself',
  );

  // --- rule-gated close on a fresh recovery -----------------------------------------------------
  const c0 = await recoveries.create(full, officer, {
    recoveryTypeCode: 'judgment_recovery',
    title: 'Closeable',
  });
  let cur = c0;
  for (const to of ['referred', 'strategy_selection', 'negotiation', 'settled']) {
    cur = await recoveries.advance(full, officer, c0.id, to, cur.version);
  }
  t.equal(cur.status, 'settled', 'the recovery advances to settled through the lifecycle');
  await t.rejects(
    recoveries.close(full, officer, c0.id, { expectedVersion: cur.version }),
    'closure is blocked while an outcome is outstanding',
  );
  await work.recordOutcome(full, officer, c0.id, {
    outcomeType: 'settled',
    summary: 'Settled',
    recoveredAmountMinor: 600000,
    currency: 'KES',
  });
  const nowCur = await recoveries.get(full, c0.id);
  const closed = await recoveries.close(full, officer, c0.id, {
    expectedVersion: nowCur.recovery.version,
    summary: 'Closed',
  });
  t.equal(closed.status, 'closed', 'a fully-worked recovery closes (rule-gated)');
  const reopened = await recoveries.reopen(full, officer, c0.id, {
    expectedVersion: closed.version,
    reason: 'new asset traced',
  });
  t.equal(reopened.status, 'reopened', 'the recovery reopens');

  // --- confidentiality redaction ----------------------------------------------------------------
  const priv = await recoveries.get(full, r0.id);
  t.equal(priv.canReadConfidential, true, 'a privileged caller may read confidential detail');
  const red = await recoveries.get(noConf, r0.id);
  t.equal(red.canReadConfidential, false, 'a caller without confidential.read is flagged');

  // --- cross-tenant isolation -------------------------------------------------------------------
  const other: RequestContext = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    correlationId: cid(),
    permissions: [...ALL_M17_PERMISSIONS],
  };
  await t.rejects(recoveries.get(other, r0.id), "another tenant cannot read this tenant's recovery (RLS)");
});
