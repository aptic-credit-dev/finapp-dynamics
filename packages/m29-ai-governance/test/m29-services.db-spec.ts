import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M29Emitter,
  AiGovernanceRepository,
  AiGovernancePolicyService,
  AiUseCaseGovernanceService,
  AiReleaseService,
  AiEvaluationService,
  AiWaiverService,
  AiGovernanceDecisionService,
  M29_PERMISSIONS,
  ALL_M29_PERMISSIONS,
} from '@finapp/m29-ai-governance';

/**
 * M29 services DB spec — proves the AI-governance/release pipeline END TO END on a REAL PostgreSQL: publish a governance
 * policy (human approval + evaluation always on); register a governed AI use case; PROPOSE a release; record passing
 * evaluation EVIDENCE; submit for review; then prove THE LOAD-BEARING RULE — AI NEVER APPROVES ITS OWN RELEASE: a
 * self-approval (proposer == approver) is refused, an AI/system approver is refused, and only an INDEPENDENT HUMAN can
 * approve; release it; suspend it. A release with no passing evaluation cannot be submitted (evidence gate). WAIVERS: a
 * non-absolute waiver is requested + approved by an independent human; an ABSOLUTE control can never be waived; a
 * requester cannot self-approve a waiver. Idempotency; optimistic concurrency; default deny; privacy-safe audit; the one
 * m06 outbox carries ai.governance_lifecycle events (m29 owns none); cross-tenant isolation.
 */
export default defineDbSpec('m29-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M29Emitter(audit, outbox);
  const repo = new AiGovernanceRepository();
  const policies = new AiGovernancePolicyService(db, authz, emitter, repo);
  const useCases = new AiUseCaseGovernanceService(db, authz, emitter, repo);
  const releases = new AiReleaseService(db, authz, emitter, repo);
  const evaluations = new AiEvaluationService(db, authz, emitter, repo);
  const waivers = new AiWaiverService(db, authz, emitter, repo);
  const decisions = new AiGovernanceDecisionService(db, authz, emitter, repo);

  const tenant = randomUUID();
  const maker = randomUUID();
  const checker = randomUUID();
  const full = [...ALL_M29_PERMISSIONS];
  const ctxOf = (userId: string, p: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId,
    correlationId: randomUUID(),
    permissions: [...p],
  });
  const makerCtx = ctxOf(maker, full);
  const checkerCtx = ctxOf(checker, full);

  // --- policy: human approval + evaluation always on --------------------------------------------
  const pol = await policies.createPolicy(makerCtx, maker, {
    scope: 'default',
    minConfidenceBps: 6000,
    idempotencyKey: `pol-${randomUUID()}`,
  });
  const active = await policies.publishPolicy(makerCtx, maker, pol.id, pol.version);
  t.ok(
    active.status === 'active' &&
      active.require_human_approval &&
      active.require_evaluation &&
      !active.allow_restricted_provider,
    'policy publishes with human approval + evaluation on, no restricted-provider allow',
  );

  // --- governed use case ------------------------------------------------------------------------
  const uc = await useCases.registerUseCase(makerCtx, maker, {
    moduleRef: 'm27-finance-ai',
    purpose: 'recon suggestions',
    classification: 'confidential',
    riskTier: 'high',
    modelRef: randomUUID(),
  });
  t.ok(uc.controlled_action_prohibited, 'a governed use case prohibits AI-executed controlled actions');

  // --- propose a release, record passing evaluation, submit for review ---------------------------
  const proposed = await releases.proposeRelease(makerCtx, maker, {
    useCaseId: uc.id,
    subjectKind: 'model_version',
    subjectRef: randomUUID(),
    riskTier: 'high',
    idempotencyKey: `rel-${randomUUID()}`,
  });
  t.equal(proposed.status, 'draft', 'a release starts in draft');
  await evaluations.recordEvaluation(makerCtx, maker, proposed.id, {
    evalRef: randomUUID(),
    modelRef: randomUUID(),
    dlpResult: 'pass',
    safetyResult: 'pass',
    citationResult: 'pass',
    accuracyBps: 8000,
  });
  const afterEval = await releases.getRelease(makerCtx, proposed.id);
  t.ok(afterEval.evaluation_passed, 'a passing evaluation stamps the release evidence flag');
  const submitted = await releases.submitForReview(makerCtx, maker, proposed.id, afterEval.version);
  t.equal(submitted.status, 'review_pending', 'the release reaches review_pending');

  // --- NO AI SELF-APPROVAL: self-approval, then AI/system approval, both refused -----------------
  await t.rejects(
    releases.approveRelease(makerCtx, maker, proposed.id, submitted.version),
    'the proposer cannot self-approve their own release (maker != checker, fail closed)',
  );
  await t.rejects(
    releases.approveRelease(checkerCtx, 'system', proposed.id, submitted.version),
    'a system/AI actor can never be the final approver (no AI self-approval)',
  );
  await t.rejects(
    releases.approveRelease(checkerCtx, null, proposed.id, submitted.version),
    'a null approver is refused (a human is required)',
  );

  // --- an INDEPENDENT HUMAN approves, then releases ---------------------------------------------
  const approved = await releases.approveRelease(checkerCtx, checker, proposed.id, submitted.version, {
    reason: 'evaluated + independent review',
  });
  t.ok(
    approved.status === 'approved' && approved.approved_by === checker,
    'an independent human checker approves the release',
  );
  const released = await releases.releaseRelease(checkerCtx, checker, proposed.id, approved.version);
  t.equal(released.status, 'released', 'the approved release is released by a human');
  const suspended = await releases.suspendRelease(
    checkerCtx,
    checker,
    proposed.id,
    released.version,
    'incident under review',
  );
  t.equal(suspended.status, 'suspended', 'a released model can be suspended with a reason');

  // --- EVIDENCE GATE: a release with no passing evaluation cannot be submitted -------------------
  const noEval = await releases.proposeRelease(makerCtx, maker, {
    subjectKind: 'prompt_version',
    subjectRef: randomUUID(),
  });
  await t.rejects(
    releases.submitForReview(makerCtx, maker, noEval.id, noEval.version),
    'a non-waiver release with no passing evaluation cannot be submitted for review (evidence gate)',
  );

  // --- WAIVER: independent human approves a non-absolute waiver ----------------------------------
  const waiver = await waivers.requestWaiver(makerCtx, maker, {
    controlCode: 'extend_review_window',
    reason: 'pilot cohort',
    riskTier: 'high',
    expiresAt: null,
    compensatingControlRef: randomUUID(),
    idempotencyKey: `wv-${randomUUID()}`,
  });
  t.equal(waiver.status, 'review_pending', 'a waiver reaches review_pending');
  await t.rejects(
    waivers.approveWaiver(makerCtx, maker, waiver.id, waiver.version),
    'the requester cannot self-approve their own waiver',
  );
  const waiverApproved = await waivers.approveWaiver(checkerCtx, checker, waiver.id, waiver.version, {
    reason: 'compensating control adequate',
  });
  t.ok(
    waiverApproved.status === 'approved' && waiverApproved.approved_by === checker,
    'an independent human approves the waiver',
  );

  // --- ABSOLUTE control can NEVER be waived -----------------------------------------------------
  await t.rejects(
    waivers.requestWaiver(makerCtx, maker, {
      controlCode: 'no_ai_self_approval',
      reason: 'trying to bypass',
    }),
    'an absolute control (no AI self-approval) can never be waived (override blocked)',
  );
  await t.rejects(
    waivers.requestWaiver(makerCtx, maker, {
      controlCode: 'no_production_provider',
      reason: 'trying to bypass',
    }),
    'an absolute control (no production provider) can never be waived',
  );

  // --- idempotency: a replayed release proposal returns the same release -------------------------
  const key = `rel-${randomUUID()}`;
  const first = await releases.proposeRelease(makerCtx, maker, {
    subjectKind: 'model_version',
    subjectRef: randomUUID(),
    idempotencyKey: key,
  });
  const replay = await releases.proposeRelease(makerCtx, maker, {
    subjectKind: 'model_version',
    subjectRef: randomUUID(),
    idempotencyKey: key,
  });
  t.equal(replay.id, first.id, 'a replayed idempotency key returns the same release (no duplicate)');

  // --- optimistic concurrency: a stale expectedVersion is rejected ------------------------------
  await t.rejects(
    releases.approveRelease(checkerCtx, checker, proposed.id, suspended.version + 99),
    'a stale expectedVersion is rejected (optimistic concurrency)',
  );

  // --- default deny -----------------------------------------------------------------------------
  const noPerm = ctxOf(maker, []);
  await t.rejects(
    releases.proposeRelease(noPerm, maker, { subjectKind: 'model_version' }),
    'a caller without ai.governance.manage is denied (default deny)',
  );
  const readerCtx = ctxOf(checker, [M29_PERMISSIONS.governanceRead]);
  await t.rejects(
    releases.approveRelease(readerCtx, checker, proposed.id, suspended.version),
    'a caller without ai.governance.approve cannot approve',
  );

  // --- evidence export (privileged) + audit privacy ---------------------------------------------
  const exported = await decisions.exportEvidence(makerCtx, proposed.id);
  t.ok(exported.evaluations.length > 0, 'evidence export returns the evaluation references');
  const auditJson = JSON.stringify(audit.entries);
  t.ok(
    !auditJson.includes('secretref:') && !auditJson.includes('password'),
    'no secret appears in any audit entry',
  );
  t.ok(
    audit.entries.some((e) => e.code === 'AI_GOVERNANCE_RELEASE_PROPOSED') &&
      audit.entries.some((e) => e.code === 'AI_GOVERNANCE_RELEASE_APPROVED') &&
      audit.entries.some((e) => e.code === 'AI_GOVERNANCE_OVERRIDE_BLOCKED'),
    'proposal, human approval and override-blocked are all audited (AI_GOVERNANCE_)',
  );

  // --- the one m06 outbox carries ai.governance_lifecycle events (m29 owns none) -----------------
  t.ok(
    outbox.events.length > 0 &&
      outbox.events.every(
        (e) => e.family === 'ai.governance_lifecycle' && e.type === 'GovernanceControlUpdated',
      ),
    'm29 emits only ai.governance_lifecycle/GovernanceControlUpdated (reuses m24 family; no new family)',
  );

  // --- cross-tenant isolation -------------------------------------------------------------------
  const otherTenant: RequestContext = { ...makerCtx, tenantId: randomUUID() };
  await t.rejects(
    releases.getRelease(otherTenant, proposed.id),
    "another tenant cannot read this tenant's release (RLS)",
  );
});
