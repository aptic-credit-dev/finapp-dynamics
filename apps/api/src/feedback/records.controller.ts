import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { RecordsService, M12_AUDIT_CODES, M12_PERMISSIONS } from '@finapp/m12-feedback';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope } from '../identity/http.ts';
import { slaView, handoffView, relationshipView } from './views.ts';

/**
 * SLA, escalation, M13 case handoff, and relationships, under `/api/v1/feedback`. Escalation reuses m08 (event);
 * case handoff to m13 is a pending record + event. Permission enforced in RecordsService.
 */
interface SlaBody {
  policyCode?: unknown;
  reason?: unknown;
}
interface EscalateBody {
  reason?: unknown;
}
interface HandoffBody {
  recommendedCaseType?: unknown;
  summary?: unknown;
}
interface CompleteBody {
  caseRef?: unknown;
}
interface LinkBody {
  fromFeedbackId?: unknown;
  toFeedbackId?: unknown;
  kind?: unknown;
}

@Controller('feedback')
export class FeedbackRecordsController {
  private readonly service: RecordsService;
  private readonly actors: ActorContextFactory;
  constructor(service: RecordsService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M12_PERMISSIONS.slaManage,
    auditCode: M12_AUDIT_CODES.slaStarted,
    description: 'Start SLA tracking for a feedback record.',
  })
  @Post('records/:id/sla/start')
  async startSla(@Param('id') id: string, @Body() b: SlaBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'start sla (m12)');
    return slaView(
      await this.service.startSla(
        s.ctx,
        s.actor.identityId,
        id,
        requireString(b.policyCode, 'policyCode', s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M12_PERMISSIONS.slaManage,
    auditCode: M12_AUDIT_CODES.slaPaused,
    description: 'Pause SLA tracking.',
  })
  @Post('records/:id/sla/pause')
  async pauseSla(@Param('id') id: string, @Body() b: SlaBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'pause sla (m12)');
    return slaView(
      await this.service.pauseSla(
        s.ctx,
        s.actor.identityId,
        id,
        requireString(b.reason, 'reason', s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M12_PERMISSIONS.slaManage,
    auditCode: M12_AUDIT_CODES.slaResumed,
    description: 'Resume SLA tracking.',
  })
  @Post('records/:id/sla/resume')
  async resumeSla(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'resume sla (m12)');
    return slaView(await this.service.resumeSla(s.ctx, s.actor.identityId, id));
  }
  @Endpoint({
    permission: M12_PERMISSIONS.slaManage,
    auditCode: M12_AUDIT_CODES.slaBreached,
    description: 'Evaluate the SLA against the clock (marks breach if due).',
  })
  @Post('records/:id/sla/evaluate')
  async evaluateSla(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'evaluate sla (m12)');
    return this.service.evaluateSla(s.ctx, id);
  }
  @Get('records/:id/sla')
  async getSla(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get sla (m12)');
    const inst = await this.service.getSla(s.ctx, id);
    return { sla: inst === null ? null : slaView(inst) };
  }

  @Endpoint({
    permission: M12_PERMISSIONS.escalationTrigger,
    auditCode: M12_AUDIT_CODES.escalationTriggered,
    description: 'Trigger escalation (reuses m08).',
  })
  @Post('records/:id/escalate')
  async escalate(@Param('id') id: string, @Body() b: EscalateBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'escalate feedback (m12)');
    const ref = await this.service.triggerEscalation(s.ctx, s.actor.identityId, id, {
      reason: requireString(b.reason, 'reason', s.correlationId),
    });
    return { escalationRef: ref };
  }

  @Endpoint({
    permission: M12_PERMISSIONS.caseHandoffRequest,
    auditCode: M12_AUDIT_CODES.caseHandoffRequested,
    description: 'Request a case handoff to M13.',
  })
  @Post('records/:id/case-handoff')
  async handoff(@Param('id') id: string, @Body() b: HandoffBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'request case handoff (m12)');
    const idem = h['idempotency-key'];
    return handoffView(
      await this.service.requestCaseHandoff(s.ctx, s.actor.identityId, id, {
        ...(typeof b.recommendedCaseType === 'string' ? { recommendedCaseType: b.recommendedCaseType } : {}),
        ...(typeof b.summary === 'string' ? { summary: b.summary } : {}),
        ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
      }),
    );
  }
  @Endpoint({
    permission: M12_PERMISSIONS.caseHandoffRequest,
    auditCode: M12_AUDIT_CODES.caseHandoffCompleted,
    description: 'Complete a case handoff (M13 created the case).',
  })
  @Post('case-handoffs/:id/complete')
  async completeHandoff(
    @Param('id') id: string,
    @Body() b: CompleteBody,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'complete case handoff (m12)');
    return handoffView(
      await this.service.completeCaseHandoff(
        s.ctx,
        s.actor.identityId,
        id,
        requireString(b.caseRef, 'caseRef', s.correlationId),
      ),
    );
  }
  @Get('case-handoffs/:id')
  async getHandoff(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get case handoff (m12)');
    return handoffView(await this.service.getHandoff(s.ctx, id));
  }

  @Endpoint({
    permission: M12_PERMISSIONS.recordUpdate,
    auditCode: M12_AUDIT_CODES.relatedLinked,
    description: 'Link duplicate/related feedback.',
  })
  @Post('relationships')
  async link(@Body() b: LinkBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'link feedback (m12)');
    return relationshipView(
      await this.service.link(s.ctx, s.actor.identityId, {
        fromFeedbackId: requireString(b.fromFeedbackId, 'fromFeedbackId', s.correlationId),
        toFeedbackId: requireString(b.toFeedbackId, 'toFeedbackId', s.correlationId),
        kind: requireString(b.kind, 'kind', s.correlationId),
      }),
    );
  }
  @Get('records/:id/relationships')
  async listRelationships(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list relationships (m12)');
    return { relationships: (await this.service.listRelationships(s.ctx, id)).map(relationshipView) };
  }
}
