import type { RequestContext } from '@finapp/kernel';
import type { FeedbackHandoff, FeedbackHandoffSource } from '@finapp/m13-case';
import type { RecordsService as FeedbackRecordsService } from '@finapp/m12-feedback';

/**
 * The M12 → M13 feedback-handoff adapter — binds m13's `FeedbackHandoffSource` port to m12's public
 * `RecordsService` (getHandoff / completeCaseHandoff). m13 never reads m12's tables; it goes through m12's own
 * service under the caller's authority. Only SAFE reference fields cross the boundary (feedback id, recommended
 * case type, severity) — never customer contact details. Completing the handoff transitions the feedback to
 * `converted_to_case` on the m12 side (idempotent).
 */
export class M12FeedbackHandoffAdapter implements FeedbackHandoffSource {
  private readonly records: FeedbackRecordsService;
  constructor(records: FeedbackRecordsService) {
    this.records = records;
  }
  async getHandoff(ctx: RequestContext, handoffId: string): Promise<FeedbackHandoff | null> {
    const r = await this.records.getHandoff(ctx, handoffId);
    return {
      handoffId: r.id,
      feedbackId: r.feedback_id,
      status: r.status,
      recommendedCaseType: r.recommended_case_type,
      severity: r.severity,
      category: null,
      product: null,
      customerRef: null,
      sourceTransactionId: null,
    };
  }
  async completeHandoff(
    ctx: RequestContext,
    actor: string | null,
    handoffId: string,
    caseRef: string,
  ): Promise<void> {
    await this.records.completeCaseHandoff(ctx, actor, handoffId, caseRef);
  }
}
