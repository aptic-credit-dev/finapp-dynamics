import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CatalogService, M14_AUDIT_CODES, M14_PERMISSIONS } from '@finapp/m14-legal';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { specView } from './views.ts';

/**
 * Legal catalog — versioned matter types + SLA policies, and configurable jurisdictions/forums, under
 * `/api/v1/legal`. Matter types + SLA policies are immutable-after-publish (one ACTIVE per code+scope).
 * Permission enforced in CatalogService (default deny).
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
interface JurBody {
  code?: unknown;
  name?: unknown;
  kind?: unknown;
  country?: unknown;
  station?: unknown;
  active?: unknown;
}

@Controller('legal')
export class LegalCatalogController {
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
    permission: M14_PERMISSIONS.jurisdictionManage,
    auditCode: M14_AUDIT_CODES.jurisdictionConfigured,
    description: 'Configure a jurisdiction/forum.',
  })
  @Post('jurisdictions')
  async setJurisdiction(@Body() b: JurBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'configure jurisdiction (m14)');
    await this.service.setJurisdiction(s.ctx, s.actor.identityId, {
      code: requireString(b.code, 'code', s.correlationId),
      name: requireString(b.name, 'name', s.correlationId),
      ...(typeof b.kind === 'string' ? { kind: b.kind } : {}),
      ...(typeof b.country === 'string' ? { country: b.country } : {}),
      ...(typeof b.station === 'string' ? { station: b.station } : {}),
      active: b.active !== false,
    });
    return { ok: true };
  }

  @Endpoint({
    permission: M14_PERMISSIONS.matterTypeManage,
    auditCode: M14_AUDIT_CODES.matterTypeCreated,
    description: 'Create a draft matter type.',
  })
  @Post('matter-types')
  async createType(@Body() b: SpecBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create matter type (m14)');
    return specView(
      await this.service.createMatterType(s.ctx, s.actor.identityId, {
        code: requireString(b.code, 'code', s.correlationId),
        name: requireString(b.name, 'name', s.correlationId),
        ...(typeof b.scope === 'string' ? { scope: b.scope } : {}),
        spec: b.spec,
      }),
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.matterTypeManage,
    auditCode: M14_AUDIT_CODES.matterTypeCreated,
    description: 'Validate a matter type.',
  })
  @Post('matter-types/:id/validate')
  async validateType(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'validate matter type (m14)');
    return specView(
      await this.service.validateMatterType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.matterTypeManage,
    auditCode: M14_AUDIT_CODES.matterTypePublished,
    description: 'Publish a matter type.',
  })
  @Post('matter-types/:id/publish')
  async publishType(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'publish matter type (m14)');
    return specView(
      await this.service.publishMatterType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.matterTypeManage,
    auditCode: M14_AUDIT_CODES.matterTypePublished,
    description: 'Activate a matter type.',
  })
  @Post('matter-types/:id/activate')
  async activateType(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'activate matter type (m14)');
    return specView(
      await this.service.activateMatterType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('matter-types/:id')
  async getType(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get matter type (m14)');
    return specView(await this.service.getMatterType(s.ctx, id));
  }

  @Endpoint({
    permission: M14_PERMISSIONS.slaPolicyManage,
    auditCode: M14_AUDIT_CODES.matterTypeCreated,
    description: 'Create a draft SLA policy.',
  })
  @Post('sla-policies')
  async createSla(@Body() b: SpecBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create sla policy (m14)');
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
    permission: M14_PERMISSIONS.slaPolicyManage,
    auditCode: M14_AUDIT_CODES.matterTypeCreated,
    description: 'Validate an SLA policy.',
  })
  @Post('sla-policies/:id/validate')
  async validateSla(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'validate sla policy (m14)');
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
    permission: M14_PERMISSIONS.slaPolicyManage,
    auditCode: M14_AUDIT_CODES.slaPolicyPublished,
    description: 'Publish an SLA policy.',
  })
  @Post('sla-policies/:id/publish')
  async publishSla(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'publish sla policy (m14)');
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
    permission: M14_PERMISSIONS.slaPolicyManage,
    auditCode: M14_AUDIT_CODES.slaPolicyPublished,
    description: 'Activate an SLA policy.',
  })
  @Post('sla-policies/:id/activate')
  async activateSla(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'activate sla policy (m14)');
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
    const s = await this.scoped(h, 'get sla policy (m14)');
    return specView(await this.service.getSlaPolicy(s.ctx, id));
  }
}
