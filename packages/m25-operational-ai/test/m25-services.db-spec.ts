import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import { M24Emitter, AiRepository, CatalogService, ALL_M24_PERMISSIONS } from '@finapp/m24-ai-foundation';
import {
  M24AiGateway,
  M25Emitter,
  OperationalAiRepository,
  ConfigService,
  OperationalAiService,
  SuggestionService,
  ALL_M25_PERMISSIONS,
} from '@finapp/m25-operational-ai';

/**
 * M25 services DB spec — proves the GOVERNED operational-AI pipeline END TO END on a REAL PostgreSQL, consuming M24 BY
 * CONTRACT: register + approve an M24 provider/model; request a governed analysis of a feedback subject (M24 does DLP ->
 * routing -> generate; the analysis lands in review_pending, NEVER auto-accepted); a HUMAN accepts it, which drives the
 * M24 output approval; create a recommends-only suggestion from the accepted analysis and have a HUMAN decide it — M25
 * records the decision but NEVER acts on m12/m13; a DLP-blocked restricted analysis fails closed (analysis 'failed');
 * a review without a human reviewer is refused (recommends only); a suggestion cannot be created from a non-accepted
 * analysis; default deny; AI_OPS_ audit with NO secret/content; and cross-tenant isolation. M25 owns no provider, no
 * routing, no DLP and no outbox — all of that is M24's, never duplicated.
 */
export default defineDbSpec('m25-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const aiRepo = new AiRepository();
  const m24Emitter = new M24Emitter(audit, outbox);
  const m24Catalog = new CatalogService(db, authz, m24Emitter, aiRepo);
  const gateway = new M24AiGateway(db, authz, m24Emitter, aiRepo);
  const m25Emitter = new M25Emitter(audit);
  const repo = new OperationalAiRepository();
  const config = new ConfigService(db, authz, m25Emitter, repo);
  const operational = new OperationalAiService(db, authz, m25Emitter, gateway, repo);
  const suggestions = new SuggestionService(db, authz, m25Emitter, repo);

  const tenant = randomUUID();
  const admin = randomUUID();
  const reviewer = randomUUID();
  const perms = [...ALL_M24_PERMISSIONS, ...ALL_M25_PERMISSIONS];
  const ctxOf = (userId: string, p: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId,
    correlationId: randomUUID(),
    permissions: [...p],
  });
  const adminCtx = ctxOf(admin, perms);
  const reviewerCtx = ctxOf(reviewer, perms);

  // --- set up an approved M24 provider + model (m25 owns none) -----------------------------------
  const provider = await m24Catalog.registerProvider(adminCtx, admin, {
    code: 'local-ops',
    classifications: ['internal', 'confidential'],
    secretReference: `secretref:vault/${randomUUID()}`,
  });
  const approved = await m24Catalog.approveProvider(adminCtx, admin, provider.id, provider.version);
  t.ok(approved.approved, 'an M24 provider is approved (m25 consumes it by contract)');
  const model = await m24Catalog.registerModel(adminCtx, admin, {
    providerId: provider.id,
    code: 'ops-sm',
    ratePer1kMinor: 20,
  });

  // --- config: human review on, auto-apply off ---------------------------------------------------
  const cfg = await config.createConfig(adminCtx, admin, {
    scope: 'default',
    minConfidenceBps: 5000,
    idempotencyKey: `cfg-${randomUUID()}`,
  });
  const published = await config.publishConfig(adminCtx, admin, cfg.id, cfg.version);
  t.ok(
    published.status === 'active' && published.require_human_review && !published.auto_apply,
    'config publishes with human review on + auto-apply off',
  );

  // --- request a governed analysis (NEVER auto-accepted) -----------------------------------------
  const feedbackRef = randomUUID();
  const idem = `an-${randomUUID()}`;
  const analysis = await operational.requestAnalysis(adminCtx, admin, {
    subjectType: 'feedback',
    subjectRef: feedbackRef,
    classification: 'internal',
    analysisKind: 'summary',
    providerId: provider.id,
    modelId: model.id,
    inputSample: 'please summarise this feedback',
    idempotencyKey: idem,
  });
  t.equal(analysis.status, 'review_pending', 'a generated analysis awaits HUMAN review — NOT auto-accepted');
  t.ok(
    analysis.ai_request_ref !== null && analysis.ai_output_ref !== null,
    'the analysis references the opaque M24 request + output',
  );
  t.ok(
    analysis.confidence_bps >= 0 && analysis.confidence_bps <= 10000,
    'confidence is integer basis points (preserved from M24)',
  );
  const replay = await operational.requestAnalysis(adminCtx, admin, {
    subjectType: 'feedback',
    subjectRef: feedbackRef,
    analysisKind: 'summary',
    idempotencyKey: idem,
  });
  t.equal(replay.id, analysis.id, 'analysis is idempotent per key (no duplicate M24 generation)');

  // --- a HUMAN accepts the analysis -> drives the M24 output approval -----------------------------
  const accepted = await operational.reviewAnalysis(reviewerCtx, reviewer, analysis.id, analysis.version, {
    decision: 'accept',
    sentimentLabel: 'positive',
  });
  t.ok(accepted.status === 'accepted' && accepted.reviewed_by === reviewer, 'a human accepts the analysis');
  const m24Output = await db.withTenant(adminCtx, (tx) =>
    aiRepo.findOutput(tx, accepted.ai_output_ref ?? ''),
  );
  t.equal(
    m24Output?.status,
    'approved',
    'accepting the analysis drove the M24 output to approved (governed by M24)',
  );

  // --- a recommends-only suggestion, decided by a HUMAN (m25 never acts) -------------------------
  const suggestion = await suggestions.createSuggestion(adminCtx, admin, {
    analysisId: accepted.id,
    suggestionType: 'escalation',
    recommendedRef: randomUUID(),
    confidenceBps: 6000,
  });
  t.equal(suggestion.status, 'suggested', 'a suggestion starts suggested (recommends only)');
  const decided = await suggestions.decideSuggestion(
    reviewerCtx,
    reviewer,
    suggestion.id,
    suggestion.version,
    { decision: 'accept', reason: 'will escalate manually' },
  );
  t.ok(
    decided.status === 'accepted' && decided.decided_by === reviewer,
    'a human decides the suggestion — m25 records it but never acts on m12/m13',
  );

  // --- a suggestion cannot be created from a non-accepted analysis -------------------------------
  const pendingAnalysis = await operational.requestAnalysis(adminCtx, admin, {
    subjectType: 'case',
    subjectRef: randomUUID(),
    classification: 'internal',
    analysisKind: 'sentiment',
    providerId: provider.id,
    modelId: model.id,
    inputSample: 'analyse this case',
  });
  await t.rejects(
    suggestions.createSuggestion(adminCtx, admin, {
      analysisId: pendingAnalysis.id,
      suggestionType: 'activity',
    }),
    'a suggestion can only be created from a human-accepted analysis (recommends only)',
  );

  // --- no autonomous action: a review without a human reviewer is refused ------------------------
  await t.rejects(
    operational.reviewAnalysis(reviewerCtx, null, pendingAnalysis.id, pendingAnalysis.version, {
      decision: 'accept',
    }),
    'a review without a human reviewer is refused (no autonomous action)',
  );

  // --- DLP-blocked restricted analysis fails closed ----------------------------------------------
  const restricted = await operational.requestAnalysis(adminCtx, admin, {
    subjectType: 'case',
    subjectRef: randomUUID(),
    classification: 'restricted',
    analysisKind: 'summary',
    providerId: provider.id,
    modelId: model.id,
    inputSample: 'the password is hunter2',
  });
  t.equal(restricted.status, 'failed', 'a DLP-blocked restricted analysis fails closed (M24 governance)');

  // --- optimistic concurrency (stale review rejects) --------------------------------------------
  const staleSubject = randomUUID();
  const staleAnalysis = await operational.requestAnalysis(adminCtx, admin, {
    subjectType: 'feedback',
    subjectRef: staleSubject,
    classification: 'internal',
    analysisKind: 'summary',
    providerId: provider.id,
    modelId: model.id,
    inputSample: 'x',
  });
  await t.rejects(
    operational.reviewAnalysis(reviewerCtx, reviewer, staleAnalysis.id, staleAnalysis.version + 99, {
      decision: 'accept',
    }),
    'a stale expectedVersion is rejected (optimistic concurrency)',
  );

  // --- default deny -----------------------------------------------------------------------------
  const noPerm = ctxOf(admin, []);
  await t.rejects(
    operational.requestAnalysis(noPerm, admin, {
      subjectType: 'feedback',
      subjectRef: randomUUID(),
      analysisKind: 'summary',
    }),
    'a caller without ai.operational.analyze is denied (default deny)',
  );
  await t.rejects(
    suggestions.decideSuggestion(noPerm, reviewer, suggestion.id, decided.version, { decision: 'reject' }),
    'a caller without ai.suggestion.decide is denied',
  );

  // --- audit carries NO secret / content --------------------------------------------------------
  t.ok(audit.entries.length >= 6, 'AI_ / AI_OPS_ audit entries were recorded');
  const auditJson = JSON.stringify(audit.entries);
  t.ok(
    !auditJson.includes('hunter2') &&
      !auditJson.includes('summarise this feedback') &&
      !auditJson.includes('secretref:'),
    'no secret or prompt/input content appears in any audit entry',
  );
  t.ok(
    audit.entries.some((e) => e.code === 'AI_OPS_ANALYSIS_GENERATED') &&
      audit.entries.some((e) => e.code === 'AI_OPS_ANALYSIS_ACCEPTED') &&
      audit.entries.some((e) => e.code === 'AI_OPS_SUGGESTION_DECIDED'),
    'the analysis generation, human acceptance and suggestion decision are all audited (AI_OPS_)',
  );

  // --- cross-tenant isolation -------------------------------------------------------------------
  const otherTenant: RequestContext = { ...adminCtx, tenantId: randomUUID() };
  await t.rejects(
    operational.getAnalysis(otherTenant, analysis.id),
    "another tenant cannot read this tenant's analysis (RLS)",
  );
});
