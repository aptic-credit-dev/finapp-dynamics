import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CopilotFeedbackService, M28_PERMISSIONS, M28_AUDIT_CODES } from '@finapp/m28-executive-ai';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope } from '../identity/http.ts';
import { feedbackView } from './views.ts';

/**
 * Executive-copilot FEEDBACK under `/api/v1/copilot`. Records append-only human feedback on a response (helpful /
 * not_helpful / inaccurate / incomplete). Authorized (ai.copilot.feedback, default deny), idempotency-keyed, audited.
 * This is the only write a non-privileged caller makes and it touches only the copilot's own feedback ledger.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('copilot')
export class CopilotFeedbackController {
  private readonly service: CopilotFeedbackService;
  private readonly actors: ActorContextFactory;
  constructor(service: CopilotFeedbackService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M28_PERMISSIONS.copilotFeedback,
    auditCode: M28_AUDIT_CODES.feedbackRecorded,
    description: 'Record human feedback on a copilot response (append-only).',
  })
  @Post('responses/:id/feedback')
  async recordFeedback(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record copilot feedback (m28)');
    const idem = h['idempotency-key'];
    return feedbackView(
      await this.service.recordFeedback(s.ctx, s.actor.identityId, id, {
        rating: requireString(b['rating'], 'rating', s.correlationId),
        ...optStr(b['reasonCode'], 'reasonCode'),
        ...optStr(b['commentRef'], 'commentRef'),
        ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
      }),
    );
  }
}
