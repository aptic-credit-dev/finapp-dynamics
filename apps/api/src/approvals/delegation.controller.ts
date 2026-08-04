import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { DelegationService, EscalationService, M22_AUDIT_CODES, M22_PERMISSIONS } from '@finapp/m22-approval';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { delegationView, escalationView } from './views.ts';

/**
 * Approval delegations + deterministic escalation — under `/api/v1/approvals`. Delegations grant checker authority
 * (delegate != delegator); a delegated approver still cannot launder SoD (enforced where decisions land). Escalation
 * reuses m06 SLA timers + m08 notifications by opaque reference, is single-fire per level and depth-bounded — no
 * second timer/notification engine is built here.
 */
@Controller('approvals')
export class ApprovalDelegationController {
  private readonly delegations: DelegationService;
  private readonly escalations: EscalationService;
  private readonly actors: ActorContextFactory;
  constructor(delegations: DelegationService, escalations: EscalationService, actors: ActorContextFactory) {
    this.delegations = delegations;
    this.escalations = escalations;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M22_PERMISSIONS.delegationManage,
    auditCode: M22_AUDIT_CODES.delegationGranted,
    description: 'Grant a checker-authority delegation.',
  })
  @Post('delegations')
  async grant(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'grant approval delegation (m22)');
    return delegationView(
      await this.delegations.grantDelegation(s.ctx, s.actor.identityId, {
        delegator: requireString(b['delegator'], 'delegator', s.correlationId),
        delegate: requireString(b['delegate'], 'delegate', s.correlationId),
        subjectType: requireString(b['subjectType'], 'subjectType', s.correlationId),
        ...(typeof b['scope'] === 'string' ? { scope: b['scope'] } : {}),
        ...(typeof b['reason'] === 'string' ? { reason: b['reason'] } : {}),
        ...(typeof b['endsAt'] === 'string' ? { endsAt: b['endsAt'] } : {}),
      }),
    );
  }

  @Endpoint({
    permission: M22_PERMISSIONS.delegationManage,
    auditCode: M22_AUDIT_CODES.delegationRevoked,
    description: 'Revoke a delegation.',
  })
  @Post('delegations/:id/revoke')
  async revoke(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'revoke approval delegation (m22)');
    return delegationView(
      await this.delegations.revokeDelegation(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        requireString(b['reason'], 'reason', s.correlationId),
      ),
    );
  }

  @Get('delegations')
  async list(@Query('delegate') delegate: string | undefined, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list approval delegations (m22)');
    const rows = await this.delegations.listDelegations(
      s.ctx,
      typeof delegate === 'string' && delegate !== '' ? delegate : undefined,
    );
    return { delegations: rows.map(delegationView) };
  }

  @Endpoint({
    permission: M22_PERMISSIONS.escalationManage,
    auditCode: M22_AUDIT_CODES.escalationFired,
    description: 'Fire a deterministic escalation for a request past its SLA deadline.',
  })
  @Post('requests/:id/escalations')
  async escalate(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'fire approval escalation (m22)');
    return escalationView(
      await this.escalations.fireEscalation(s.ctx, s.actor.identityId, id, {
        toLevel: typeof b['toLevel'] === 'number' ? b['toLevel'] : 2,
        ...(typeof b['targetRef'] === 'string' ? { targetRef: b['targetRef'] } : {}),
        ...(typeof b['mode'] === 'string' ? { mode: b['mode'] } : {}),
        ...(typeof b['timerRef'] === 'string' ? { timerRef: b['timerRef'] } : {}),
        ...(typeof b['notificationRef'] === 'string' ? { notificationRef: b['notificationRef'] } : {}),
      }),
    );
  }
  @Get('requests/:id/escalations')
  async listEscalations(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list approval escalations (m22)');
    return { escalations: (await this.escalations.listEscalations(s.ctx, id)).map(escalationView) };
  }
}
