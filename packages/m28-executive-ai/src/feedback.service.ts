/**
 * CopilotFeedbackService — records APPEND-ONLY human feedback on a response (helpful / not_helpful / inaccurate /
 * incomplete). Authorized (ai.copilot.feedback, default deny), idempotency-keyed (a duplicate submission is suppressed)
 * and audited. Free-text comments live behind an opaque m09 reference — never inline. This is the ONLY write a
 * non-privileged caller makes, and it touches only the copilot's OWN feedback ledger — never a business record.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M28_PERMISSIONS } from './permissions.ts';
import { M28_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { isFeedbackRating } from './domain.ts';
import { ExecutiveAiRepository, type FeedbackRow } from './repository.ts';
import type { M28Emitter } from './emit.ts';

export class CopilotFeedbackService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M28Emitter;
  private readonly repo: ExecutiveAiRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M28Emitter,
    repo: ExecutiveAiRepository = new ExecutiveAiRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async recordFeedback(
    ctx: RequestContext,
    actor: string | null,
    responseId: string,
    input: {
      rating: string;
      reasonCode?: string | null;
      commentRef?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<FeedbackRow> {
    await this.authz.require(ctx, M28_PERMISSIONS.copilotFeedback);
    if (actor === null || actor.trim() === '')
      throw badRequest('a human is required to record feedback.', ctx.correlationId);
    if (!isFeedbackRating(input.rating)) throw badRequest('unknown feedback rating.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findFeedbackByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const response = await this.repo.findResponse(tx, responseId);
      if (response === null) throw ProblemError.notFound('Response not found.', ctx.correlationId);
      const feedback = await this.repo.insertFeedback(tx, {
        tenantId: ctx.tenantId,
        responseId,
        rating: input.rating,
        reasonCode: input.reasonCode ?? null,
        commentRef: input.commentRef ?? null,
        byUser: actor,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M28_AUDIT_CODES.feedbackRecorded,
        entityType: 'copilot_feedback',
        entityId: feedback.id,
        detail: { rating: input.rating },
      });
      return feedback;
    });
  }
}
