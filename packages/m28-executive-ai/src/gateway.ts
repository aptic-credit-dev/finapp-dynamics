/**
 * The AI-gateway PORT through which M28 consumes the M24 governed AI pipeline BY CONTRACT — it defines the small surface
 * the Executive Copilot needs (generate a governed, cited answer/summary) and NOTHING about providers, routing, DLP,
 * prompts or vectors. The default adapter, `M24CopilotGateway`, wraps M24's `RequestService` — so provider selection,
 * DLP (restricted data stays blocked), approved-provider routing, confidence, citations and usage/cost all live in M24
 * (never duplicated, never bypassed). M28 holds only OPAQUE m24 request/output ids and never touches M24's private
 * tables or provider credentials. The copilot NEVER auto-approves the M24 output (that is a human decision through M24);
 * the executive who reads the answer is its reviewer. There is NO provider adapter, NO network, NO HTTP client and NO
 * SDK here — only a deterministic, offline double runs.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { RequestService, AiRepository } from '@finapp/m24-ai-foundation';
import type { M24Emitter } from '@finapp/m24-ai-foundation';

export interface AiAnswerInput {
  readonly subjectRef: string | null;
  readonly classification: string;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly promptId: string | null;
  readonly inputSample: string;
  /** copilot answers are 'answer' or 'summary' outputs — assistive only, never a controlled action. */
  readonly outputKind: string;
  /** the copilot always requires citations. */
  readonly citationsRequired: boolean;
}
export interface AiAnswerResult {
  readonly requestRef: string;
  readonly outputRef: string | null;
  readonly confidenceBps: number;
  readonly generated: boolean;
  readonly reasonCode: string;
}

export interface CopilotAiGatewayPort {
  answer(ctx: RequestContext, actor: string | null, input: AiAnswerInput): Promise<AiAnswerResult>;
}

/** The default gateway: M24's own governed request service. M28 adds no AI capability of its own. */
export class M24CopilotGateway implements CopilotAiGatewayPort {
  private readonly requests: RequestService;
  constructor(db: Db, authz: Authz, emitter: M24Emitter, aiRepo: AiRepository = new AiRepository()) {
    this.requests = new RequestService(db, authz, emitter, aiRepo);
  }

  async answer(ctx: RequestContext, actor: string | null, input: AiAnswerInput): Promise<AiAnswerResult> {
    const submitted = await this.requests.submitRequest(ctx, actor, {
      subjectType: 'copilot_query',
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
      // The M24 output is left in review_pending (a RECOMMENDATION); the executive who reads it is the human reviewer.
      // The copilot NEVER drives it to 'approved' — AI does not approve (CLAUDE.md).
      return {
        requestRef: submitted.id,
        outputRef: output.id,
        confidenceBps: output.confidence_bps,
        generated: true,
        reasonCode: 'answer_generated',
      };
    } catch {
      // A DLP block / routing refusal is durably recorded inside M24; the copilot answer simply fails closed here.
      return {
        requestRef: submitted.id,
        outputRef: null,
        confidenceBps: 0,
        generated: false,
        reasonCode: 'ai_output_not_generated',
      };
    }
  }
}
