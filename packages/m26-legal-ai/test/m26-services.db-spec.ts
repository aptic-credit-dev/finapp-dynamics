import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import { M24Emitter, AiRepository, CatalogService, ALL_M24_PERMISSIONS } from '@finapp/m24-ai-foundation';
import {
  M24AiGateway,
  M26Emitter,
  LegalAiRepository,
  LegalAiConfigurationService,
  LegalAiAnalysisService,
  LegalAiEvidenceService,
  LegalAiReviewService,
  LegalAiSuggestionService,
  M26_PERMISSIONS,
  ALL_M26_PERMISSIONS,
} from '@finapp/m26-legal-ai';

/**
 * M26 services DB spec — proves the GOVERNED legal-AI pipeline END TO END on a REAL PostgreSQL, consuming M24 BY
 * CONTRACT: register + approve an M24 provider/model; request a governed analysis of a legal matter (M24 does DLP ->
 * routing -> generate; the analysis lands in review_pending, NEVER auto-accepted); a citations-required accept is
 * refused without a citation, then succeeds once one is linked (driving the M24 output approval); a recommends-only
 * suggestion is created and a HUMAN decides it — M26 never files/settles/enforces/mutates the matter; the ETHICAL WALL
 * blocks a privileged matter without ai.privileged.read (and audits a legitimate privileged access); a DLP-blocked
 * restricted analysis fails closed; a review without a human reviewer is refused; default deny; AI_LEGAL_ audit with NO
 * secret/content; and cross-tenant isolation. M26 owns no provider, no routing, no DLP and no outbox.
 */
export default defineDbSpec('m26-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const aiRepo = new AiRepository();
  const m24Emitter = new M24Emitter(audit, outbox);
  const m24Catalog = new CatalogService(db, authz, m24Emitter, aiRepo);
  const gateway = new M24AiGateway(db, authz, m24Emitter, aiRepo);
  const m26Emitter = new M26Emitter(audit);
  const repo = new LegalAiRepository();
  const config = new LegalAiConfigurationService(db, authz, m26Emitter, repo);
  const analyses = new LegalAiAnalysisService(db, authz, m26Emitter, gateway, repo);
  const evidence = new LegalAiEvidenceService(db, authz, m26Emitter, repo);
  const reviews = new LegalAiReviewService(db, authz, m26Emitter, gateway, repo);
  const suggestions = new LegalAiSuggestionService(db, authz, m26Emitter, repo);

  const tenant = randomUUID();
  const admin = randomUUID();
  const reviewer = randomUUID();
  const fullPerms = [...ALL_M24_PERMISSIONS, ...ALL_M26_PERMISSIONS];
  const ctxOf = (userId: string, p: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId,
    correlationId: randomUUID(),
    permissions: [...p],
  });
  const adminCtx = ctxOf(admin, fullPerms);
  const reviewerCtx = ctxOf(reviewer, fullPerms);

  // --- set up an approved M24 provider + model (m26 owns none) -----------------------------------
  const provider = await m24Catalog.registerProvider(adminCtx, admin, {
    code: 'local-legal',
    classifications: ['confidential', 'restricted'],
    secretReference: `secretref:vault/${randomUUID()}`,
  });
  const approved = await m24Catalog.approveProvider(adminCtx, admin, provider.id, provider.version);
  t.ok(approved.approved, 'an M24 provider is approved (m26 consumes it by contract)');
  const model = await m24Catalog.registerModel(adminCtx, admin, {
    providerId: provider.id,
    code: 'legal-sm',
    ratePer1kMinor: 25,
  });

  // --- config: human review on, auto-apply off ---------------------------------------------------
  const cfg = await config.createConfig(adminCtx, admin, {
    scope: 'default',
    minConfidenceBps: 6000,
    idempotencyKey: `cfg-${randomUUID()}`,
  });
  const published = await config.publishConfig(adminCtx, admin, cfg.id, cfg.version);
  t.ok(
    published.status === 'active' && published.require_human_review && !published.auto_apply,
    'config publishes with human review on + auto-apply off',
  );

  // --- request a governed legal analysis (NEVER auto-accepted) -----------------------------------
  const matterRef = randomUUID();
  const idem = `an-${randomUUID()}`;
  const analysis = await analyses.requestAnalysis(adminCtx, admin, {
    subjectType: 'matter',
    matterRef,
    classification: 'confidential',
    privilege: 'confidential',
    analysisKind: 'matter_summary',
    providerId: provider.id,
    modelId: model.id,
    inputSample: 'summarise this matter',
    idempotencyKey: idem,
  });
  t.equal(
    analysis.status,
    'review_pending',
    'a generated analysis awaits HUMAN legal review — NOT auto-accepted',
  );
  t.ok(
    analysis.ai_request_ref !== null && analysis.ai_output_ref !== null,
    'the analysis references the opaque M24 request + output',
  );
  t.ok(analysis.citations_required, 'a legal analysis requires citations by default');
  const replay = await analyses.requestAnalysis(adminCtx, admin, {
    subjectType: 'matter',
    matterRef,
    analysisKind: 'matter_summary',
    idempotencyKey: idem,
  });
  t.equal(replay.id, analysis.id, 'analysis is idempotent per key (no duplicate M24 generation)');

  // --- record an inferred finding (never a verified fact) ----------------------------------------
  const finding = await analyses.recordFinding(adminCtx, admin, {
    analysisId: analysis.id,
    findingType: 'inferred_issue',
    factStatus: 'inferred',
    confidenceBps: 7000,
  });
  t.equal(finding.fact_status, 'inferred', 'an AI finding is inferred, never a verified legal fact');

  // --- a citations-required accept is refused without a citation, then succeeds with one ----------
  await t.rejects(
    reviews.reviewAnalysis(reviewerCtx, reviewer, analysis.id, analysis.version, { decision: 'accept' }),
    'a citations-required analysis cannot be accepted with zero citations (fail closed)',
  );
  await evidence.addCitation(adminCtx, admin, {
    analysisId: analysis.id,
    sourceType: 'document',
    documentRef: randomUUID(),
    documentVersion: 3,
    documentHash: 'sha256:abc',
    page: 12,
    section: 'IV',
    evidenceClassification: 'primary',
    confidenceBps: 8000,
  });
  const withCite = await analyses.getAnalysis(reviewerCtx, analysis.id);
  t.equal(withCite.analysis.citation_count, 1, 'a citation is linked and bumps the count');
  const accepted = await reviews.reviewAnalysis(
    reviewerCtx,
    reviewer,
    withCite.analysis.id,
    withCite.analysis.version,
    { decision: 'accept', reason: 'sound' },
  );
  t.ok(
    accepted.status === 'accepted' && accepted.reviewed_by === reviewer,
    'a human legal reviewer accepts the analysis',
  );
  const m24Output = await db.withTenant(adminCtx, (tx) =>
    aiRepo.findOutput(tx, accepted.ai_output_ref ?? ''),
  );
  t.equal(m24Output?.status, 'approved', 'accepting drove the M24 output to approved (governed by M24)');

  // --- a recommends-only suggestion, decided by a HUMAN (m26 never acts on the matter) -----------
  const suggestion = await suggestions.createSuggestion(adminCtx, admin, {
    analysisId: accepted.id,
    suggestionType: 'next_action',
    recommendedRef: randomUUID(),
    confidenceBps: 6500,
  });
  t.equal(suggestion.status, 'suggested', 'a suggestion starts suggested (advisory only)');
  const decided = await suggestions.decideSuggestion(
    reviewerCtx,
    reviewer,
    suggestion.id,
    suggestion.version,
    { decision: 'accept', reason: 'will action manually' },
  );
  t.ok(
    decided.status === 'accepted' && decided.decided_by === reviewer,
    'a human decides the suggestion — m26 records it but never acts on M14',
  );

  // --- ETHICAL WALL: a privileged matter is blocked without ai.privileged.read --------------------
  const noPrivCtx = ctxOf(
    admin,
    ALL_M26_PERMISSIONS.filter((p) => p !== M26_PERMISSIONS.privilegedRead),
  );
  await t.rejects(
    analyses.requestAnalysis(noPrivCtx, admin, {
      subjectType: 'matter',
      matterRef: randomUUID(),
      classification: 'confidential',
      privilege: 'privileged',
      analysisKind: 'issue_extraction',
      providerId: provider.id,
      modelId: model.id,
      inputSample: 'x',
    }),
    'a privileged matter is blocked without ai.privileged.read (ethical wall, fail closed)',
  );
  const privAnalysis = await analyses.requestAnalysis(adminCtx, admin, {
    subjectType: 'matter',
    matterRef: randomUUID(),
    classification: 'confidential',
    privilege: 'privileged',
    analysisKind: 'issue_extraction',
    providerId: provider.id,
    modelId: model.id,
    inputSample: 'privileged matter',
  });
  t.equal(privAnalysis.status, 'review_pending', 'a privileged reader may analyse privileged material');

  // --- no autonomous action: a review without a human reviewer is refused ------------------------
  await t.rejects(
    reviews.reviewAnalysis(reviewerCtx, null, privAnalysis.id, privAnalysis.version, { decision: 'accept' }),
    'a review without a human reviewer is refused (no autonomous action)',
  );

  // --- DLP-blocked restricted analysis fails closed ----------------------------------------------
  const restricted = await analyses.requestAnalysis(adminCtx, admin, {
    subjectType: 'case',
    matterRef: randomUUID(),
    classification: 'restricted',
    privilege: 'confidential',
    analysisKind: 'matter_summary',
    providerId: provider.id,
    modelId: model.id,
    inputSample: 'the password is hunter2',
  });
  t.equal(restricted.status, 'failed', 'a DLP-blocked restricted analysis fails closed (M24 governance)');

  // --- optimistic concurrency (stale review rejects) --------------------------------------------
  await t.rejects(
    reviews.reviewAnalysis(reviewerCtx, reviewer, privAnalysis.id, privAnalysis.version + 99, {
      decision: 'accept',
    }),
    'a stale expectedVersion is rejected (optimistic concurrency)',
  );

  // --- default deny -----------------------------------------------------------------------------
  const noPerm = ctxOf(admin, []);
  await t.rejects(
    analyses.requestAnalysis(noPerm, admin, {
      subjectType: 'matter',
      matterRef: randomUUID(),
      analysisKind: 'matter_summary',
    }),
    'a caller without ai.legal.analyze is denied (default deny)',
  );
  await t.rejects(
    reviews.reviewAnalysis(noPerm, reviewer, accepted.id, accepted.version, { decision: 'reject' }),
    'a caller without ai.legal.review is denied',
  );

  // --- audit carries NO secret / content --------------------------------------------------------
  t.ok(audit.entries.length >= 8, 'AI_ / AI_LEGAL_ audit entries were recorded');
  const auditJson = JSON.stringify(audit.entries);
  t.ok(
    !auditJson.includes('hunter2') &&
      !auditJson.includes('summarise this matter') &&
      !auditJson.includes('secretref:'),
    'no secret or prompt/input content appears in any audit entry',
  );
  t.ok(
    audit.entries.some((e) => e.code === 'AI_LEGAL_ANALYSIS_COMPLETED') &&
      audit.entries.some((e) => e.code === 'AI_LEGAL_ANALYSIS_ACCEPTED') &&
      audit.entries.some((e) => e.code === 'AI_LEGAL_PRIVILEGED_READ'),
    'analysis completion, human acceptance and a privileged read are all audited (AI_LEGAL_)',
  );

  // --- cross-tenant isolation -------------------------------------------------------------------
  const otherTenant: RequestContext = { ...adminCtx, tenantId: randomUUID() };
  await t.rejects(
    analyses.getAnalysis(otherTenant, analysis.id),
    "another tenant cannot read this tenant's analysis (RLS)",
  );
});
