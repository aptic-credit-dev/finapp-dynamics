/**
 * RequestService — the GOVERNED AI request pipeline: submit (idempotent) then process (DLP -> approved-provider routing
 * -> generate -> draft output in review_pending). It enforces the governance invariants BEFORE any generation: DLP must
 * CLEAR before routing (restricted text is blocked, fail closed), and restricted/confidential data may only route to a
 * provider APPROVED for that classification. Generation goes through the provider PORT (a deterministic double — no
 * network, no secret). It records usage + cost (integer minor units) and leaves the output in `review_pending` — it
 * NEVER completes a request autonomously; a HUMAN completes it via review. The DLP input sample is used transiently
 * and never persisted (privacy); large input/output content lives behind m09 document references.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M24_PERMISSIONS } from './permissions.ts';
import { M24_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden } from './errors.ts';
import {
  checkRequestTransition,
  checkOutputTransition,
  isDataClassification,
  isOutputKind,
  evaluateRouting,
  REASON_CODES,
} from './domain.ts';
import type { AiProvider, DlpPolicyEvaluator, OutputValidator, UsageMeter, CostCalculator } from './ports.ts';
import {
  DeterministicProvider,
  DeterministicDlp,
  DeterministicValidator,
  DefaultUsageMeter,
  DefaultCostCalculator,
  SafePromptRenderer,
} from './ports.ts';
import { AiRepository, type RequestRow, type OutputRow } from './repository.ts';
import type { M24Emitter } from './emit.ts';

export class RequestService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M24Emitter;
  private readonly repo: AiRepository;
  private readonly provider: AiProvider;
  private readonly dlp: DlpPolicyEvaluator;
  private readonly validator: OutputValidator;
  private readonly usage: UsageMeter;
  private readonly cost: CostCalculator;
  private readonly renderer: SafePromptRenderer;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M24Emitter,
    repo: AiRepository = new AiRepository(),
    provider: AiProvider = new DeterministicProvider(),
    dlp: DlpPolicyEvaluator = new DeterministicDlp(),
    validator: OutputValidator = new DeterministicValidator(),
    usage: UsageMeter = new DefaultUsageMeter(),
    cost: CostCalculator = new DefaultCostCalculator(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.provider = provider;
    this.dlp = dlp;
    this.validator = validator;
    this.usage = usage;
    this.cost = cost;
    this.renderer = new SafePromptRenderer();
  }

  async submitRequest(
    ctx: RequestContext,
    actor: string | null,
    input: {
      subjectType?: string;
      subjectRef?: string | null;
      moduleRef?: string | null;
      classification?: string;
      providerId?: string | null;
      modelId?: string | null;
      promptId?: string | null;
      inputDocumentRef?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<RequestRow> {
    await this.authz.require(ctx, M24_PERMISSIONS.requestCreate);
    const classification = input.classification ?? 'internal';
    if (!isDataClassification(classification))
      throw badRequest('unknown data classification.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findRequestByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const req = await this.repo.insertRequest(tx, {
        tenantId: ctx.tenantId,
        subjectType: input.subjectType ?? 'generic',
        subjectRef: input.subjectRef ?? null,
        moduleRef: input.moduleRef ?? null,
        classification,
        providerId: input.providerId ?? null,
        modelId: input.modelId ?? null,
        promptId: input.promptId ?? null,
        inputDocumentRef: input.inputDocumentRef ?? null,
        requestedBy: actor,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      if (input.idempotencyKey != null && input.idempotencyKey !== '')
        await this.repo.insertIdempotency(tx, {
          tenantId: ctx.tenantId,
          idempotencyKey: input.idempotencyKey,
          requestId: req.id,
          correlationId: ctx.correlationId,
          by: actor,
        });
      await this.repo.insertRequestHistory(tx, {
        tenantId: ctx.tenantId,
        requestId: req.id,
        fromStatus: null,
        toStatus: 'received',
        reason: null,
        reasonCode: REASON_CODES.received,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M24_AUDIT_CODES.requestReceived,
        entityType: 'ai_request',
        entityId: req.id,
        detail: { classification },
      });
      await this.emitter.publishRequest(tx, {
        type: 'RequestReceived',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: req.id,
          recordType: 'request',
          requestId: req.id,
          classification,
          toStatus: 'received',
          isAssistive: true,
        },
      });
      return req;
    });
  }

  /**
   * Process a received request: DLP -> approved-provider routing -> generate -> draft output (review_pending). Fails
   * CLOSED at each gate. `inputSample` is used only for DLP scanning and is NEVER stored. It NEVER completes the request.
   *
   * Governance evidence is DURABLE: a refusal (DLP block, unapproved-provider routing) COMMITS the rejection + its DLP
   * finding / audit / governance event in its own transaction BEFORE the 403 is raised — so a blocked request is
   * durably 'rejected', never silently rolled back (a security event never disappears). The DLP gate and the routing/
   * generation stage are therefore separate transactions; each governed state is recorded before the next begins.
   */
  async processRequest(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    opts: {
      inputSample?: string;
      outputKind?: string;
      outputDocumentRef?: string | null;
      citationsRequired?: boolean;
    },
  ): Promise<{ request: RequestRow; output: OutputRow }> {
    await this.authz.require(ctx, M24_PERMISSIONS.requestCreate);
    const outputKind = opts.outputKind ?? 'summary';
    if (!isOutputKind(outputKind)) throw badRequest('unknown output kind.', ctx.correlationId);

    // --- Phase 1: DLP gate (own tx — commits dlp_checked, or a durable 'rejected' + evidence on block) ---
    const gate = await this.db.withTenant(ctx, async (tx) => {
      const req = await this.repo.findRequest(tx, id);
      if (req === null) throw ProblemError.notFound('Request not found.', ctx.correlationId);
      if (req.version !== expectedVersion)
        throw ProblemError.conflict('Request modified concurrently.', ctx.correlationId);
      if (req.status !== 'received')
        throw badRequest(`a ${req.status} request cannot be processed.`, ctx.correlationId);

      const dlp = await this.dlp.evaluate({
        classification: req.classification,
        text: opts.inputSample ?? '',
      });
      await this.repo.insertDlpFinding(tx, {
        tenantId: ctx.tenantId,
        requestId: id,
        classification: req.classification,
        action: dlp.action,
        reasonCode: dlp.reasonCode,
        findingCount: dlp.findingCount,
        correlationId: ctx.correlationId,
      });
      if (dlp.action === 'block') {
        const rejected = await this.moveRequest(ctx, tx, req, 'rejected', REASON_CODES.dlpBlocked, actor);
        await this.emitter.recordAudit(tx, ctx, {
          code: M24_AUDIT_CODES.dlpBlocked,
          entityType: 'ai_request',
          entityId: id,
          detail: { classification: req.classification },
        });
        await this.emitter.publishGovernance(tx, {
          type: 'DlpBlocked',
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            recordId: id,
            recordType: 'request',
            requestId: id,
            classification: req.classification,
            reasonCode: REASON_CODES.dlpBlocked,
            isAssistive: true,
          },
        });
        return { blocked: true as const, reasonCode: REASON_CODES.dlpBlocked, request: rejected };
      }
      const checked = await this.moveRequest(ctx, tx, req, 'dlp_checked', REASON_CODES.dlpCleared, actor, {
        dlpChecked: true,
        dlpAction: dlp.action,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M24_AUDIT_CODES.requestDlpChecked,
        entityType: 'ai_request',
        entityId: id,
        detail: {},
      });
      await this.emitter.publishRequest(tx, {
        type: 'DlpChecked',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: id,
          recordType: 'request',
          requestId: id,
          reasonCode: REASON_CODES.dlpCleared,
          toStatus: 'dlp_checked',
          isAssistive: true,
        },
      });
      return { blocked: false as const, request: checked };
    });
    // The DLP block is now durably committed; only then do we signal the refusal.
    if (gate.blocked) throw governanceForbidden(gate.reasonCode, ctx.correlationId);

    // --- Phase 2: approved-provider routing -> generate -> draft output (own tx; a routing refusal commits 'rejected') ---
    const result = await this.db.withTenant(ctx, async (tx) => {
      let cur = gate.request; // dlp_checked, current version (committed by phase 1)

      const provider = cur.provider_id !== null ? await this.repo.findProvider(tx, cur.provider_id) : null;
      const routing = evaluateRouting({
        classification: cur.classification,
        providerApproved: provider?.approved ?? false,
        providerClassifications: provider?.classifications ?? [],
        providerActive: provider?.status === 'active',
      });
      if (!routing.allowed) {
        await this.moveRequest(ctx, tx, cur, 'rejected', routing.reasonCode, actor);
        await this.emitter.recordAudit(tx, ctx, {
          code: M24_AUDIT_CODES.requestRejected,
          entityType: 'ai_request',
          entityId: id,
          detail: { reasonCode: routing.reasonCode },
        });
        await this.emitter.publishGovernance(tx, {
          type: 'DlpBlocked',
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            recordId: id,
            recordType: 'request',
            requestId: id,
            classification: cur.classification,
            reasonCode: routing.reasonCode,
            isAssistive: true,
          },
        });
        return { refused: true as const, reasonCode: routing.reasonCode };
      }
      cur = await this.moveRequest(ctx, tx, cur, 'routed', routing.reasonCode, actor, {
        providerApproved: true,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M24_AUDIT_CODES.requestRouted,
        entityType: 'ai_request',
        entityId: id,
        detail: { providerRef: provider?.id ?? null },
      });
      await this.emitter.publishRequest(tx, {
        type: 'RequestRouted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: id,
          recordType: 'request',
          requestId: id,
          ...(provider !== null ? { providerRef: provider.id } : {}),
          toStatus: 'routed',
          isAssistive: true,
        },
      });

      // --- generate (deterministic provider port; NO network, NO secret) ---
      cur = await this.moveRequest(ctx, tx, cur, 'generating', null, actor);
      const prompt = cur.prompt_id !== null ? await this.repo.findPrompt(tx, cur.prompt_id) : null;
      const model = cur.model_id !== null ? await this.repo.findModel(tx, cur.model_id) : null;
      const rendered = this.renderer.render(prompt?.template ?? '', { classification: cur.classification });
      const gen = await this.provider.generate({
        providerHandle: provider?.id ?? '',
        modelCode: model?.code ?? '',
        renderedPrompt: rendered + (opts.inputSample ?? ''),
        classification: cur.classification,
      });
      cur = await this.moveRequest(ctx, tx, cur, 'generated', REASON_CODES.generated, actor, {
        confidenceBps: gen.confidenceBps,
      });

      // usage + cost (integer minor units)
      const metered = this.usage.meter({
        promptTokens: gen.promptTokens,
        completionTokens: gen.completionTokens,
      });
      const costMinor = this.cost.cost(metered.totalTokens, Number(model?.rate_per_1k_minor ?? '0'));
      await this.repo.insertUsage(tx, {
        tenantId: ctx.tenantId,
        requestId: id,
        promptTokens: gen.promptTokens,
        completionTokens: gen.completionTokens,
        totalTokens: metered.totalTokens,
        costMinor,
        latencyMs: 0,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M24_AUDIT_CODES.usageRecorded,
        entityType: 'ai_usage',
        entityId: id,
        detail: { totalTokens: metered.totalTokens },
      });

      // draft output (a RECOMMENDATION; NOT completed — a human reviews it)
      const output = await this.repo.insertOutput(tx, {
        tenantId: ctx.tenantId,
        requestId: id,
        outputKind,
        outputDocumentRef: opts.outputDocumentRef ?? null,
        confidenceBps: gen.confidenceBps,
        citationsRequired: opts.citationsRequired ?? false,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertOutputHistory(tx, {
        tenantId: ctx.tenantId,
        outputId: output.id,
        requestId: id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: REASON_CODES.generated,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M24_AUDIT_CODES.outputDrafted,
        entityType: 'ai_output',
        entityId: output.id,
        detail: { outputKind, confidenceBps: gen.confidenceBps },
      });
      await this.emitter.publishOutput(tx, {
        type: 'OutputDrafted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: output.id,
          recordType: 'output',
          requestId: id,
          outputId: output.id,
          outputKind,
          confidenceBps: gen.confidenceBps,
          toStatus: 'draft',
          isAssistive: true,
        },
      });

      // validate (structural), then move to review_pending — a HUMAN completes it
      const val = await this.validator.validate(gen.content, outputKind);
      const validated = await this.repo.updateOutput(tx, {
        id: output.id,
        expectedVersion: output.version,
        status: val.valid ? 'validated' : 'rejected',
        reviewReasonCode: val.reasonCode,
        by: actor,
      });
      if (validated === null) throw ProblemError.conflict('Output modified concurrently.', ctx.correlationId);
      await this.repo.insertOutputHistory(tx, {
        tenantId: ctx.tenantId,
        outputId: output.id,
        requestId: id,
        fromStatus: 'draft',
        toStatus: validated.status,
        reason: null,
        reasonCode: val.reasonCode,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M24_AUDIT_CODES.outputValidated,
        entityType: 'ai_output',
        entityId: output.id,
        detail: { valid: val.valid },
      });

      let finalOutput = validated;
      let finalReq = cur;
      if (val.valid) {
        finalOutput =
          (await this.repo.updateOutput(tx, {
            id: output.id,
            expectedVersion: validated.version,
            status: 'review_pending',
            by: actor,
          })) ?? validated;
        await this.repo.insertOutputHistory(tx, {
          tenantId: ctx.tenantId,
          outputId: output.id,
          requestId: id,
          fromStatus: 'validated',
          toStatus: 'review_pending',
          reason: null,
          reasonCode: null,
          by: actor,
          correlationId: ctx.correlationId,
        });
        await this.emitter.publishOutput(tx, {
          type: 'OutputReviewPending',
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            recordId: output.id,
            recordType: 'output',
            requestId: id,
            outputId: output.id,
            toStatus: 'review_pending',
            isAssistive: true,
          },
        });
        finalReq = await this.moveRequest(ctx, tx, cur, 'review_pending', null, actor);
        await this.emitter.publishRequest(tx, {
          type: 'RequestGenerated',
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            recordId: id,
            recordType: 'request',
            requestId: id,
            confidenceBps: gen.confidenceBps,
            toStatus: 'review_pending',
            isAssistive: true,
          },
        });
      }
      return { refused: false as const, request: finalReq, output: finalOutput };
    });
    // The routing rejection is now durably committed; only then do we signal the refusal.
    if (result.refused) throw governanceForbidden(result.reasonCode, ctx.correlationId);
    return { request: result.request, output: result.output };
  }

  async cancelRequest(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    reason: string,
  ): Promise<RequestRow> {
    await this.authz.require(ctx, M24_PERMISSIONS.requestCancel);
    if (reason.trim() === '') throw badRequest('a cancellation reason is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const req = await this.repo.findRequest(tx, id);
      if (req === null) throw ProblemError.notFound('Request not found.', ctx.correlationId);
      const updated = await this.moveRequestChecked(
        ctx,
        tx,
        req,
        'cancelled',
        REASON_CODES.cancelled,
        expectedVersion,
        actor,
        reason,
      );
      await this.emitter.recordAudit(tx, ctx, {
        code: M24_AUDIT_CODES.requestCancelled,
        entityType: 'ai_request',
        entityId: id,
        detail: { reason },
      });
      return updated;
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getRequest(ctx: RequestContext, id: string): Promise<{ request: RequestRow; outputs: OutputRow[] }> {
    await this.authz.require(ctx, M24_PERMISSIONS.requestRead);
    return this.db.withTenant(ctx, async (tx) => {
      const request = await this.repo.findRequest(tx, id);
      if (request === null) throw ProblemError.notFound('Request not found.', ctx.correlationId);
      const outputs = await this.repo.listOutputs(tx, id);
      return { request, outputs };
    });
  }
  async listRequests(ctx: RequestContext, status?: string): Promise<RequestRow[]> {
    await this.authz.require(ctx, M24_PERMISSIONS.requestRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRequests(tx, status));
  }

  // --- helpers ----------------------------------------------------------------------------------
  private async moveRequest(
    ctx: RequestContext,
    tx: Tx,
    req: RequestRow,
    to: string,
    reasonCode: string | null,
    actor: string | null,
    extra?: { dlpChecked?: boolean; dlpAction?: string; providerApproved?: boolean; confidenceBps?: number },
  ): Promise<RequestRow> {
    const t = checkRequestTransition(req.status, to);
    if (!t.ok) throw badRequest(`cannot move a ${req.status} request to ${to}.`, ctx.correlationId);
    const updated = await this.repo.updateRequest(tx, {
      id: req.id,
      expectedVersion: req.version,
      status: to,
      ...(extra?.dlpChecked !== undefined ? { dlpChecked: extra.dlpChecked } : {}),
      ...(extra?.dlpAction !== undefined ? { dlpAction: extra.dlpAction } : {}),
      ...(extra?.providerApproved !== undefined ? { providerApproved: extra.providerApproved } : {}),
      ...(extra?.confidenceBps !== undefined ? { confidenceBps: extra.confidenceBps } : {}),
      by: actor,
    });
    if (updated === null) throw ProblemError.conflict('Request modified concurrently.', ctx.correlationId);
    await this.repo.insertRequestHistory(tx, {
      tenantId: ctx.tenantId,
      requestId: req.id,
      fromStatus: req.status,
      toStatus: to,
      reason: null,
      reasonCode,
      by: actor,
      correlationId: ctx.correlationId,
    });
    return updated;
  }
  private async moveRequestChecked(
    ctx: RequestContext,
    tx: Tx,
    req: RequestRow,
    to: string,
    reasonCode: string,
    expectedVersion: number,
    actor: string | null,
    reason: string,
  ): Promise<RequestRow> {
    const t = checkRequestTransition(req.status, to);
    if (!t.ok) throw badRequest(`cannot move a ${req.status} request to ${to}.`, ctx.correlationId);
    const updated = await this.repo.updateRequest(tx, { id: req.id, expectedVersion, status: to, by: actor });
    if (updated === null) throw ProblemError.conflict('Request modified concurrently.', ctx.correlationId);
    await this.repo.insertRequestHistory(tx, {
      tenantId: ctx.tenantId,
      requestId: req.id,
      fromStatus: req.status,
      toStatus: to,
      reason,
      reasonCode,
      by: actor,
      correlationId: ctx.correlationId,
    });
    return updated;
  }
}

// Re-export output transition for the review service (single source of truth).
export { checkOutputTransition };
