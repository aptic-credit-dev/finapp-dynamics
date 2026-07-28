import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CatalogService, M16_AUDIT_CODES, M16_PERMISSIONS } from '@finapp/m16-litigation';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { specView } from './views.ts';

/**
 * Litigation catalog — versioned proceeding types + SLA policies, under `/api/v1/litigation`. Both are
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

@Controller('litigation')
export class LitigationCatalogController {
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
    permission: M16_PERMISSIONS.proceedingTypeManage,
    auditCode: M16_AUDIT_CODES.proceedingTypeCreated,
    description: 'Create a draft proceeding type.',
  })
  @Post('proceeding-types')
  async createType(@Body() b: SpecBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create proceeding type (m16)');
    return specView(
      await this.service.createProceedingType(s.ctx, s.actor.identityId, {
        code: requireString(b.code, 'code', s.correlationId),
        name: requireString(b.name, 'name', s.correlationId),
        ...(typeof b.scope === 'string' ? { scope: b.scope } : {}),
        spec: b.spec,
      }),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.proceedingTypeManage,
    auditCode: M16_AUDIT_CODES.proceedingTypeCreated,
    description: 'Validate a proceeding type.',
  })
  @Post('proceeding-types/:id/validate')
  async validateType(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'validate proceeding type (m16)');
    return specView(
      await this.service.validateProceedingType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.proceedingTypeManage,
    auditCode: M16_AUDIT_CODES.proceedingTypePublished,
    description: 'Publish a proceeding type.',
  })
  @Post('proceeding-types/:id/publish')
  async publishType(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'publish proceeding type (m16)');
    return specView(
      await this.service.publishProceedingType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.proceedingTypeManage,
    auditCode: M16_AUDIT_CODES.proceedingTypePublished,
    description: 'Activate a proceeding type.',
  })
  @Post('proceeding-types/:id/activate')
  async activateType(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'activate proceeding type (m16)');
    return specView(
      await this.service.activateProceedingType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('proceeding-types/:id')
  async getType(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get proceeding type (m16)');
    return specView(await this.service.getProceedingType(s.ctx, id));
  }

  @Endpoint({
    permission: M16_PERMISSIONS.slaPolicyManage,
    auditCode: M16_AUDIT_CODES.proceedingTypeCreated,
    description: 'Create a draft SLA policy.',
  })
  @Post('sla-policies')
  async createSla(@Body() b: SpecBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create sla policy (m16)');
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
    permission: M16_PERMISSIONS.slaPolicyManage,
    auditCode: M16_AUDIT_CODES.proceedingTypeCreated,
    description: 'Validate an SLA policy.',
  })
  @Post('sla-policies/:id/validate')
  async validateSla(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'validate sla policy (m16)');
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
    permission: M16_PERMISSIONS.slaPolicyManage,
    auditCode: M16_AUDIT_CODES.slaPolicyPublished,
    description: 'Publish an SLA policy.',
  })
  @Post('sla-policies/:id/publish')
  async publishSla(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'publish sla policy (m16)');
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
    permission: M16_PERMISSIONS.slaPolicyManage,
    auditCode: M16_AUDIT_CODES.slaPolicyPublished,
    description: 'Activate an SLA policy.',
  })
  @Post('sla-policies/:id/activate')
  async activateSla(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'activate sla policy (m16)');
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
    const s = await this.scoped(h, 'get sla policy (m16)');
    return specView(await this.service.getSlaPolicy(s.ctx, id));
  }
}
