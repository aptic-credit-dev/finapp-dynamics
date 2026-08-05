import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  AI_REQUEST_LIFECYCLE_FAMILY,
  AI_OUTPUT_LIFECYCLE_FAMILY,
  AI_GOVERNANCE_LIFECYCLE_FAMILY,
} from '@finapp/contracts';
import {
  M24Emitter,
  AiRepository,
  CatalogService,
  RequestService,
  ReviewService,
  ALL_M24_PERMISSIONS,
} from '@finapp/m24-ai-foundation';

/**
 * M24 services DB spec — proves the GOVERNED AI foundation END TO END on a REAL PostgreSQL: register + approve a
 * provider (secret REFERENCE only) for a data classification; register a model; submit a request (idempotent); PROCESS
 * it through the governance pipeline (DLP -> approved-provider routing -> deterministic generation -> usage/cost ->
 * draft output in review_pending) — and prove the request is NEVER completed autonomously; a HUMAN then reviews and
 * approves, which completes the request; DLP BLOCKS a secret-looking restricted input (fail closed, request rejected);
 * routing REFUSES restricted data to a provider not approved for restricted (fail closed); the no-autonomous-action gate
 * refuses approval without a human reviewer and without required citations (then succeeds once a citation is recorded);
 * optimistic-concurrency (stale-version) rejection; default deny; AI_ audit with NO secret/prompt content in any entry;
 * events land on the ONE m06 outbox under the three AI families carrying opaque refs only (isAssistive, never content);
 * and cross-tenant isolation. m24 NEVER approves, posts, files or executes — a person does. No network, no secret.
 */
export default defineDbSpec('m24-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M24Emitter(audit, outbox);
  const repo = new AiRepository();
  const catalog = new CatalogService(db, authz, emitter, repo);
  const requests = new RequestService(db, authz, emitter, repo);
  const reviews = new ReviewService(db, authz, emitter, repo);

  const tenant = randomUUID();
  const admin = randomUUID();
  const reviewer = randomUUID();
  const ctxOf = (userId: string, perms: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId,
    correlationId: randomUUID(),
    permissions: [...perms],
  });
  const adminCtx = ctxOf(admin, ALL_M24_PERMISSIONS);
  const reviewerCtx = ctxOf(reviewer, ALL_M24_PERMISSIONS);
  const SECRET_REF = `secretref:vault/ai/${randomUUID()}`;

  // --- register + approve a provider (secret REFERENCE only), register a model ------------------
  const provider = await catalog.registerProvider(adminCtx, admin, {
    code: 'local-llm',
    name: 'Local LLM',
    kind: 'local',
    classifications: ['confidential', 'restricted'],
    secretReference: SECRET_REF,
  });
  t.equal(provider.status, 'draft', 'a registered provider starts draft (not yet approved)');
  await t.rejects(
    catalog.registerProvider(adminCtx, admin, { code: 'bad', secretReference: 'inline-secret-value' }),
    'an inline secret is rejected at the service (references only)',
  );
  const approved = await catalog.approveProvider(adminCtx, admin, provider.id, provider.version);
  t.ok(
    approved.approved && approved.status === 'active',
    'a provider approves + activates for its classifications',
  );
  const model = await catalog.registerModel(adminCtx, admin, {
    providerId: provider.id,
    code: 'local-sm',
    ratePer1kMinor: 30,
  });
  t.equal(model.status, 'active', 'a model registers + activates');

  // --- submit a request (idempotent) ------------------------------------------------------------
  const idem = `req-${randomUUID()}`;
  const submitted = await requests.submitRequest(adminCtx, admin, {
    subjectType: 'case',
    classification: 'confidential',
    providerId: provider.id,
    modelId: model.id,
    idempotencyKey: idem,
  });
  t.equal(submitted.status, 'received', 'a submitted request starts received');
  const again = await requests.submitRequest(adminCtx, admin, {
    classification: 'confidential',
    idempotencyKey: idem,
  });
  t.equal(again.id, submitted.id, 'submission is idempotent per key (no duplicate request)');

  // --- process: DLP -> routing -> generate -> draft output in review_pending (NEVER autonomous) --
  const processed = await requests.processRequest(adminCtx, admin, submitted.id, submitted.version, {
    inputSample: 'please summarise this case file',
    outputKind: 'summary',
  });
  t.equal(
    processed.request.status,
    'review_pending',
    'a processed request awaits HUMAN review — NOT completed autonomously',
  );
  t.equal(
    processed.output.status,
    'review_pending',
    'the AI output is a recommendation awaiting human review',
  );
  t.ok(
    processed.output.confidence_bps >= 0 && processed.output.confidence_bps <= 10000,
    'confidence is integer basis points',
  );
  const usage = await db.withTenant(adminCtx, (tx) => repo.listUsage(tx, submitted.id));
  t.ok(
    usage.length === 1 && Number(usage[0]?.cost_minor) >= 0,
    'usage + cost (bigint minor units) is recorded',
  );

  // --- a HUMAN reviews + approves -> the request completes ---------------------------------------
  const approvedOutput = await reviews.reviewOutput(
    reviewerCtx,
    reviewer,
    processed.output.id,
    processed.output.version,
    {
      decision: 'approved',
      reason: 'looks correct',
    },
  );
  t.ok(
    approvedOutput.status === 'approved' && approvedOutput.reviewed_by === reviewer,
    'a human reviewer approves the output',
  );
  const done = await requests.getRequest(adminCtx, submitted.id);
  t.equal(
    done.request.status,
    'completed',
    'approving the output completes the parent request (human decision)',
  );

  // --- DLP BLOCKS a secret-looking restricted input (fail closed) -------------------------------
  const restricted = await requests.submitRequest(adminCtx, admin, {
    classification: 'restricted',
    providerId: provider.id,
    modelId: model.id,
  });
  await t.rejects(
    requests.processRequest(adminCtx, admin, restricted.id, restricted.version, {
      inputSample: 'the password is hunter2',
    }),
    'DLP blocks a secret-looking restricted input (fail closed)',
  );
  const blocked = await requests.getRequest(adminCtx, restricted.id);
  t.equal(blocked.request.status, 'rejected', 'a DLP-blocked request is rejected, not silently dropped');

  // --- routing REFUSES restricted data to a provider not approved for restricted -----------------
  const internalOnly = await catalog.registerProvider(adminCtx, admin, {
    code: 'internal-only',
    classifications: ['internal'],
  });
  const internalApproved = await catalog.approveProvider(
    adminCtx,
    admin,
    internalOnly.id,
    internalOnly.version,
  );
  const misrouted = await requests.submitRequest(adminCtx, admin, {
    classification: 'restricted',
    providerId: internalApproved.id,
    modelId: model.id,
  });
  await t.rejects(
    requests.processRequest(adminCtx, admin, misrouted.id, misrouted.version, { inputSample: 'benign text' }),
    'restricted data may NEVER route to a provider not approved for restricted (fail closed)',
  );

  // --- NO AUTONOMOUS APPROVAL + CITATIONS REQUIRED ----------------------------------------------
  const citeReq = await requests.submitRequest(adminCtx, admin, {
    classification: 'confidential',
    providerId: provider.id,
    modelId: model.id,
  });
  const citeProc = await requests.processRequest(adminCtx, admin, citeReq.id, citeReq.version, {
    inputSample: 'summarise with sources',
    outputKind: 'answer',
    citationsRequired: true,
  });
  await t.rejects(
    reviews.reviewOutput(reviewerCtx, null, citeProc.output.id, citeProc.output.version, {
      decision: 'approved',
    }),
    'approval without a human reviewer is refused (no autonomous action)',
  );
  await t.rejects(
    reviews.reviewOutput(reviewerCtx, reviewer, citeProc.output.id, citeProc.output.version, {
      decision: 'approved',
    }),
    'a citations-required output cannot be approved with zero citations (fail closed)',
  );
  await reviews.addCitation(reviewerCtx, reviewer, citeProc.output.id, {
    documentRef: randomUUID(),
    span: 'p.1',
    confidenceBps: 9000,
  });
  const withCite = await reviews.getOutput(reviewerCtx, citeProc.output.id);
  t.equal(withCite.output.citation_count, 1, 'a source citation is recorded on the output');
  const citeApproved = await reviews.reviewOutput(
    reviewerCtx,
    reviewer,
    citeProc.output.id,
    withCite.output.version,
    { decision: 'approved' },
  );
  t.equal(citeApproved.status, 'approved', 'once a citation is recorded, a human may approve');

  // --- optimistic concurrency (stale review rejects) --------------------------------------------
  const staleReq = await requests.submitRequest(adminCtx, admin, {
    classification: 'confidential',
    providerId: provider.id,
    modelId: model.id,
  });
  const staleProc = await requests.processRequest(adminCtx, admin, staleReq.id, staleReq.version, {
    inputSample: 'x',
  });
  await t.rejects(
    reviews.reviewOutput(reviewerCtx, reviewer, staleProc.output.id, staleProc.output.version + 99, {
      decision: 'approved',
    }),
    'a stale expectedVersion is rejected (optimistic concurrency)',
  );

  // --- default deny -----------------------------------------------------------------------------
  const noPerm = ctxOf(admin, []);
  await t.rejects(
    catalog.registerProvider(noPerm, admin, { code: 'nope' }),
    'a caller without ai.provider.manage is denied (default deny)',
  );
  await t.rejects(
    reviews.reviewOutput(noPerm, reviewer, staleProc.output.id, staleProc.output.version, {
      decision: 'approved',
    }),
    'a caller without ai.output.review is denied',
  );

  // --- audit carries NO secret / prompt content -------------------------------------------------
  t.ok(audit.entries.length >= 6, 'AI_ audit entries were recorded for governed mutations');
  const auditJson = JSON.stringify(audit.entries);
  t.ok(
    !auditJson.includes(SECRET_REF) &&
      !auditJson.includes('secretref:') &&
      !auditJson.includes('hunter2') &&
      !auditJson.includes('case file'),
    'no secret reference or prompt/input content appears in any audit entry (data minimisation)',
  );
  t.ok(
    audit.entries.some((e) => e.code === 'AI_PROVIDER_APPROVED') &&
      audit.entries.some((e) => e.code === 'AI_OUTPUT_APPROVED') &&
      audit.entries.some((e) => e.code === 'AI_DLP_BLOCKED'),
    'provider approval, output approval and the DLP block are all audited (nothing disappears silently)',
  );

  // --- events land on the ONE outbox under the three AI families, opaque + assistive only --------
  const families = new Set(outbox.events.map((e) => e.family));
  t.ok(
    families.has(AI_REQUEST_LIFECYCLE_FAMILY) &&
      families.has(AI_OUTPUT_LIFECYCLE_FAMILY) &&
      families.has(AI_GOVERNANCE_LIFECYCLE_FAMILY),
    'events are published under all three AI lifecycle families',
  );
  const eventsJson = JSON.stringify(outbox.events);
  t.ok(
    !eventsJson.includes(SECRET_REF) && !eventsJson.includes('hunter2') && !eventsJson.includes('case file'),
    'no secret or prompt/input content appears in any published event (opaque references only)',
  );
  t.ok(
    outbox.events.every((e) => (e.payload as { isAssistive?: boolean }).isAssistive === true),
    'every AI event is marked assistive (AI recommends; a human decides)',
  );

  // --- cross-tenant isolation -------------------------------------------------------------------
  const otherTenant: RequestContext = { ...adminCtx, tenantId: randomUUID() };
  await t.rejects(
    requests.getRequest(otherTenant, submitted.id),
    "another tenant cannot read this tenant's request (RLS)",
  );
});
