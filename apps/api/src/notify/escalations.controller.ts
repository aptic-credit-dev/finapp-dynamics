import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { EscalationService, M08_AUDIT_CODES, M08_PERMISSIONS } from '@finapp/m08-notify';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { policyView, instanceView } from './views.ts';

/**
 * Escalation policies and instances, under `/api/v1/notifications`. Policies are authored + walked through the
 * same DRAFT → validate → publish → activate → retire lifecycle; instances are opened, acknowledged, resolved,
 * or cancelled. Advancement is a worker path (lease-based) and is NOT exposed over HTTP.
 */

interface PolicyCreateBody {
  key?: unknown;
  name?: unknown;
  scope?: unknown;
  spec?: unknown;
}
interface OpenBody {
  policyKey?: unknown;
  originModule?: unknown;
  originEntityType?: unknown;
  originEntityId?: unknown;
}
interface ActionBody {
  expectedVersion?: unknown;
  reason?: unknown;
  resolution?: unknown;
}

@Controller('notifications')
export class EscalationsController {
  private readonly service: EscalationService;
  private readonly actors: ActorContextFactory;
  constructor(service: EscalationService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Endpoint({
    permission: M08_PERMISSIONS.escalationManage,
    auditCode: M08_AUDIT_CODES.escalationPolicyCreated,
    description: 'Create a draft escalation policy.',
  })
  @Post('escalation-policies')
  async createPolicy(@Body() body: PolicyCreateBody, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'create escalation policy (m08)'),
    );
    const cid = scoped.correlationId;
    const row = await this.service.createPolicy(scoped.ctx, scoped.actor.identityId, {
      key: requireString(body.key, 'key', cid),
      name: requireString(body.name, 'name', cid),
      ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
      spec: body.spec,
    });
    return policyView(row);
  }

  @Endpoint({
    permission: M08_PERMISSIONS.escalationManage,
    auditCode: M08_AUDIT_CODES.escalationPolicyUpdated,
    description: 'Validate an escalation policy.',
  })
  @Post('escalation-policies/:id/validate')
  async validatePolicy(
    @Param('id') id: string,
    @Body() body: ActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'validate escalation policy (m08)'),
    );
    return policyView(
      await this.service.validatePolicy(
        scoped.ctx,
        scoped.actor.identityId,
        id,
        requireVersion(body.expectedVersion, scoped.correlationId),
      ),
    );
  }

  @Endpoint({
    permission: M08_PERMISSIONS.escalationManage,
    auditCode: M08_AUDIT_CODES.escalationPolicyUpdated,
    description: 'Publish an escalation policy.',
  })
  @Post('escalation-policies/:id/publish')
  async publishPolicy(
    @Param('id') id: string,
    @Body() body: ActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'publish escalation policy (m08)'),
    );
    return policyView(
      await this.service.publishPolicy(
        scoped.ctx,
        scoped.actor.identityId,
        id,
        requireVersion(body.expectedVersion, scoped.correlationId),
      ),
    );
  }

  @Endpoint({
    permission: M08_PERMISSIONS.escalationManage,
    auditCode: M08_AUDIT_CODES.escalationPolicyUpdated,
    description: 'Activate an escalation policy.',
  })
  @Post('escalation-policies/:id/activate')
  async activatePolicy(
    @Param('id') id: string,
    @Body() body: ActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'activate escalation policy (m08)'),
    );
    return policyView(
      await this.service.activatePolicy(
        scoped.ctx,
        scoped.actor.identityId,
        id,
        requireVersion(body.expectedVersion, scoped.correlationId),
      ),
    );
  }

  @Endpoint({
    permission: M08_PERMISSIONS.escalationManage,
    auditCode: M08_AUDIT_CODES.escalationPolicyUpdated,
    description: 'Retire an escalation policy.',
  })
  @Post('escalation-policies/:id/retire')
  async retirePolicy(
    @Param('id') id: string,
    @Body() body: ActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'retire escalation policy (m08)'),
    );
    return policyView(
      await this.service.retirePolicy(
        scoped.ctx,
        scoped.actor.identityId,
        id,
        requireVersion(body.expectedVersion, scoped.correlationId),
      ),
    );
  }

  @Endpoint({
    permission: M08_PERMISSIONS.escalationManage,
    auditCode: M08_AUDIT_CODES.escalationActivated,
    description: 'Open an escalation against the active policy for a key.',
  })
  @Post('escalations')
  async open(@Body() body: OpenBody, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'open escalation (m08)'));
    const cid = scoped.correlationId;
    const idem = headers['idempotency-key'];
    const row = await this.service.open(scoped.ctx, scoped.actor.identityId, {
      policyKey: requireString(body.policyKey, 'policyKey', cid),
      ...(typeof body.originModule === 'string' ? { originModule: body.originModule } : {}),
      ...(typeof body.originEntityType === 'string' ? { originEntityType: body.originEntityType } : {}),
      ...(typeof body.originEntityId === 'string' ? { originEntityId: body.originEntityId } : {}),
      ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
    });
    return instanceView(row);
  }

  @Endpoint({
    permission: M08_PERMISSIONS.escalationAcknowledge,
    auditCode: M08_AUDIT_CODES.escalationAcknowledged,
    description: 'Acknowledge an escalation.',
  })
  @Post('escalations/:id/acknowledge')
  async acknowledge(
    @Param('id') id: string,
    @Body() body: ActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'acknowledge escalation (m08)'));
    return instanceView(
      await this.service.acknowledge(
        scoped.ctx,
        scoped.actor.identityId,
        id,
        requireVersion(body.expectedVersion, scoped.correlationId),
      ),
    );
  }

  @Endpoint({
    permission: M08_PERMISSIONS.escalationResolve,
    auditCode: M08_AUDIT_CODES.escalationResolved,
    description: 'Resolve an escalation.',
  })
  @Post('escalations/:id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() body: ActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'resolve escalation (m08)'));
    return instanceView(
      await this.service.resolve(
        scoped.ctx,
        scoped.actor.identityId,
        id,
        requireVersion(body.expectedVersion, scoped.correlationId),
        typeof body.resolution === 'string' ? body.resolution : null,
      ),
    );
  }

  @Endpoint({
    permission: M08_PERMISSIONS.escalationManage,
    auditCode: M08_AUDIT_CODES.escalationCancelled,
    description: 'Cancel an escalation.',
  })
  @Post('escalations/:id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() body: ActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'cancel escalation (m08)'));
    return instanceView(
      await this.service.cancel(
        scoped.ctx,
        scoped.actor.identityId,
        id,
        requireVersion(body.expectedVersion, scoped.correlationId),
        typeof body.reason === 'string' ? body.reason : null,
      ),
    );
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('escalation-policies')
  async listPolicies(@Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'list escalation policies (m08)'),
    );
    const rows = await this.service.listPolicies(scoped.ctx);
    return { policies: rows.map(policyView) };
  }

  @Get('escalation-policies/:id')
  async getPolicy(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'get escalation policy (m08)'));
    return policyView(await this.service.getPolicy(scoped.ctx, id));
  }

  @Get('escalations')
  async listInstances(@Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'list escalations (m08)'));
    const rows = await this.service.listInstances(scoped.ctx);
    return { escalations: rows.map(instanceView) };
  }

  @Get('escalations/:id')
  async getInstance(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'get escalation (m08)'));
    return instanceView(await this.service.getInstance(scoped.ctx, id));
  }
}
