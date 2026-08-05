/**
 * The AI-gateway PORT through which M25 consumes the M24 governed AI pipeline BY CONTRACT — it defines the small
 * surface Operational AI needs (generate a governed analysis output; drive its human review) and NOTHING about providers,
 * routing, DLP, prompts or vectors. The default adapter, `M24AiGateway`, wraps M24's `RequestService` + `ReviewService`
 * — so provider routing, DLP, approved-provider gating, confidence, citations, usage/cost and the human-review CHECK all
 * live in M24 (never duplicated here). M25 holds only OPAQUE m24 request/output ids. There is NO provider adapter, NO
 * network, NO HTTP client and NO SDK in this module.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { RequestService, ReviewService, AiRepository } from '@finapp/m24-ai-foundation';
import type { M24Emitter } from '@finapp/m24-ai-foundation';

export interface AiAnalysisInput {
  readonly subjectType: string;
  readonly subjectRef: string;
  readonly classification: string;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly promptId: string | null;
  readonly inputSample: string;
  readonly outputKind: string;
  readonly citationsRequired: boolean;
}
export interface AiAnalysisResult {
  readonly requestRef: string;
  readonly outputRef: string | null;
  readonly confidenceBps: number;
  readonly generated: boolean;
  readonly reasonCode: string;
}
export interface AiDecisionResult {
  readonly done: boolean;
  readonly reasonCode: string;
}

export interface AiGatewayPort {
  /** Generate a GOVERNED analysis output through M24 (submit -> process). Never throws on a governance refusal — it
   *  returns `generated:false` (the M24 request is durably rejected inside M24). */
  analyze(ctx: RequestContext, actor: string | null, input: AiAnalysisInput): Promise<AiAnalysisResult>;
  /** Drive the M24 HUMAN review of the output (approve/reject). Returns whether the decision was applied. */
  decideOutput(
    ctx: RequestContext,
    actor: string | null,
    outputRef: string,
    decision: 'approved' | 'rejected',
  ): Promise<AiDecisionResult>;
}

/**
 * The default gateway: M24's own governed services. Construct M24's RequestService/ReviewService (with the M24 emitter,
 * repository and deterministic provider doubles) and pass them here — M25 adds no AI capability of its own.
 */
export class M24AiGateway implements AiGatewayPort {
  private readonly db: Db;
  private readonly requests: RequestService;
  private readonly reviews: ReviewService;
  private readonly aiRepo: AiRepository;
  constructor(db: Db, authz: Authz, emitter: M24Emitter, aiRepo: AiRepository = new AiRepository()) {
    this.db = db;
    this.aiRepo = aiRepo;
    this.requests = new RequestService(db, authz, emitter, aiRepo);
    this.reviews = new ReviewService(db, authz, emitter, aiRepo);
  }

  async analyze(
    ctx: RequestContext,
    actor: string | null,
    input: AiAnalysisInput,
  ): Promise<AiAnalysisResult> {
    const submitted = await this.requests.submitRequest(ctx, actor, {
      subjectType: input.subjectType,
      subjectRef: input.subjectRef,
      classification: input.classification,
      providerId: input.providerId,
      modelId: input.modelId,
      promptId: input.promptId,
    });
    try {
      const { output } = await this.requests.processRequest(ctx, actor, submitted.id, submitted.version, {
        inputSample: input.inputSample,
        outputKind: input.outputKind,
        citationsRequired: input.citationsRequired,
      });
      return {
        requestRef: submitted.id,
        outputRef: output.id,
        confidenceBps: output.confidence_bps,
        generated: true,
        reasonCode: 'output_generated',
      };
    } catch {
      // A governance refusal (DLP block / unapproved-provider routing). M24 has durably rejected the request.
      return {
        requestRef: submitted.id,
        outputRef: null,
        confidenceBps: 0,
        generated: false,
        reasonCode: 'analysis_failed',
      };
    }
  }

  async decideOutput(
    ctx: RequestContext,
    actor: string | null,
    outputRef: string,
    decision: 'approved' | 'rejected',
  ): Promise<AiDecisionResult> {
    const output = await this.db.withTenant(ctx, (tx) => this.aiRepo.findOutput(tx, outputRef));
    if (output === null) return { done: false, reasonCode: 'ai_output_not_found' };
    if (output.status !== 'review_pending') return { done: false, reasonCode: 'ai_output_not_pending' };
    const reviewed = await this.reviews.reviewOutput(ctx, actor, outputRef, output.version, { decision });
    return {
      done: reviewed.status === decision,
      reasonCode: decision === 'approved' ? 'human_approved' : 'human_rejected',
    };
  }
}
