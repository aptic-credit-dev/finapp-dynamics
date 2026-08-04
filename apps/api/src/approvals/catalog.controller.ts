import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CatalogService, M22_AUDIT_CODES, M22_PERMISSIONS } from '@finapp/m22-approval';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { policyView, policyStepView, configView, reasonCodeView } from './views.ts';

/**
 * Approval policies, engine config and reason codes — under `/api/v1/approvals`. Policies and config are versioned and
 * immutable-after-publish; publishing is privileged. This is the rulebook the request/decision services enforce — it
 * never approves anything.
 */
@Controller('approvals')
export class ApprovalCatalogController {
  private readonly service: CatalogService;
  private readonly actors: ActorContextFactory;
  constructor(service: CatalogService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M22_PERMISSIONS.policyManage,
    auditCode: M22_AUDIT_CODES.policyCreated,
    description: 'Create a draft approval policy (+ its steps).',
  })
  @Post('policies')
  async createPolicy(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create approval policy (m22)');
    const steps = Array.isArray(b['steps']) ? (b['steps'] as Record<string, unknown>[]) : [];
    const out = await this.service.createPolicy(s.ctx, s.actor.identityId, {
      subjectType: requireString(b['subjectType'], 'subjectType', s.correlationId),
      ...(typeof b['scope'] === 'string' ? { scope: b['scope'] } : {}),
      ...(typeof b['name'] === 'string' ? { name: b['name'] } : {}),
      ...(typeof b['requiredApprovals'] === 'number' ? { requiredApprovals: b['requiredApprovals'] } : {}),
      ...(typeof b['sodMode'] === 'string' ? { sodMode: b['sodMode'] } : {}),
      steps: steps.map((st) => ({
        level: typeof st['level'] === 'number' ? st['level'] : 1,
        ...(typeof st['requiredPermission'] === 'string'
          ? { requiredPermission: st['requiredPermission'] }
          : {}),
        ...(typeof st['sodConstraint'] === 'string' ? { sodConstraint: st['sodConstraint'] } : {}),
        ...(typeof st['escalationAfterSeconds'] === 'number'
          ? { escalationAfterSeconds: st['escalationAfterSeconds'] }
          : {}),
        ...(typeof st['escalationMode'] === 'string' ? { escalationMode: st['escalationMode'] } : {}),
      })),
    });
    return { policy: policyView(out.policy), steps: out.steps.map(policyStepView) };
  }

  @Endpoint({
    permission: M22_PERMISSIONS.policyPublish,
    auditCode: M22_AUDIT_CODES.policyPublished,
    description: 'Publish a draft approval policy to active.',
  })
  @Post('policies/:id/publish')
  async publishPolicy(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish approval policy (m22)');
    return policyView(
      await this.service.publishPolicy(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
      ),
    );
  }

  @Get('policies')
  async listPolicies(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list approval policies (m22)');
    return { policies: (await this.service.listPolicies(s.ctx)).map(policyView) };
  }
  @Get('policies/:id')
  async getPolicy(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get approval policy (m22)');
    const out = await this.service.getPolicy(s.ctx, id);
    return { policy: policyView(out.policy), steps: out.steps.map(policyStepView) };
  }

  @Endpoint({
    permission: M22_PERMISSIONS.configManage,
    auditCode: M22_AUDIT_CODES.configCreated,
    description: 'Create a draft approval-engine config.',
  })
  @Post('config')
  async createConfig(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create approval config (m22)');
    const idem = h['idempotency-key'];
    return configView(
      await this.service.createConfig(s.ctx, s.actor.identityId, {
        ...(typeof b['scope'] === 'string' ? { scope: b['scope'] } : {}),
        ...(typeof b['name'] === 'string' ? { name: b['name'] } : {}),
        ...(typeof b['maxEscalationDepth'] === 'number'
          ? { maxEscalationDepth: b['maxEscalationDepth'] }
          : {}),
        ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
      }),
    );
  }
  @Endpoint({
    permission: M22_PERMISSIONS.configPublish,
    auditCode: M22_AUDIT_CODES.configPublished,
    description: 'Publish a draft approval-engine config to active.',
  })
  @Post('config/:id/publish')
  async publishConfig(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish approval config (m22)');
    return configView(
      await this.service.publishConfig(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
      ),
    );
  }
  @Get('config')
  async listConfigs(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list approval config (m22)');
    return { configs: (await this.service.listConfigs(s.ctx)).map(configView) };
  }

  @Endpoint({
    permission: M22_PERMISSIONS.reasonCodeManage,
    auditCode: M22_AUDIT_CODES.reasonCodeRegistered,
    description: 'Register an approval reason code.',
  })
  @Post('reason-codes')
  async registerReasonCode(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register approval reason code (m22)');
    return reasonCodeView(
      await this.service.registerReasonCode(s.ctx, s.actor.identityId, {
        code: requireString(b['code'], 'code', s.correlationId),
        ...(typeof b['category'] === 'string' ? { category: b['category'] } : {}),
        ...(typeof b['severity'] === 'string' ? { severity: b['severity'] } : {}),
        ...(typeof b['description'] === 'string' ? { description: b['description'] } : {}),
      }),
    );
  }
  @Get('reason-codes')
  async listReasonCodes(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list approval reason codes (m22)');
    return { reasonCodes: (await this.service.listReasonCodes(s.ctx)).map(reasonCodeView) };
  }
}
