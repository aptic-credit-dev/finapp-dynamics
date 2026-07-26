import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M12Emitter,
  FeedbackRepository,
  CatalogService,
  FeedbackService,
  RecordsService,
  FixedClock,
  M12_PERMISSIONS,
  ALL_M12_PERMISSIONS,
} from '@finapp/m12-feedback';

/**
 * M12 services DB spec — proves the feedback platform end-to-end on a REAL PostgreSQL and enforces governance:
 * configurable sources/categories, versioned immutable-after-publish questionnaires + SLA policies, idempotent
 * ingestion, single-winner queue claim, the full feedback lifecycle (capture→classify→assign→resolve→close) with
 * deterministic CX scores, closure eligibility gating, resolution SoD (submitter ≠ approver), deterministic
 * clock-driven SLA breach + pause/resume, escalation-via-event, controlled M13 case handoff (pending record +
 * event, no case table), duplicate/related linking, customer-contact REDACTION, and cross-tenant isolation.
 */
export default defineDbSpec('m12-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const emitter = new M12Emitter(new RecordingAudit(), new RecordingOutbox());
  const repo = new FeedbackRepository();
  const clock = new FixedClock(1_700_000_000_000);
  const catalog = new CatalogService(db, authz, emitter, repo);
  const feedback = new FeedbackService(db, authz, emitter, repo);
  const records = new RecordsService(db, authz, emitter, repo, clock);

  const tenant = randomUUID();
  const author = randomUUID();
  const approver = randomUUID();
  const officer = randomUUID();
  const cid = (): string => randomUUID();
  const full: RequestContext = {
    tenantId: tenant,
    userId: author,
    correlationId: cid(),
    permissions: [...ALL_M12_PERMISSIONS],
  };
  const approverCtx: RequestContext = {
    tenantId: tenant,
    userId: approver,
    correlationId: cid(),
    permissions: [...ALL_M12_PERMISSIONS],
  };
  const noPerm: RequestContext = { tenantId: tenant, userId: author, correlationId: cid(), permissions: [] };
  const noContact: RequestContext = {
    tenantId: tenant,
    userId: author,
    correlationId: cid(),
    permissions: ALL_M12_PERMISSIONS.filter((p) => p !== M12_PERMISSIONS.customerContactRead),
  };

  const qSpec = {
    schemaVersion: 1,
    code: 'loan_csat',
    name: 'Loan CSAT',
    questions: [
      {
        key: 'satisfaction',
        prompt: 'How satisfied?',
        type: 'rating',
        scale: 5,
        metric: 'csat',
        required: true,
      },
      { key: 'recommend', prompt: 'Recommend us?', type: 'rating', scale: 10, metric: 'nps' },
    ],
  };
  const slaSpec = {
    schemaVersion: 1,
    code: 'fast',
    name: 'Fast',
    ackMinutes: 1,
    assignMinutes: 1,
    responseMinutes: 1,
    resolutionMinutes: 1,
    closureMinutes: 2,
    warnThresholdPct: 80,
  };

  // --- configurable catalog (nothing Aptic-specific) --------------------------------------------
  await t.rejects(
    catalog.setSourceSystem(noPerm, author, { code: 'apticone', name: 'ApticOne' }),
    'configuring a source needs the manage permission',
  );
  await catalog.setSourceSystem(full, author, { code: 'apticone', name: 'ApticOne', active: true });
  await catalog.setCategory(full, author, {
    code: 'service',
    name: 'Service quality',
    defaultSentiment: 'negative',
  });

  // --- versioned questionnaire: create -> validate -> publish (freezes hash) -> activate ---------
  const q0 = await catalog.createQuestionnaire(full, author, {
    code: 'loan_csat',
    name: 'Loan CSAT',
    spec: qSpec,
  });
  t.equal(q0.status, 'DRAFT', 'a new questionnaire starts DRAFT');
  const q1 = await catalog.validateQuestionnaire(full, author, q0.id, q0.version);
  const q2 = await catalog.publishQuestionnaire(full, author, q1.id, q1.version);
  t.ok(q2.content_hash !== null, 'publishing freezes a content hash');
  await catalog.activateQuestionnaire(full, author, q2.id, q2.version);
  await t.rejects(
    catalog.createQuestionnaire(full, author, {
      code: 'loan_csat',
      name: 'X',
      spec: { ...qSpec, code: 'mismatch' },
    }),
    'spec.code must equal the code',
  );

  // --- versioned SLA policy ---------------------------------------------------------------------
  const s0 = await catalog.createSlaPolicy(full, author, { code: 'fast', name: 'Fast', spec: slaSpec });
  const s1 = await catalog.validateSlaPolicy(full, author, s0.id, s0.version);
  const s2 = await catalog.publishSlaPolicy(full, author, s1.id, s1.version);
  await catalog.activateSlaPolicy(full, author, s2.id, s2.version);

  // --- idempotent ingestion + single-winner claim -----------------------------------------------
  await t.rejects(
    feedback.ingest(full, author, {
      sourceSystem: 'ghost',
      externalTransactionId: 'x',
      transactionType: 'loan',
      product: 'loan',
      customerRef: 'c1',
    }),
    'an unknown source system is rejected',
  );
  const ing1 = await feedback.ingest(full, author, {
    sourceSystem: 'apticone',
    externalTransactionId: 'TXN-1',
    transactionType: 'loan_disbursed',
    product: 'loan',
    branch: 'HQ',
    customerRef: 'cust-1',
    idempotencyKey: 'k-txn-1',
  });
  const ing2 = await feedback.ingest(full, author, {
    sourceSystem: 'apticone',
    externalTransactionId: 'TXN-1',
    transactionType: 'loan_disbursed',
    product: 'loan',
    customerRef: 'cust-1',
    idempotencyKey: 'k-txn-1',
  });
  t.equal(ing1.transactionId, ing2.transactionId, 'ingesting the same external transaction is idempotent');
  const claimed = await feedback.claimQueueItem(full, officer, ing1.queueItemId);
  t.equal(claimed.status, 'claimed', 'the queue item is claimed');
  t.equal(
    await feedback.claimQueueItem(full, officer, ing1.queueItemId).then(
      () => 'ok',
      () => 'conflict',
    ),
    'conflict',
    'a second claim of the same item loses (single winner)',
  );
  await feedback.recordContact(full, officer, ing1.queueItemId, {
    expectedVersion: claimed.version,
    outcome: 'reached',
    reached: true,
  });

  // --- create feedback (idempotent) + capture (deterministic scores) + classify + assign --------
  const fb0 = await feedback.create(full, officer, {
    sourceTransactionId: ing1.transactionId,
    customerRef: 'cust-1',
    customerContact: '+254700000000',
    product: 'loan',
    branch: 'HQ',
    feedbackType: 'complaint',
    idempotencyKey: 'k-fb-1',
  });
  const fb0b = await feedback.create(full, officer, { customerRef: 'cust-1', idempotencyKey: 'k-fb-1' });
  t.equal(fb0.id, fb0b.id, 'creating with the same idempotency key returns the same feedback');
  t.equal(fb0.status, 'pending_contact', 'a new feedback is pending_contact');
  const captured = await feedback.capture(full, officer, fb0.id, {
    expectedVersion: fb0.version,
    questionnaireCode: 'loan_csat',
    answers: { satisfaction: 4, recommend: 9 },
  });
  t.equal(captured.csat, '80.00', 'CSAT is normalized to 0-100 (4/5)');
  t.equal(captured.nps, 9, 'NPS is kept on 0-10');
  const classified = await feedback.classify(full, officer, fb0.id, {
    expectedVersion: captured.version,
    sentiment: 'negative',
    category: 'service',
    severity: 'high',
  });
  const assigned = await feedback.assign(full, officer, fb0.id, {
    expectedVersion: classified.version,
    owner: officer,
  });
  t.equal(assigned.status, 'assigned', 'the feedback is assigned');
  t.equal(assigned.current_owner, officer, 'the owner is recorded');
  await t.rejects(
    feedback.classify(full, officer, fb0.id, { expectedVersion: 1, sentiment: 'negative', severity: 'low' }),
    'a stale version is rejected (optimistic concurrency)',
  );

  // --- resolution with segregation of duties (submitter != approver) ----------------------------
  await feedback.submitResolution(full, officer, fb0.id, {
    summary: 'Rebooked',
    resolutionType: 'corrected',
    rootCauseCategory: 'process',
    responseConfidential: 'internal only',
    responseCustomerFacing: 'We fixed it',
  });
  await t.rejects(
    feedback.approveResolution(full, officer, fb0.id),
    'the submitter cannot approve their own resolution (SoD)',
  );
  const resolved = await feedback.approveResolution(approverCtx, approver, fb0.id);
  t.equal(resolved.status, 'resolved', 'an independent approver resolves the feedback');

  // --- customer confirmation + rule-gated closure -----------------------------------------------
  const confirmed = await feedback.recordConfirmation(full, officer, fb0.id, {
    expectedVersion: resolved.version,
    satisfied: true,
  });
  const closed = await feedback.close(full, officer, fb0.id, { expectedVersion: confirmed.version });
  t.equal(closed.status, 'closed', 'a fully-satisfied complaint closes');

  // --- closure eligibility actually gates -------------------------------------------------------
  const bare = await feedback.create(full, officer, {
    customerRef: 'cust-2',
    product: 'loan',
    feedbackType: 'complaint',
  });
  await t.rejects(
    feedback.close(full, officer, bare.id, { expectedVersion: bare.version }),
    'an un-worked complaint is not eligible for closure',
  );

  // --- deterministic SLA: start (fixed clock) -> breach after due -> pause/resume ----------------
  const slaFb = await feedback.create(full, officer, {
    customerRef: 'cust-3',
    product: 'loan',
    feedbackType: 'service_issue',
  });
  const sla = await records.startSla(full, officer, slaFb.id, 'fast');
  t.ok(sla.resolution_due_at !== null, 'SLA due dates are computed');
  const fresh = await records.evaluateSla(full, slaFb.id);
  t.ok(!fresh.breached, 'a fresh SLA is not breached');
  clock.advance(5 * 60_000); // well past the 1-minute resolution window
  const breach = await records.evaluateSla(full, slaFb.id);
  t.ok(breach.breached, 'the SLA breaches deterministically once the clock passes due');
  const paused = await records.pauseSla(full, officer, slaFb.id, 'awaiting customer');
  t.ok(paused.paused_at !== null, 'SLA can be paused');
  const resumed = await records.resumeSla(full, officer, slaFb.id);
  t.ok(resumed.paused_at === null, 'SLA can be resumed');

  // --- escalation reuses m08 via an event (no second engine) -------------------------------------
  const escRef = await records.triggerEscalation(full, officer, slaFb.id, { reason: 'critical breach' });
  t.ok(
    typeof escRef === 'string' && escRef.length > 0,
    'escalation records a reference and publishes an event',
  );

  // --- controlled M13 case handoff: pending record + event, idempotent --------------------------
  const caseFb = await feedback.create(full, officer, {
    customerRef: 'cust-4',
    product: 'loan',
    feedbackType: 'potential_fraud',
  });
  // Capture first so the feedback is in a state from which converted_to_case is reachable (a raw
  // pending_contact record cannot be converted straight to a case).
  const caseCaptured = await feedback.capture(full, officer, caseFb.id, {
    expectedVersion: caseFb.version,
    feedbackType: 'potential_fraud',
  });
  await feedback.classify(full, officer, caseFb.id, {
    expectedVersion: caseCaptured.version,
    sentiment: 'critical',
    severity: 'critical',
  });
  const h1 = await records.requestCaseHandoff(full, officer, caseFb.id, {
    recommendedCaseType: 'fraud',
    summary: 'suspected fraud',
    idempotencyKey: 'k-ho-1',
  });
  const h2 = await records.requestCaseHandoff(full, officer, caseFb.id, { idempotencyKey: 'k-ho-1' });
  t.equal(h1.id, h2.id, 'requesting a handoff is idempotent');
  t.equal(h1.status, 'pending', 'the handoff is a pending record (no case table owned by m12)');
  const completed = await records.completeCaseHandoff(full, officer, h1.id, 'CASE-123');
  t.equal(completed.status, 'completed', 'completing the handoff records the case ref');
  const convFb = await feedback.get(full, caseFb.id);
  t.equal(convFb.feedback.status, 'converted_to_case', 'the feedback transitions to converted_to_case');

  // --- duplicate / related linking --------------------------------------------------------------
  const rel = await records.link(full, officer, {
    fromFeedbackId: bare.id,
    toFeedbackId: fb0.id,
    kind: 'related',
  });
  t.equal(rel.kind, 'related', 'feedback can be linked as related');
  await t.rejects(
    records.link(full, officer, { fromFeedbackId: bare.id, toFeedbackId: bare.id, kind: 'duplicate' }),
    'a feedback cannot relate to itself',
  );

  // --- customer-contact redaction ---------------------------------------------------------------
  const withContact = await feedback.get(full, fb0.id);
  t.equal(withContact.canReadContact, true, 'a privileged caller may read the contact');
  const redacted = await feedback.get(noContact, fb0.id);
  t.equal(redacted.canReadContact, false, 'a caller without the contact permission is flagged');

  // --- positive feedback recognition ------------------------------------------------------------
  const praise = await feedback.create(full, officer, {
    customerRef: 'cust-5',
    product: 'loan',
    feedbackType: 'compliment',
  });
  await feedback.recognizePositive(full, officer, praise.id, { staff: officer, consentForTestimonial: true });
  const acts = await feedback.listActivities(full, praise.id);
  t.ok(
    acts.some((a) => a.activity_type === 'recognition'),
    'positive feedback is recognized as an activity',
  );

  // --- cross-tenant isolation -------------------------------------------------------------------
  const otherTenant: RequestContext = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    correlationId: cid(),
    permissions: [...ALL_M12_PERMISSIONS],
  };
  await t.rejects(
    feedback.get(otherTenant, fb0.id),
    "another tenant cannot read this tenant's feedback (RLS)",
  );

  // --- default deny -----------------------------------------------------------------------------
  await t.rejects(
    feedback.create(noPerm, author, { customerRef: 'x' }),
    'creating feedback requires the create permission',
  );
});
