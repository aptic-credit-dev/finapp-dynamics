/**
 * CopilotQueryService — the GOVERNED, READ-ONLY executive-query pipeline. It orchestrates, through explicit transition
 * choke points, the query lifecycle:
 *   received -> authorized -> masked -> evidence_resolved -> ai_requested -> generated -> validated -> completed
 * and, fail-closed, -> refused | failed. In order it: authorizes (default deny; platform/sensitive need their own
 * privileged permission); screens the READ-ONLY / command gate and PROMPT-INJECTION gate (a mutating/controlled or
 * jailbreak intent is durably REFUSED, no side effect); resolves cross-domain evidence through READ-ONLY ports and MASKS
 * it to the caller's entitlements (the copilot never expands the caller's authority); asks M24 for a governed, cited
 * answer BY CONTRACT (DLP/routing/confidence live in M24); persists a CITED response (a completed response MUST carry a
 * citation — no uncited factual answer, else review_required); and audits every step. It NEVER mutates a business
 * record, approves, posts or executes any controlled action — the executive who reads the answer is the human decider.
 *
 * The M24 gateway opens its own transactions, so it is called BETWEEN this service's transactions (never nested).
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M28_PERMISSIONS } from './permissions.ts';
import { M28_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import {
  type Caller,
  type QueryStatus,
  checkQueryTransition,
  checkResponseTransition,
  clampMaxSources,
  evaluateCitationGate,
  evaluateReadOnlyGate,
  isDataClassification,
  isIntentClass,
  isScopeLevel,
  isSensitiveClassification,
  M28_LIMITS,
  REASON_CODES,
  screenPromptInjection,
} from './domain.ts';
import { ExecutiveAiRepository, type QueryRow, type ResponseRow } from './repository.ts';
import type { CopilotAiGatewayPort } from './gateway.ts';
import type { ExecutiveSummaryService } from './summary.service.ts';
import type { M28Emitter } from './emit.ts';

export interface SubmitQueryInput {
  readonly sessionId: string;
  readonly question: string;
  readonly intentClass?: string;
  readonly classification?: string;
  readonly scopeLevel?: string;
  /** opaque m09 reference to the full question text (never stored inline). */
  readonly questionRef?: string | null;
  readonly providerId?: string | null;
  readonly modelId?: string | null;
  readonly promptId?: string | null;
  readonly maxSources?: number;
  readonly idempotencyKey?: string | null;
}

export interface QueryWithResponse {
  readonly query: QueryRow;
  readonly response: ResponseRow | null;
}

export class CopilotQueryService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M28Emitter;
  private readonly gateway: CopilotAiGatewayPort;
  private readonly summaries: ExecutiveSummaryService;
  private readonly repo: ExecutiveAiRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M28Emitter,
    gateway: CopilotAiGatewayPort,
    summaries: ExecutiveSummaryService,
    repo: ExecutiveAiRepository = new ExecutiveAiRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.gateway = gateway;
    this.summaries = summaries;
    this.repo = repo;
  }

  async submitQuery(
    ctx: RequestContext,
    actor: string | null,
    input: SubmitQueryInput,
  ): Promise<QueryWithResponse> {
    await this.authz.require(ctx, M28_PERMISSIONS.copilotQuery);

    const scopeLevel = input.scopeLevel ?? 'tenant';
    if (!isScopeLevel(scopeLevel)) throw badRequest('unknown scope level.', ctx.correlationId);
    const classification = input.classification ?? 'internal';
    if (!isDataClassification(classification))
      throw badRequest('unknown data classification.', ctx.correlationId);
    const intentClass = input.intentClass ?? 'executive_question';
    if (!isIntentClass(intentClass)) throw badRequest('unknown intent class.', ctx.correlationId);
    const question = input.question;
    if (question.trim() === '') throw badRequest('a question is required.', ctx.correlationId);
    if (question.length > M28_LIMITS.maxQuestionLength)
      throw badRequest('the question is too long.', ctx.correlationId);

    // Platform scope + sensitive classification each require their own dedicated privileged permission (default deny).
    if (scopeLevel === 'platform') await this.authz.require(ctx, M28_PERMISSIONS.copilotPlatform);
    const sensitive = isSensitiveClassification(classification);
    if (sensitive) await this.authz.require(ctx, M28_PERMISSIONS.copilotSensitive);

    // --- idempotency: a replayed key returns the SAME query + response (no duplicate M24 handoff) ---
    if (input.idempotencyKey != null && input.idempotencyKey !== '') {
      const existing = await this.db.withTenant(ctx, (tx) =>
        this.repo.findQueryByIdempotencyKey(tx, input.idempotencyKey ?? ''),
      );
      if (existing !== null) {
        const response = await this.db.withTenant(ctx, (tx) =>
          this.repo.findResponseByQuery(tx, existing.id),
        );
        return { query: existing, response };
      }
    }

    // --- READ-ONLY + PROMPT-INJECTION gates: a mutating/controlled or jailbreak intent is durably REFUSED --------
    const readOnly = evaluateReadOnlyGate(question);
    const injection = screenPromptInjection(question);
    const refusalReason = !readOnly.allowed
      ? readOnly.reasonCode
      : !injection.safe
        ? injection.reasonCode
        : null;

    // --- Phase 1 (tx1): create the query. On refusal, persist it as 'refused' and return (safe refusal). ----------
    const created = await this.db.withTenant(ctx, async (tx) => {
      const q = await this.repo.insertQuery(tx, {
        tenantId: ctx.tenantId,
        sessionId: input.sessionId,
        intentClass,
        scopeLevel,
        classification,
        questionRef: input.questionRef ?? null,
        status: 'received',
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      if (input.idempotencyKey != null && input.idempotencyKey !== '')
        await this.repo.insertIdempotency(tx, {
          tenantId: ctx.tenantId,
          idempotencyKey: input.idempotencyKey,
          queryId: q.id,
          correlationId: ctx.correlationId,
          by: actor,
        });
      await this.repo.bumpSessionQueryCount(tx, input.sessionId, actor);

      if (refusalReason !== null) {
        const refused = await this.moveQuery(
          ctx,
          tx,
          q,
          'refused',
          { refusalReasonCode: refusalReason },
          actor,
        );
        await this.emitter.recordAudit(tx, ctx, {
          code: M28_AUDIT_CODES.queryRefused,
          entityType: 'copilot_query',
          entityId: q.id,
          detail: { intentClass, reasonCode: refusalReason },
        });
        return { query: refused, refused: true as const };
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: M28_AUDIT_CODES.querySubmitted,
        entityType: 'copilot_query',
        entityId: q.id,
        detail: { intentClass, scopeLevel, classification },
      });
      if (sensitive)
        await this.emitter.recordAudit(tx, ctx, {
          code: M28_AUDIT_CODES.sensitiveQuery,
          entityType: 'copilot_query',
          entityId: q.id,
          detail: { classification },
        });
      return { query: q, refused: false as const };
    });
    if (created.refused) return { query: created.query, response: null };

    // --- Phase 2 (no tx): resolve cross-domain evidence and MASK to the caller's entitlements --------------------
    const caller: Caller = {
      tenantId: ctx.tenantId,
      scopeLevel,
      entitlements: ctx.permissions,
      sensitiveAllowed: ctx.permissions.includes(M28_PERMISSIONS.copilotSensitive),
    };
    const resolved = await this.summaries.resolveEvidence(
      ctx,
      caller,
      intentClass,
      scopeLevel,
      input.maxSources,
    );

    // --- Phase 3 (no tx): ask M24 for a governed, cited answer BY CONTRACT (DLP/routing/confidence live in M24) ---
    // The question + evidence headlines are handed to M24 ONLY as a transient DLP/generation sample (M24 never persists
    // it); the copilot itself never stores the question inline (only an opaque m09 question_ref). This lets M24's DLP
    // scan the real input and BLOCK restricted content — fail closed.
    const inputSample = [question, ...resolved.visible.map((e) => e.headline)].join(' | ');
    const ai = await this.gateway.answer(ctx, actor, {
      subjectRef: input.questionRef ?? null,
      classification,
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      promptId: input.promptId ?? null,
      inputSample,
      outputKind: intentClass === 'executive_question' || intentClass === 'follow_up' ? 'answer' : 'summary',
      citationsRequired: true,
    });

    const bound = clampMaxSources(input.maxSources);

    // --- Phase 4 (tx2): march the lifecycle through the choke point; persist a CITED response; audit -------------
    return this.db.withTenant(ctx, async (tx) => {
      let q = (await this.repo.findQuery(tx, created.query.id)) ?? created.query;
      q = await this.moveQuery(ctx, tx, q, 'authorized', {}, actor);
      q = await this.moveQuery(ctx, tx, q, 'masked', {}, actor);
      q = await this.moveQuery(
        ctx,
        tx,
        q,
        'evidence_resolved',
        { sourceCount: resolved.visible.length },
        actor,
      );
      q = await this.moveQuery(ctx, tx, q, 'ai_requested', { aiRequestRef: ai.requestRef }, actor);

      if (!ai.generated) {
        // M24 refused (e.g. DLP block) — the copilot answer fails closed. No response, no uncited guess.
        const failed = await this.moveQuery(
          ctx,
          tx,
          q,
          'failed',
          { refusalReasonCode: ai.reasonCode },
          actor,
        );
        await this.emitter.recordAudit(tx, ctx, {
          code: M28_AUDIT_CODES.queryRefused,
          entityType: 'copilot_query',
          entityId: q.id,
          detail: { reasonCode: ai.reasonCode },
        });
        return { query: failed, response: null };
      }

      q = await this.moveQuery(ctx, tx, q, 'generated', { confidenceBps: ai.confidenceBps }, actor);

      // draft response, then persist ONLY entitlement-granted citations (masked evidence is never cited).
      let response = await this.repo.insertResponse(tx, {
        tenantId: ctx.tenantId,
        queryId: q.id,
        answerRef: null,
        aiOutputRef: ai.outputRef,
        confidenceBps: ai.confidenceBps,
        correlationId: ctx.correlationId,
        by: actor,
      });
      const cited = resolved.visible.slice(0, bound);
      for (const e of cited) {
        await this.repo.insertCitation(tx, {
          tenantId: ctx.tenantId,
          responseId: response.id,
          sourceType: e.citation.sourceType,
          sourceModule: e.citation.sourceModule,
          recordRef: e.citation.recordRef,
          documentRef: e.citation.documentRef,
          documentVersion: e.citation.documentVersion,
          location: e.citation.location,
          confidenceBps: e.citation.confidenceBps,
          by: actor,
          correlationId: ctx.correlationId,
        });
      }
      const citationCount = cited.length;

      // CITATION GATE: cite or become review_required (no uncited factual answer, no fabricated citation).
      const effective = await this.repo.findActiveConfig(tx, 'default');
      const minConf = effective?.min_confidence_bps ?? 0;
      const gate = evaluateCitationGate({
        citationsRequired: true,
        citationCount,
        confidenceBps: ai.confidenceBps,
        minConfidenceBps: minConf,
      });
      const reviewReason = resolved.analyticsUnavailable
        ? REASON_CODES.analyticsUnavailable
        : gate.reasonCode;

      if (citationCount < 1 || !gate.complete) {
        response =
          (await this.repo.updateResponse(tx, {
            id: response.id,
            expectedVersion: response.version,
            status: 'review_required',
            citationCount,
            reviewRequired: true,
            reasonCode: reviewReason,
            by: actor,
          })) ?? response;
        q = await this.moveQuery(ctx, tx, q, 'validated', {}, actor);
        q = await this.moveQuery(ctx, tx, q, 'completed', { confidenceBps: ai.confidenceBps }, actor);
        await this.emitter.recordAudit(tx, ctx, {
          code: M28_AUDIT_CODES.responseGenerated,
          entityType: 'copilot_response',
          entityId: response.id,
          detail: {
            status: 'review_required',
            citationCount,
            reasonCode: reviewReason,
            confidenceBps: ai.confidenceBps,
          },
        });
        return { query: q, response };
      }

      // cited + policy-cleared -> complete.
      response = await this.moveResponse(ctx, tx, response, 'citation_validated', { citationCount }, actor);
      response = await this.moveResponse(ctx, tx, response, 'policy_validated', {}, actor);
      response = await this.moveResponse(
        ctx,
        tx,
        response,
        'complete',
        { reasonCode: REASON_CODES.completed },
        actor,
      );
      q = await this.moveQuery(ctx, tx, q, 'validated', {}, actor);
      q = await this.moveQuery(ctx, tx, q, 'completed', { confidenceBps: ai.confidenceBps }, actor);
      await this.emitter.recordAudit(tx, ctx, {
        code: M28_AUDIT_CODES.responseGenerated,
        entityType: 'copilot_response',
        entityId: response.id,
        detail: { status: 'complete', citationCount, confidenceBps: ai.confidenceBps },
      });
      return { query: q, response };
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getQuery(ctx: RequestContext, id: string): Promise<QueryWithResponse> {
    await this.authz.require(ctx, M28_PERMISSIONS.copilotRead);
    return this.db.withTenant(ctx, async (tx) => {
      const query = await this.repo.findQuery(tx, id);
      if (query === null) throw ProblemError.notFound('Query not found.', ctx.correlationId);
      const response = await this.repo.findResponseByQuery(tx, id);
      return { query, response };
    });
  }

  async listQueries(
    ctx: RequestContext,
    sessionId: string | null,
    page: { limit?: number; offset?: number },
  ): Promise<QueryRow[]> {
    await this.authz.require(ctx, M28_PERMISSIONS.copilotRead);
    const limit = clampMaxSources(page.limit ?? M28_LIMITS.defaultPageSize);
    const offset = page.offset === undefined || page.offset < 0 ? 0 : Math.floor(page.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listQueries(tx, sessionId, limit, offset));
  }

  // --- lifecycle choke points -------------------------------------------------------------------
  private async moveQuery(
    ctx: RequestContext,
    tx: Tx,
    q: QueryRow,
    to: QueryStatus,
    patch: {
      confidenceBps?: number;
      sourceCount?: number;
      refusalReasonCode?: string;
      aiRequestRef?: string;
    },
    actor: string | null,
  ): Promise<QueryRow> {
    const t = checkQueryTransition(q.status, to);
    if (!t.ok) throw badRequest(`cannot move a ${q.status} query to ${to}.`, ctx.correlationId);
    const updated = await this.repo.updateQuery(tx, {
      id: q.id,
      expectedVersion: q.version,
      status: to,
      ...(patch.confidenceBps !== undefined ? { confidenceBps: patch.confidenceBps } : {}),
      ...(patch.sourceCount !== undefined ? { sourceCount: patch.sourceCount } : {}),
      ...(patch.refusalReasonCode !== undefined ? { refusalReasonCode: patch.refusalReasonCode } : {}),
      ...(patch.aiRequestRef !== undefined ? { aiRequestRef: patch.aiRequestRef } : {}),
      by: actor,
    });
    if (updated === null) throw ProblemError.conflict('Query modified concurrently.', ctx.correlationId);
    return updated;
  }

  private async moveResponse(
    ctx: RequestContext,
    tx: Tx,
    r: ResponseRow,
    to: string,
    patch: { citationCount?: number; reviewRequired?: boolean; reasonCode?: string },
    actor: string | null,
  ): Promise<ResponseRow> {
    const t = checkResponseTransition(r.status, to);
    if (!t.ok) throw badRequest(`cannot move a ${r.status} response to ${to}.`, ctx.correlationId);
    const updated = await this.repo.updateResponse(tx, {
      id: r.id,
      expectedVersion: r.version,
      status: to,
      ...(patch.citationCount !== undefined ? { citationCount: patch.citationCount } : {}),
      ...(patch.reviewRequired !== undefined ? { reviewRequired: patch.reviewRequired } : {}),
      ...(patch.reasonCode !== undefined ? { reasonCode: patch.reasonCode } : {}),
      by: actor,
    });
    if (updated === null) throw ProblemError.conflict('Response modified concurrently.', ctx.correlationId);
    return updated;
  }
}
