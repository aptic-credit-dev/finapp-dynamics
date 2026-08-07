import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import { M24Emitter, AiRepository, CatalogService, ALL_M24_PERMISSIONS } from '@finapp/m24-ai-foundation';
import {
  M24AiGateway,
  M27Emitter,
  FinanceAiRepository,
  FinanceAiConfigurationService,
  FinanceAiAnalysisService,
  FinanceAiSuggestionService,
  FinanceAiReviewService,
  FinanceAiEvidenceService,
  ALL_M27_PERMISSIONS,
} from '@finapp/m27-finance-ai';

/**
 * M27 services DB spec — proves the GOVERNED finance-AI pipeline END TO END on a REAL PostgreSQL, consuming M24 BY
 * CONTRACT: register + approve an M24 provider/model; request a governed analysis of a bank-recon subject (M24 does DLP
 * -> routing -> generate; the analysis lands in review_pending, NEVER auto-accepted); a HUMAN accepts it (driving the
 * M24 output approval); create an EXPLAINABLE suggestion (bigint minor-unit amount, never float); the explainability
 * gate refuses to ACCEPT it with no matched feature, then a HUMAN accepts once a feature is recorded — and M27 NEVER
 * auto-matches/auto-posts/mutates a finance record; classify an exception; a DLP-blocked restricted analysis fails
 * closed; default deny; AI_FINANCE_ audit with NO secret/content; cross-tenant isolation. M27 owns no provider, no
 * routing, no DLP and no outbox — all of that is M24's, never duplicated.
 */
export default defineDbSpec('m27-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const aiRepo = new AiRepository();
  const m24Emitter = new M24Emitter(audit, outbox);
  const m24Catalog = new CatalogService(db, authz, m24Emitter, aiRepo);
  const gateway = new M24AiGateway(db, authz, m24Emitter, aiRepo);
  const m27Emitter = new M27Emitter(audit);
  const repo = new FinanceAiRepository();
  const config = new FinanceAiConfigurationService(db, authz, m27Emitter, repo);
  const analyses = new FinanceAiAnalysisService(db, authz, m27Emitter, gateway, repo);
  const suggestions = new FinanceAiSuggestionService(db, authz, m27Emitter, repo);
  const reviews = new FinanceAiReviewService(db, authz, m27Emitter, gateway, repo);
  const evidence = new FinanceAiEvidenceService(db, authz, m27Emitter, repo);

  const tenant = randomUUID();
  const admin = randomUUID();
  const reviewer = randomUUID();
  const fullPerms = [...ALL_M24_PERMISSIONS, ...ALL_M27_PERMISSIONS];
  const ctxOf = (userId: string, p: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId,
    correlationId: randomUUID(),
    permissions: [...p],
  });
  const adminCtx = ctxOf(admin, fullPerms);
  const reviewerCtx = ctxOf(reviewer, fullPerms);

  // --- set up an approved M24 provider + model (m27 owns none) -----------------------------------
  const provider = await m24Catalog.registerProvider(adminCtx, admin, {
    code: 'local-fin',
    classifications: ['confidential', 'restricted'],
    secretReference: `secretref:vault/${randomUUID()}`,
  });
  const approved = await m24Catalog.approveProvider(adminCtx, admin, provider.id, provider.version);
  t.ok(approved.approved, 'an M24 provider is approved (m27 consumes it by contract)');
  const model = await m24Catalog.registerModel(adminCtx, admin, {
    providerId: provider.id,
    code: 'fin-sm',
    ratePer1kMinor: 20,
  });

  // --- config: human review on, auto-post + auto-match off ---------------------------------------
  const cfg = await config.createConfig(adminCtx, admin, {
    scope: 'default',
    minConfidenceBps: 6000,
    idempotencyKey: `cfg-${randomUUID()}`,
  });
  const published = await config.publishConfig(adminCtx, admin, cfg.id, cfg.version);
  t.ok(
    published.status === 'active' &&
      published.require_human_review &&
      !published.auto_post &&
      !published.auto_match,
    'config publishes with human review on + auto-post + auto-match off',
  );

  // --- request a governed analysis (NEVER auto-accepted) -----------------------------------------
  const reconRef = randomUUID();
  const idem = `an-${randomUUID()}`;
  const analysis = await analyses.requestAnalysis(adminCtx, admin, {
    subjectType: 'bank_recon',
    subjectRef: reconRef,
    classification: 'confidential',
    analysisKind: 'match_suggestion',
    providerId: provider.id,
    modelId: model.id,
    inputSample: 'suggest matches for this bank recon',
    idempotencyKey: idem,
  });
  t.equal(analysis.status, 'review_pending', 'a generated analysis awaits HUMAN review — NOT auto-accepted');
  t.ok(
    analysis.ai_request_ref !== null && analysis.ai_output_ref !== null,
    'the analysis references the opaque M24 request + output',
  );
  const replay = await analyses.requestAnalysis(adminCtx, admin, {
    subjectType: 'bank_recon',
    subjectRef: reconRef,
    analysisKind: 'match_suggestion',
    idempotencyKey: idem,
  });
  t.equal(replay.id, analysis.id, 'analysis is idempotent per key (no duplicate M24 generation)');

  // --- a HUMAN accepts the analysis -> drives the M24 output approval -----------------------------
  const accepted = await reviews.reviewAnalysis(reviewerCtx, reviewer, analysis.id, analysis.version, {
    decision: 'accept',
    reason: 'sound',
  });
  t.ok(accepted.status === 'accepted' && accepted.reviewed_by === reviewer, 'a human accepts the analysis');
  const m24Output = await db.withTenant(adminCtx, (tx) =>
    aiRepo.findOutput(tx, accepted.ai_output_ref ?? ''),
  );
  t.equal(m24Output?.status, 'approved', 'accepting drove the M24 output to approved (governed by M24)');

  // --- an explainable suggestion (bigint minor units, never float) --------------------------------
  const suggestion = await suggestions.createSuggestion(adminCtx, admin, {
    analysisId: accepted.id,
    suggestionType: 'exact_reference_match',
    sourceRef: randomUUID(),
    targetRef: randomUUID(),
    amountMinor: 250000,
    currency: 'USD',
    confidenceBps: 8000,
  });
  t.equal(suggestion.status, 'suggested', 'a suggestion starts suggested (advisory only)');
  t.equal(
    suggestion.amount_minor,
    '250000',
    'amount is carried as a bigint minor-unit string (never a float)',
  );

  // --- EXPLAINABILITY GATE: an unexplained match cannot be accepted, then can once a feature exists
  await t.rejects(
    suggestions.decideSuggestion(reviewerCtx, reviewer, suggestion.id, suggestion.version, {
      decision: 'accept',
    }),
    'an unexplained match (0 features) cannot be accepted (fail closed)',
  );
  await suggestions.addFeature(adminCtx, admin, suggestion.id, {
    featureType: 'reference',
    weightBps: 9000,
    reasonCode: 'reference_exact',
  });
  const withFeat = await suggestions.getSuggestion(reviewerCtx, suggestion.id);
  t.equal(
    withFeat.suggestion.feature_count,
    1,
    'a matched feature is recorded and bumps the count (explainability)',
  );
  const decided = await suggestions.decideSuggestion(
    reviewerCtx,
    reviewer,
    withFeat.suggestion.id,
    withFeat.suggestion.version,
    { decision: 'accept', reason: 'will match manually' },
  );
  t.ok(
    decided.status === 'accepted' && decided.decided_by === reviewer,
    'a human accepts the explained suggestion — m27 records it but never auto-matches/posts',
  );

  // --- classify a recon exception (advisory) -----------------------------------------------------
  const cls = await analyses.classifyException(adminCtx, admin, {
    analysisId: accepted.id,
    exceptionRef: randomUUID(),
    category: 'timing_difference',
    confidenceBps: 7000,
  });
  t.equal(cls.category, 'timing_difference', 'an exception is classified (advisory)');

  // --- evidence link (opaque m15/m20 ref, never content) -----------------------------------------
  const ev = await evidence.addEvidence(adminCtx, admin, {
    targetType: 'suggestion',
    targetId: suggestion.id,
    sourceType: 'bank_line',
    sourceRef: randomUUID(),
    confidenceBps: 8000,
  });
  t.ok(ev.id !== '', 'evidence is linked by opaque reference');

  // --- DLP-blocked restricted analysis fails closed ----------------------------------------------
  const restricted = await analyses.requestAnalysis(adminCtx, admin, {
    subjectType: 'gl_recon',
    subjectRef: randomUUID(),
    classification: 'restricted',
    analysisKind: 'anomaly_detection',
    providerId: provider.id,
    modelId: model.id,
    inputSample: 'the password is hunter2',
  });
  t.equal(restricted.status, 'failed', 'a DLP-blocked restricted analysis fails closed (M24 governance)');

  // --- no autonomous action: a review without a human reviewer is refused ------------------------
  await t.rejects(
    reviews.reviewAnalysis(reviewerCtx, null, restricted.id, restricted.version, { decision: 'accept' }),
    'a review without a human reviewer is refused (no auto-post)',
  );

  // --- optimistic concurrency (stale review rejects) --------------------------------------------
  const staleRef = randomUUID();
  const stale = await analyses.requestAnalysis(adminCtx, admin, {
    subjectType: 'bank_recon',
    subjectRef: staleRef,
    classification: 'confidential',
    analysisKind: 'match_suggestion',
    providerId: provider.id,
    modelId: model.id,
    inputSample: 'x',
  });
  await t.rejects(
    reviews.reviewAnalysis(reviewerCtx, reviewer, stale.id, stale.version + 99, { decision: 'accept' }),
    'a stale expectedVersion is rejected (optimistic concurrency)',
  );

  // --- default deny -----------------------------------------------------------------------------
  const noPerm = ctxOf(admin, []);
  await t.rejects(
    analyses.requestAnalysis(noPerm, admin, {
      subjectType: 'bank_recon',
      subjectRef: randomUUID(),
      analysisKind: 'match_suggestion',
    }),
    'a caller without ai.finance.analyze is denied (default deny)',
  );
  await t.rejects(
    suggestions.decideSuggestion(noPerm, reviewer, suggestion.id, decided.version, { decision: 'reject' }),
    'a caller without ai.finance.review is denied',
  );

  // --- audit carries NO secret / content --------------------------------------------------------
  t.ok(audit.entries.length >= 8, 'AI_ / AI_FINANCE_ audit entries were recorded');
  const auditJson = JSON.stringify(audit.entries);
  t.ok(
    !auditJson.includes('hunter2') &&
      !auditJson.includes('suggest matches for this bank recon') &&
      !auditJson.includes('secretref:'),
    'no secret or prompt/input content appears in any audit entry',
  );
  t.ok(
    audit.entries.some((e) => e.code === 'AI_FINANCE_ANALYSIS_COMPLETED') &&
      audit.entries.some((e) => e.code === 'AI_FINANCE_ANALYSIS_ACCEPTED') &&
      audit.entries.some((e) => e.code === 'AI_FINANCE_SUGGESTION_REVIEWED'),
    'analysis completion, human acceptance and suggestion review are all audited (AI_FINANCE_)',
  );

  // --- cross-tenant isolation -------------------------------------------------------------------
  const otherTenant: RequestContext = { ...adminCtx, tenantId: randomUUID() };
  await t.rejects(
    analyses.getAnalysis(otherTenant, analysis.id),
    "another tenant cannot read this tenant's analysis (RLS)",
  );
});
