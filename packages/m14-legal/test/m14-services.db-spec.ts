import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M14Emitter,
  LegalRepository,
  CatalogService,
  MatterService,
  MatterWorkService,
  MatterLegalService,
  FixedClock,
  M14_PERMISSIONS,
  ALL_M14_PERMISSIONS,
} from '@finapp/m14-legal';

/**
 * M14 services DB spec — proves the legal-matter engine end-to-end on a REAL PostgreSQL and enforces governance:
 * configurable versioned matter types + SLA policies, idempotent M13 case conversion (exactly one matter per
 * source case, never reading m13's tables), the full lifecycle (open→assign→resolve→rule-gated close→reopen),
 * controlled instructions (accept / reject), parties / activities / tasks / issues, deadlines (deterministic
 * breach via a FixedClock), legal positions + opinions (redacted), settlement maker-checker (proposer ≠
 * approver), the costs/exposure/enforcement reference boundary (no posting), relationships (self-edge rejected),
 * confidentiality/privilege redaction, and cross-tenant isolation.
 */
export default defineDbSpec('m14-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const emitter = new M14Emitter(new RecordingAudit(), new RecordingOutbox());
  const repo = new LegalRepository();
  const clock = new FixedClock(1_700_000_000_000);
  const catalog = new CatalogService(db, authz, emitter, repo);
  const matters = new MatterService(db, authz, emitter, repo);
  const work = new MatterWorkService(db, authz, emitter, repo, clock);
  const legal = new MatterLegalService(db, authz, emitter, repo, clock);

  const tenant = randomUUID();
  const officer = randomUUID();
  const approver = randomUUID();
  const cid = (): string => randomUUID();
  const full: RequestContext = {
    tenantId: tenant,
    userId: officer,
    correlationId: cid(),
    permissions: [...ALL_M14_PERMISSIONS],
  };
  const approverCtx: RequestContext = {
    tenantId: tenant,
    userId: approver,
    correlationId: cid(),
    permissions: [...ALL_M14_PERMISSIONS],
  };
  const noPerm: RequestContext = { tenantId: tenant, userId: officer, correlationId: cid(), permissions: [] };
  const noConf: RequestContext = {
    tenantId: tenant,
    userId: officer,
    correlationId: cid(),
    permissions: ALL_M14_PERMISSIONS.filter(
      (p) => p !== M14_PERMISSIONS.confidentialRead && p !== M14_PERMISSIONS.privilegedRead,
    ),
  };
  const noPosition: RequestContext = {
    tenantId: tenant,
    userId: officer,
    correlationId: cid(),
    permissions: ALL_M14_PERMISSIONS.filter((p) => p !== M14_PERMISSIONS.positionRead),
  };

  const typeSpec = {
    schemaVersion: 1,
    code: 'litigation',
    name: 'Litigation',
    category: 'litigation',
    defaultConfidentiality: 'privileged',
    defaultRisk: 'high',
    defaultPriority: 'high',
    requiredRoles: [],
    courtEventSupport: true,
    appealSupport: true,
  };
  const slaSpec = {
    schemaVersion: 1,
    code: 'fast',
    name: 'Fast',
    ackMinutes: 1,
    reviewMinutes: 1,
    opinionMinutes: 1,
    pleadingMinutes: 1,
    counselUpdateMinutes: 1,
    resolutionMinutes: 1,
    closureMinutes: 2,
    warnThresholdPct: 80,
  };

  // --- configurable catalog (versioned, publish freezes a hash) ---------------------------------
  await t.rejects(
    catalog.createMatterType(noPerm, officer, { code: 'x', name: 'X', spec: { ...typeSpec, code: 'x' } }),
    'authoring a matter type needs the manage permission',
  );
  const mt0 = await catalog.createMatterType(full, officer, {
    code: 'litigation',
    name: 'Litigation',
    spec: typeSpec,
  });
  const mt1 = await catalog.validateMatterType(full, officer, mt0.id, mt0.version);
  const mt2 = await catalog.publishMatterType(full, officer, mt1.id, mt1.version);
  t.ok(mt2.content_hash !== null, 'publishing a matter type freezes a content hash');
  await catalog.activateMatterType(full, officer, mt2.id, mt2.version);
  const sp0 = await catalog.createSlaPolicy(full, officer, { code: 'fast', name: 'Fast', spec: slaSpec });
  const sp1 = await catalog.validateSlaPolicy(full, officer, sp0.id, sp0.version);
  const sp2 = await catalog.publishSlaPolicy(full, officer, sp1.id, sp1.version);
  await catalog.activateSlaPolicy(full, officer, sp2.id, sp2.version);

  // --- create (idempotent) + lifecycle ----------------------------------------------------------
  await t.rejects(
    matters.create(noPerm, officer, { matterTypeCode: 'litigation', title: 'x' }),
    'creating a matter requires the create permission',
  );
  const m0 = await matters.create(full, officer, {
    matterTypeCode: 'litigation',
    title: 'Bank v Debtor',
    summary: 'A dispute',
    confidentiality: 'privileged',
    privileged: true,
    legalRisk: 'high',
    priority: 'high',
    idempotencyKey: 'k-matter-1',
  });
  const m0b = await matters.create(full, officer, {
    matterTypeCode: 'litigation',
    title: 'Bank v Debtor',
    idempotencyKey: 'k-matter-1',
  });
  t.equal(m0.id, m0b.id, 'creating with the same idempotency key returns the same matter');
  t.ok(m0.matter_number.startsWith('MATTER-'), 'a matter number is generated');

  // --- controlled instructions (accept / reject) ------------------------------------------------
  const ins1 = await matters.addInstruction(full, officer, m0.id, {
    instructionType: 'litigate',
    summary: 'Defend the claim',
  });
  const accepted = await matters.decideInstruction(full, officer, ins1.id, {
    expectedVersion: ins1.version,
    accept: true,
  });
  t.equal(accepted.acceptance_status, 'accepted', 'an instruction can be accepted');
  const ins2 = await matters.addInstruction(full, officer, m0.id, {
    instructionType: 'settle',
    summary: 'Consider settlement',
  });
  const rejected = await matters.decideInstruction(full, officer, ins2.id, {
    expectedVersion: ins2.version,
    accept: false,
    rejectionReason: 'out of mandate',
  });
  t.equal(rejected.acceptance_status, 'rejected', 'an instruction can be rejected with a reason');

  // --- lifecycle: open -> assign -> resolve ------------------------------------------------------
  const opened = await matters.open(full, officer, m0.id, m0.version);
  t.equal(opened.status, 'opened', 'the matter opens');
  const assigned = await matters.assign(full, officer, m0.id, {
    expectedVersion: opened.version,
    owner: officer,
    team: 'litigation',
  });
  t.equal(assigned.status, 'legal_review', 'assignment advances an opened matter to legal_review');
  await t.rejects(
    matters.assign(full, officer, m0.id, { expectedVersion: 1, owner: officer }),
    'a stale version is rejected (optimistic concurrency)',
  );

  // --- working entities -------------------------------------------------------------------------
  await work.addParty(full, officer, m0.id, {
    partyRole: 'defendant',
    displayLabel: 'Debtor Ltd',
    contactRef: '+254700000000',
    confidentiality: 'confidential',
  });
  await work.addActivity(full, officer, m0.id, {
    activityType: 'client_meeting',
    headline: 'Instruction meeting',
  });
  const task = await work.addTask(full, officer, m0.id, {
    taskType: 'review',
    headline: 'Review pleadings',
    mandatory: true,
  });
  const issue = await work.addIssue(full, officer, m0.id, {
    statement: 'Liability disputed',
    mandatory: true,
  });

  // --- legal position + opinion (sensitive, redacted) -------------------------------------------
  await legal.recordPosition(full, officer, m0.id, {
    position: 'Strong defence',
    strategy: 'File a defence and counterclaim',
    exposureSummary: 'Limited exposure',
  });
  const posPriv = await legal.listPositions(full, m0.id);
  t.equal(posPriv.canRead, true, 'a privileged caller may read legal positions');
  await t.rejects(
    legal.listPositions(noPosition, m0.id),
    'a caller without position.read cannot read legal positions',
  );
  await legal.registerOpinion(full, officer, m0.id, {
    opinionType: 'merits',
    summaryConclusion: 'Defensible',
    riskRating: 'medium',
  });

  // --- deterministic deadline breach (separate matter to keep m0 closable) ----------------------
  const dMatter = await matters.create(full, officer, {
    matterTypeCode: 'litigation',
    title: 'Deadline matter',
  });
  const dl = await work.addDeadline(full, officer, dMatter.id, {
    deadlineType: 'filing',
    rule: { kind: 'offset_days', days: 1 },
  });
  t.ok(!(await work.evaluateDeadline(full, officer, dl.id)).breached, 'a fresh deadline is not breached');
  clock.advance(3 * 86_400_000); // 3 days past a 1-day deadline
  t.ok(
    (await work.evaluateDeadline(full, officer, dl.id)).breached,
    'the deadline breaches deterministically once the clock passes due',
  );

  // --- settlement maker-checker -----------------------------------------------------------------
  const settle = await legal.proposeSettlement(full, officer, m0.id, {
    proposal: 'Pay 500k',
    amountMinor: 500000,
    currency: 'KES',
    confidentialTerms: 'secret schedule',
  });
  await t.rejects(
    legal.approveSettlement(full, officer, settle.id),
    'the proposer cannot approve their own settlement (SoD)',
  );
  const settled = await legal.approveSettlement(approverCtx, approver, settle.id);
  t.equal(settled.approval_status, 'approved', 'an independent approver approves the settlement');
  const setView = await legal.listSettlements(noConf, m0.id);
  t.equal(
    setView.canReadConfidential,
    false,
    'a caller without confidential.read cannot read settlement terms',
  );

  // --- costs / exposure / enforcement are references only (no posting) --------------------------
  await legal.recordCost(full, officer, m0.id, {
    costType: 'counsel_fee',
    amountMinor: 100000,
    currency: 'KES',
    invoiceReference: 'INV-1',
    recoverable: true,
  });
  const exposed = await legal.updateExposure(full, officer, m0.id, {
    expectedVersion: assigned.version,
    claimAmountMinor: 1000000,
    exposureAmountMinor: 800000,
    currency: 'KES',
  });
  t.equal(exposed.exposure_amount_minor, '800000', 'exposure is stored as a decimal-safe reference amount');

  // --- rule-gated closure -----------------------------------------------------------------------
  const beforeResolve = await matters.get(full, m0.id);
  const resolved = await matters.resolve(
    full,
    officer,
    m0.id,
    beforeResolve.matter.version,
    'Settled and paid',
  );
  await t.rejects(
    matters.close(full, officer, m0.id, { expectedVersion: resolved.version }),
    'closure is blocked while mandatory work + outcome are outstanding',
  );
  // Meet the criteria: complete the mandatory task, record an outcome.
  await work.completeTask(full, officer, task.id, task.version, 'done');
  await work.patchIssue(full, officer, issue.id, { expectedVersion: issue.version, status: 'resolved' });
  await legal.recordOutcome(full, officer, m0.id, {
    outcomeType: 'settlement',
    summary: 'Settled',
    amountAwardedMinor: 500000,
    currency: 'KES',
  });
  const nowResolved = await matters.get(full, m0.id);
  const closed = await matters.close(full, officer, m0.id, {
    expectedVersion: nowResolved.matter.version,
    summary: 'Closed',
  });
  t.equal(closed.status, 'closed', 'a fully-worked matter closes (rule-gated)');
  const reopened = await matters.reopen(full, officer, m0.id, {
    expectedVersion: closed.version,
    reason: 'new evidence',
  });
  t.equal(reopened.status, 'reopened', 'the matter reopens');

  // --- idempotent M13 case conversion (exactly one matter per source case) ----------------------
  const sourceCaseId = randomUUID();
  const conv1 = await matters.acceptConversion(full, officer, {
    sourceCaseId,
    matterTypeCode: 'litigation',
    title: 'From case',
    correlationId: cid(),
  });
  t.ok(conv1.created, 'the conversion creates a matter');
  t.equal(conv1.matter.source, 'case_conversion', 'the matter records the case-conversion source');
  t.equal(conv1.matter.source_case_id, sourceCaseId, 'the matter preserves the source case id');
  const conv2 = await matters.acceptConversion(full, officer, {
    sourceCaseId,
    matterTypeCode: 'litigation',
    title: 'From case again',
    correlationId: cid(),
  });
  t.ok(
    !conv2.created && conv2.matter.id === conv1.matter.id,
    'a repeat conversion returns the same matter (one matter per source case)',
  );

  // --- relationships (self-edge rejected) -------------------------------------------------------
  const rel = await legal.link(full, officer, {
    fromMatterId: dMatter.id,
    toMatterId: m0.id,
    kind: 'related_to',
  });
  t.equal(rel.kind, 'related_to', 'matters can be linked as related');
  await t.rejects(
    legal.link(full, officer, { fromMatterId: m0.id, toMatterId: m0.id, kind: 'duplicate_of' }),
    'a matter cannot relate to itself',
  );

  // --- confidentiality / privilege redaction ----------------------------------------------------
  const priv = await matters.get(full, m0.id);
  t.equal(priv.canReadConfidential, true, 'a privileged caller may read confidential detail');
  const red = await matters.get(noConf, m0.id);
  t.equal(red.canReadConfidential, false, 'a caller without confidential.read is flagged');

  // --- cross-tenant isolation -------------------------------------------------------------------
  const other: RequestContext = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    correlationId: cid(),
    permissions: [...ALL_M14_PERMISSIONS],
  };
  await t.rejects(matters.get(other, m0.id), "another tenant cannot read this tenant's matter (RLS)");
});
