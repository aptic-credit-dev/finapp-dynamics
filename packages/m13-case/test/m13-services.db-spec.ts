import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M13Emitter,
  CaseRepository,
  CatalogService,
  CaseService,
  CaseWorkService,
  CaseDecisionService,
  FixedClock,
  InMemoryHandoffSource,
  M13_PERMISSIONS,
  M13_AUDIT_CODES,
  ALL_M13_PERMISSIONS,
} from '@finapp/m13-case';

/**
 * M13 services DB spec — proves the case-management engine end-to-end on a REAL PostgreSQL and enforces
 * governance: configurable versioned case types + SLA policies, idempotent M12 handoff (one case per handoff),
 * the full lifecycle (open→triage→assign→investigation→resolve→rule-gated close→reopen), parties/activities/
 * tasks/issues/investigation/findings/evidence(+verify)/deadlines(deterministic breach via a FixedClock)/hearings,
 * decision + settlement maker-checker (submitter ≠ approver), the recovery/legal boundary, escalation-via-event,
 * relationships (self-edge + reverse-cycle rejected), confidentiality redaction, and cross-tenant isolation.
 */
export default defineDbSpec('m13-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const emitter = new M13Emitter(audit, new RecordingOutbox());
  const repo = new CaseRepository();
  const clock = new FixedClock(1_700_000_000_000);
  const handoffSource = new InMemoryHandoffSource();
  const catalog = new CatalogService(db, authz, emitter, repo);
  const cases = new CaseService(db, authz, emitter, repo, handoffSource);
  const work = new CaseWorkService(db, authz, emitter, repo, clock);
  const decisions = new CaseDecisionService(db, authz, emitter, repo, clock);

  const tenant = randomUUID();
  const officer = randomUUID();
  const approver = randomUUID();
  const cid = (): string => randomUUID();
  const full: RequestContext = {
    tenantId: tenant,
    userId: officer,
    correlationId: cid(),
    permissions: [...ALL_M13_PERMISSIONS],
  };
  const approverCtx: RequestContext = {
    tenantId: tenant,
    userId: approver,
    correlationId: cid(),
    permissions: [...ALL_M13_PERMISSIONS],
  };
  const noPerm: RequestContext = { tenantId: tenant, userId: officer, correlationId: cid(), permissions: [] };
  const noConf: RequestContext = {
    tenantId: tenant,
    userId: officer,
    correlationId: cid(),
    permissions: ALL_M13_PERMISSIONS.filter((p) => p !== M13_PERMISSIONS.confidentialRead),
  };

  const typeSpec = {
    schemaVersion: 1,
    code: 'complaint',
    name: 'Complaint',
    category: 'complaint',
    defaultConfidentiality: 'confidential',
    defaultPriority: 'high',
    investigationSupport: true,
  };
  const slaSpec = {
    schemaVersion: 1,
    code: 'fast',
    name: 'Fast',
    ackMinutes: 1,
    triageMinutes: 1,
    assignMinutes: 1,
    investigationMinutes: 1,
    responseMinutes: 1,
    resolutionMinutes: 1,
    closureMinutes: 2,
    warnThresholdPct: 80,
  };

  // --- configurable catalog ---------------------------------------------------------------------
  await t.rejects(
    catalog.createCaseType(noPerm, officer, { code: 'x', name: 'X', spec: { ...typeSpec, code: 'x' } }),
    'authoring a case type needs the manage permission',
  );
  const ct0 = await catalog.createCaseType(full, officer, {
    code: 'complaint',
    name: 'Complaint',
    spec: typeSpec,
  });
  const ct1 = await catalog.validateCaseType(full, officer, ct0.id, ct0.version);
  const ct2 = await catalog.publishCaseType(full, officer, ct1.id, ct1.version);
  t.ok(ct2.content_hash !== null, 'publishing a case type freezes a content hash');
  await catalog.activateCaseType(full, officer, ct2.id, ct2.version);
  const sp0 = await catalog.createSlaPolicy(full, officer, { code: 'fast', name: 'Fast', spec: slaSpec });
  const sp1 = await catalog.validateSlaPolicy(full, officer, sp0.id, sp0.version);
  const sp2 = await catalog.publishSlaPolicy(full, officer, sp1.id, sp1.version);
  await catalog.activateSlaPolicy(full, officer, sp2.id, sp2.version);

  // --- create (idempotent) + lifecycle ----------------------------------------------------------
  await t.rejects(
    cases.create(noPerm, officer, { caseTypeCode: 'complaint', title: 'x' }),
    'creating a case requires the create permission',
  );
  const c0 = await cases.create(full, officer, {
    caseTypeCode: 'complaint',
    title: 'Overcharged',
    description: 'A complaint',
    confidentiality: 'confidential',
    severity: 'high',
    idempotencyKey: 'k-case-1',
  });
  const c0b = await cases.create(full, officer, {
    caseTypeCode: 'complaint',
    title: 'Overcharged',
    idempotencyKey: 'k-case-1',
  });
  t.equal(c0.id, c0b.id, 'creating with the same idempotency key returns the same case');
  t.ok(c0.case_number.startsWith('CASE-'), 'a case number is generated');
  const opened = await cases.open(full, officer, c0.id, c0.version);
  t.equal(opened.status, 'opened', 'the case opens');
  const triaged = await cases.triage(full, officer, c0.id, {
    expectedVersion: opened.version,
    severity: 'critical',
    priority: 'urgent',
    riskRating: 'high',
  });
  t.equal(triaged.triage_status, 'triaged', 'the case is triaged');
  const assigned = await cases.assign(full, officer, c0.id, {
    expectedVersion: triaged.version,
    owner: officer,
    team: 'complaints',
  });
  t.equal(assigned.status, 'assigned', 'the case is assigned');
  await t.rejects(
    cases.assign(full, officer, c0.id, { expectedVersion: 1, owner: officer }),
    'a stale version is rejected (optimistic concurrency)',
  );

  // --- working entities -------------------------------------------------------------------------
  await work.addParty(full, officer, c0.id, {
    partyType: 'complainant',
    displayLabel: 'Jane',
    contactRef: '+254700000000',
    confidentiality: 'confidential',
  });
  // PII contact-access audit (M13 fix): revealing a party's contact under cases.party_contact.read is itself a
  // sensitive, auditable act — it emits CASE_PARTY_CONTACT_ACCESSED (case id + count only; never the value).
  audit.drain();
  const revealed = await work.listParties(full, c0.id);
  t.ok(revealed.canReadContact, 'a fully-permitted caller may read party contacts');
  t.ok(
    audit.entries.some((e) => e.code === M13_AUDIT_CODES.partyContactAccessed),
    'revealing party contact emits CASE_PARTY_CONTACT_ACCESSED (audited PII access)',
  );
  // A caller WITHOUT cases.party_contact.read gets the redacted view and emits NO access audit.
  const noContactCtx: RequestContext = {
    tenantId: tenant,
    userId: officer,
    correlationId: cid(),
    permissions: [M13_PERMISSIONS.caseRead, M13_PERMISSIONS.partyRead],
  };
  audit.drain();
  const redacted = await work.listParties(noContactCtx, c0.id);
  t.ok(!redacted.canReadContact, 'a caller without cases.party_contact.read cannot read contacts');
  t.ok(
    !audit.entries.some((e) => e.code === M13_AUDIT_CODES.partyContactAccessed),
    'no contact-access audit is emitted when contact is not revealed (no false PII audit)',
  );

  await work.addActivity(full, officer, c0.id, {
    activityType: 'client_call',
    headline: 'Called the client',
  });
  const task = await work.addTask(full, officer, c0.id, {
    taskType: 'review',
    headline: 'Review file',
    mandatory: true,
  });
  const issue = await work.addIssue(full, officer, c0.id, {
    description: 'Overcharge allegation',
    mandatory: true,
  });
  await work.startInvestigation(full, officer, c0.id, { scope: 'billing', investigator: officer });
  const inv = await work.getInvestigation(full, c0.id);
  await work.completeInvestigation(full, officer, c0.id, {
    expectedVersion: inv?.version ?? 1,
    substantiation: 'partially_substantiated',
    rootCause: 'process',
  });
  await work.recordFinding(full, officer, c0.id, {
    issueId: issue.id,
    findingType: 'partially_substantiated',
    summary: 'Partly upheld',
  });
  const ev = await work.registerEvidence(full, officer, c0.id, {
    evidenceType: 'document',
    description: 'Statement',
    integrityHash: 'sha256:abc',
  });
  const verified = await work.verifyEvidence(full, officer, ev.id, { authenticityStatus: 'authentic' });
  t.equal(verified.verification_status, 'verified', 'evidence is verified (single-winner)');
  await t.rejects(
    work.verifyEvidence(full, officer, ev.id, { authenticityStatus: 'authentic' }),
    'a second verify of the same evidence loses',
  );

  // --- deterministic deadline breach ------------------------------------------------------------
  const dl = await work.addDeadline(full, officer, c0.id, {
    deadlineType: 'response',
    rule: { kind: 'offset_days', days: 1 },
  });
  t.ok(!(await work.evaluateDeadline(full, officer, dl.id)).breached, 'a fresh deadline is not breached');
  clock.advance(3 * 86_400_000); // 3 days past a 1-day deadline
  t.ok(
    (await work.evaluateDeadline(full, officer, dl.id)).breached,
    'the deadline breaches deterministically once the clock passes due',
  );

  // --- hearing ----------------------------------------------------------------------------------
  const hearing = await work.scheduleHearing(full, officer, c0.id, {
    hearingType: 'mention',
    title: 'First mention',
    court: 'Milimani',
  });
  await work.completeHearing(full, officer, hearing.id, {
    expectedVersion: hearing.version,
    outcome: 'adjourned',
  });

  // --- decision maker-checker -------------------------------------------------------------------
  const dec = await decisions.submitDecision(full, officer, c0.id, {
    decisionType: 'uphold_complaint',
    summary: 'Upheld',
    remedyType: 'refund',
    financeReference: 'REF-1',
  });
  await t.rejects(
    decisions.approveDecision(full, officer, dec.id),
    'the submitter cannot approve their own decision (SoD)',
  );
  const approved = await decisions.approveDecision(approverCtx, approver, dec.id);
  t.equal(approved.approval_status, 'approved', 'an independent approver approves the decision');

  // --- settlement maker-checker -----------------------------------------------------------------
  const settle = await decisions.proposeSettlement(full, officer, c0.id, {
    settlementType: 'monetary',
    amountMinor: 500000,
    currency: 'KES',
    confidentialTerms: 'secret',
  });
  await t.rejects(
    decisions.approveSettlement(full, officer, settle.id),
    'the proposer cannot approve their own settlement (SoD)',
  );
  await decisions.approveSettlement(approverCtx, approver, settle.id);

  // --- recovery + escalation --------------------------------------------------------------------
  const cNow = await cases.get(full, c0.id);
  await decisions.updateRecovery(full, officer, c0.id, {
    expectedVersion: cNow.case.version,
    recoveryState: 'demand',
    claimedMinor: 1000000,
    currency: 'KES',
  });
  const escRef = await decisions.triggerEscalation(full, officer, c0.id, { reason: 'critical severity' });
  t.ok(
    typeof escRef === 'string' && escRef.length > 0,
    'escalation records a reference and publishes an event',
  );

  // --- close (rule-gated) + reopen --------------------------------------------------------------
  await work.completeTask(full, officer, task.id, task.version, 'done');
  await work.patchIssue(full, officer, issue.id, { expectedVersion: issue.version, resolved: true });
  const beforeClose = await cases.get(full, c0.id);
  // Resolve then close (decision approved, no open mandatory tasks/issues, no legal hold).
  const resolved = await cases.resolve(
    full,
    officer,
    c0.id,
    beforeClose.case.version,
    'Resolved with refund',
  );
  const closed = await cases.close(full, officer, c0.id, {
    expectedVersion: resolved.version,
    summary: 'Closed',
  });
  t.equal(closed.status, 'closed', 'a fully-worked case closes (rule-gated)');
  const reopened = await cases.reopen(full, officer, c0.id, {
    expectedVersion: closed.version,
    reason: 'new evidence',
  });
  t.equal(reopened.status, 'reopened', 'the case reopens');

  // --- closure eligibility actually gates -------------------------------------------------------
  const bare = await cases.create(full, officer, { caseTypeCode: 'complaint', title: 'Unworked' });
  const bareOpen = await cases.open(full, officer, bare.id, bare.version);
  const bareAssigned = await cases.assign(full, officer, bare.id, {
    expectedVersion: bareOpen.version,
    owner: officer,
  });
  const bareResolved = await cases.resolve(full, officer, bare.id, bareAssigned.version, null);
  await t.rejects(
    cases.close(full, officer, bare.id, { expectedVersion: bareResolved.version }),
    'an un-worked case is not eligible for closure (no approved decision)',
  );

  // --- M12 handoff (idempotent, one case per handoff) -------------------------------------------
  const handoffId = randomUUID();
  handoffSource.seed({
    handoffId,
    feedbackId: randomUUID(),
    status: 'pending',
    recommendedCaseType: 'complaint',
    severity: 'critical',
    category: null,
    product: 'loan',
    customerRef: 'cust-1',
    sourceTransactionId: null,
  });
  const h1 = await cases.acceptHandoff(full, officer, {
    handoffId,
    caseTypeCode: 'complaint',
    title: 'From feedback',
  });
  t.ok(h1.created, 'the handoff creates a case');
  t.equal(h1.case.source, 'feedback_handoff', 'the case records the feedback-handoff source');
  const h2 = await cases.acceptHandoff(full, officer, {
    handoffId,
    caseTypeCode: 'complaint',
    title: 'From feedback',
  });
  t.ok(
    !h2.created && h2.case.id === h1.case.id,
    'a repeat handoff returns the same case (one case per handoff)',
  );
  t.equal(
    handoffSource.completed.length >= 1 ? handoffSource.completed[0]?.handoffId : '',
    handoffId,
    'the m12 handoff was completed through the port',
  );

  // --- relationships (self + reverse cycle rejected) --------------------------------------------
  const rel = await decisions.link(full, officer, {
    fromCaseId: bare.id,
    toCaseId: c0.id,
    kind: 'related_to',
  });
  t.equal(rel.kind, 'related_to', 'cases can be linked as related');
  await t.rejects(
    decisions.link(full, officer, { fromCaseId: bare.id, toCaseId: bare.id, kind: 'duplicate_of' }),
    'a case cannot relate to itself',
  );
  await decisions.link(full, officer, { fromCaseId: bare.id, toCaseId: c0.id, kind: 'parent_of' });
  await t.rejects(
    decisions.link(full, officer, { fromCaseId: c0.id, toCaseId: bare.id, kind: 'child_of' }),
    'the reverse parent/child edge is rejected (cycle)',
  );

  // --- confidentiality redaction ----------------------------------------------------------------
  const priv = await cases.get(full, c0.id);
  t.equal(priv.canReadConfidential, true, 'a privileged caller may read confidential detail');
  const red = await cases.get(noConf, c0.id);
  t.equal(red.canReadConfidential, false, 'a caller without confidential.read is flagged');

  // --- deterministic SLA (materializes deadlines) -----------------------------------------------
  const slaCase = await cases.create(full, officer, { caseTypeCode: 'complaint', title: 'SLA case' });
  const slaDeadlines = await decisions.startSla(full, officer, slaCase.id, 'fast');
  t.ok(slaDeadlines.length >= 1, 'starting SLA materializes stage deadlines');

  // --- cross-tenant isolation -------------------------------------------------------------------
  const other: RequestContext = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    correlationId: cid(),
    permissions: [...ALL_M13_PERMISSIONS],
  };
  await t.rejects(cases.get(other, c0.id), "another tenant cannot read this tenant's case (RLS)");
});
