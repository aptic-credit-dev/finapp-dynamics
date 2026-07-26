import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CatalogService, M13_AUDIT_CODES, M13_PERMISSIONS } from '@finapp/m13-case';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { specView } from './views.ts';

/**
 * Case catalog — versioned case types and SLA policies, under `/api/v1/cases`. Both are immutable-after-publish
 * (one ACTIVE per code+scope). Permission enforced in CatalogService (default deny).
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

@Controller('cases')
export class CaseCatalogController {
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
    permission: M13_PERMISSIONS.typeManage,
    auditCode: M13_AUDIT_CODES.typeCreated,
    description: 'Create a draft case type.',
  })
  @Post('types')
  async createType(@Body() b: SpecBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create case type (m13)');
    return specView(
      await this.service.createCaseType(s.ctx, s.actor.identityId, {
        code: requireString(b.code, 'code', s.correlationId),
        name: requireString(b.name, 'name', s.correlationId),
        ...(typeof b.scope === 'string' ? { scope: b.scope } : {}),
        spec: b.spec,
      }),
    );
  }
  @Endpoint({
    permission: M13_PERMISSIONS.typeManage,
    auditCode: M13_AUDIT_CODES.typeCreated,
    description: 'Validate a case type.',
  })
  @Post('types/:id/validate')
  async validateType(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'validate case type (m13)');
    return specView(
      await this.service.validateCaseType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M13_PERMISSIONS.typeManage,
    auditCode: M13_AUDIT_CODES.typePublished,
    description: 'Publish a case type.',
  })
  @Post('types/:id/publish')
  async publishType(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'publish case type (m13)');
    return specView(
      await this.service.publishCaseType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M13_PERMISSIONS.typeManage,
    auditCode: M13_AUDIT_CODES.typePublished,
    description: 'Activate a case type.',
  })
  @Post('types/:id/activate')
  async activateType(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'activate case type (m13)');
    return specView(
      await this.service.activateCaseType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('types/:id')
  async getType(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get case type (m13)');
    return specView(await this.service.getCaseType(s.ctx, id));
  }

  @Endpoint({
    permission: M13_PERMISSIONS.slaPolicyManage,
    auditCode: M13_AUDIT_CODES.typeCreated,
    description: 'Create a draft SLA policy.',
  })
  @Post('sla-policies')
  async createSla(@Body() b: SpecBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create sla policy (m13)');
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
    permission: M13_PERMISSIONS.slaPolicyManage,
    auditCode: M13_AUDIT_CODES.typeCreated,
    description: 'Validate an SLA policy.',
  })
  @Post('sla-policies/:id/validate')
  async validateSla(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'validate sla policy (m13)');
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
    permission: M13_PERMISSIONS.slaPolicyManage,
    auditCode: M13_AUDIT_CODES.slaPolicyPublished,
    description: 'Publish an SLA policy.',
  })
  @Post('sla-policies/:id/publish')
  async publishSla(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'publish sla policy (m13)');
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
    permission: M13_PERMISSIONS.slaPolicyManage,
    auditCode: M13_AUDIT_CODES.slaPolicyPublished,
    description: 'Activate an SLA policy.',
  })
  @Post('sla-policies/:id/activate')
  async activateSla(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'activate sla policy (m13)');
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
    const s = await this.scoped(h, 'get sla policy (m13)');
    return specView(await this.service.getSlaPolicy(s.ctx, id));
  }
}
