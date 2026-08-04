import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { DecisionService, M22_AUDIT_CODES, M22_PERMISSIONS } from '@finapp/m22-approval';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { requestView, decisionView } from './views.ts';

/**
 * Approval decisions — the maker-checker + Segregation-of-Duties choke point — under `/api/v1/approvals`. A human actor
 * decides; m22 records + ENFORCES: an approving actor is never the maker, the preparer is never the required checker, a
 * delegate cannot launder SoD, and the same actor cannot supply a required second approval. A blocked SoD attempt is a
 * 403 with a machine-readable reason code, never silent. Override is privileged and STILL honours SoD. m22 never
 * approves on behalf of a human. The deciding actor is the authenticated session identity — never a request field.
 */
@Controller('approvals')
export class ApprovalDecisionController {
  private readonly service: DecisionService;
  private readonly actors: ActorContextFactory;
  constructor(service: DecisionService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M22_PERMISSIONS.decisionApprove,
    auditCode: M22_AUDIT_CODES.decisionRecorded,
    description: 'Record a decision (approve/reject/return/abstain/escalate) on an approval request.',
  })
  @Post('requests/:id/decisions')
  async decide(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record approval decision (m22)');
    const actor = requireString(s.actor.identityId, 'actor', s.correlationId);
    const out = await this.service.recordDecision(
      s.ctx,
      actor,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
      {
        decision: requireString(b['decision'], 'decision', s.correlationId),
        ...(typeof b['reason'] === 'string' ? { reason: b['reason'] } : {}),
        ...(typeof b['reasonCode'] === 'string' ? { reasonCode: b['reasonCode'] } : {}),
        ...(typeof b['onBehalfOf'] === 'string' ? { onBehalfOf: b['onBehalfOf'] } : {}),
      },
    );
    return { request: requestView(out.request), decision: decisionView(out.decision), sod: out.sod };
  }

  @Endpoint({
    permission: M22_PERMISSIONS.decisionOverride,
    auditCode: M22_AUDIT_CODES.overrideApplied,
    description: 'Apply a privileged override (SoD still applies).',
  })
  @Post('requests/:id/override')
  async override(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'override approval decision (m22)');
    const actor = requireString(s.actor.identityId, 'actor', s.correlationId);
    const out = await this.service.overrideDecision(
      s.ctx,
      actor,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
      {
        overrideType: requireString(b['overrideType'], 'overrideType', s.correlationId),
        justification: requireString(b['justification'], 'justification', s.correlationId),
        ...(typeof b['reasonCode'] === 'string' ? { reasonCode: b['reasonCode'] } : {}),
      },
    );
    return { request: requestView(out.request), decision: decisionView(out.decision) };
  }

  @Get('requests/:id/decisions')
  async list(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list approval decisions (m22)');
    return { decisions: (await this.service.listDecisions(s.ctx, id)).map(decisionView) };
  }
}
