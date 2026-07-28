import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CatalogService, M17_AUDIT_CODES, M17_PERMISSIONS } from '@finapp/m17-recovery';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { specView } from './views.ts';

/**
 * Recovery catalog — versioned recovery types + SLA policies, under `/api/v1/recovery`. Both are
 * immutable-after-publish (one ACTIVE per code+scope). Permission enforced in CatalogService (default deny).
 */
interface SpecBody {
  code?: unknown;
  name?: unknown;
  scope?: unknown;
  spec?: unknown;
}
interface ActionBody {
  expectedVersion?: unknown;
}

@Controller('recovery')
export class RecoveryCatalogController {
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
    permission: M17_PERMISSIONS.recoveryTypeManage,
    auditCode: M17_AUDIT_CODES.recoveryTypeCreated,
    description: 'Create a draft recovery type.',
  })
  @Post('recovery-types')
  async createType(@Body() b: SpecBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create recovery type (m17)');
    return specView(
      await this.service.createRecoveryType(s.ctx, s.actor.identityId, {
        code: requireString(b.code, 'code', s.correlationId),
        name: requireString(b.name, 'name', s.correlationId),
        ...(typeof b.scope === 'string' ? { scope: b.scope } : {}),
        spec: b.spec,
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.recoveryTypeManage,
    auditCode: M17_AUDIT_CODES.recoveryTypeCreated,
    description: 'Validate a recovery type.',
  })
  @Post('recovery-types/:id/validate')
  async validateType(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'validate recovery type (m17)');
    return specView(
      await this.service.validateRecoveryType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.recoveryTypeManage,
    auditCode: M17_AUDIT_CODES.recoveryTypePublished,
    description: 'Publish a recovery type.',
  })
  @Post('recovery-types/:id/publish')
  async publishType(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'publish recovery type (m17)');
    return specView(
      await this.service.publishRecoveryType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.recoveryTypeManage,
    auditCode: M17_AUDIT_CODES.recoveryTypePublished,
    description: 'Activate a recovery type.',
  })
  @Post('recovery-types/:id/activate')
  async activateType(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'activate recovery type (m17)');
    return specView(
      await this.service.activateRecoveryType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('recovery-types/:id')
  async getType(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get recovery type (m17)');
    return specView(await this.service.getRecoveryType(s.ctx, id));
  }

  @Endpoint({
    permission: M17_PERMISSIONS.slaPolicyManage,
    auditCode: M17_AUDIT_CODES.recoveryTypeCreated,
    description: 'Create a draft SLA policy.',
  })
  @Post('sla-policies')
  async createSla(@Body() b: SpecBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create sla policy (m17)');
    return specView(
      await this.service.createSlaPolicy(s.ctx, s.actor.identityId, {
        code: requireString(b.code, 'code', s.correlationId),
        name: requireString(b.name, 'name', s.correlationId),
        ...(typeof b.scope === 'string' ? { scope: b.scope } : {}),
        spec: b.spec,
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.slaPolicyManage,
    auditCode: M17_AUDIT_CODES.recoveryTypeCreated,
    description: 'Validate an SLA policy.',
  })
  @Post('sla-policies/:id/validate')
  async validateSla(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'validate sla policy (m17)');
    return specView(
      await this.service.validateSlaPolicy(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.slaPolicyManage,
    auditCode: M17_AUDIT_CODES.slaPolicyPublished,
    description: 'Publish an SLA policy.',
  })
  @Post('sla-policies/:id/publish')
  async publishSla(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'publish sla policy (m17)');
    return specView(
      await this.service.publishSlaPolicy(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.slaPolicyManage,
    auditCode: M17_AUDIT_CODES.slaPolicyPublished,
    description: 'Activate an SLA policy.',
  })
  @Post('sla-policies/:id/activate')
  async activateSla(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'activate sla policy (m17)');
    return specView(
      await this.service.activateSlaPolicy(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('sla-policies/:id')
  async getSla(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get sla policy (m17)');
    return specView(await this.service.getSlaPolicy(s.ctx, id));
  }
}
