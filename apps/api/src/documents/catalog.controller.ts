import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CatalogService, M09_AUDIT_CODES, M09_PERMISSIONS } from '@finapp/m09-docs';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { specView } from './views.ts';

/**
 * Document types + retention policies, under `/api/v1/documents` (Stage 2.5). Both are authored and walked
 * DRAFT → validate → publish → activate → retire; publishing freezes the immutable spec. Permission is enforced
 * in `CatalogService`.
 */
interface CreateBody {
  code?: unknown;
  name?: unknown;
  scope?: unknown;
  spec?: unknown;
}
interface ActionBody {
  expectedVersion?: unknown;
}

@Controller('documents')
export class CatalogController {
  private readonly service: CatalogService;
  private readonly actors: ActorContextFactory;
  constructor(service: CatalogService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  private body(headers: Record<string, string>, reason: string) {
    return this.actors.forRequest(headers, reason).then(requireTenantScope);
  }

  // --- document types ---------------------------------------------------------------------------
  @Endpoint({
    permission: M09_PERMISSIONS.typeManage,
    auditCode: M09_AUDIT_CODES.typeCreated,
    description: 'Create a draft document type.',
  })
  @Post('types')
  async createType(@Body() body: CreateBody, @Headers() headers: Record<string, string>) {
    const s = await this.body(headers, 'create document type (m09)');
    return specView(
      await this.service.createType(s.ctx, s.actor.identityId, {
        code: requireString(body.code, 'code', s.correlationId),
        name: requireString(body.name, 'name', s.correlationId),
        ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
        spec: body.spec,
      }),
    );
  }
  @Endpoint({
    permission: M09_PERMISSIONS.typeManage,
    auditCode: M09_AUDIT_CODES.typeCreated,
    description: 'Validate a document type.',
  })
  @Post('types/:id/validate')
  async validateType(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.body(h, 'validate document type (m09)');
    return specView(
      await this.service.validateType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M09_PERMISSIONS.typeManage,
    auditCode: M09_AUDIT_CODES.typePublished,
    description: 'Publish a document type.',
  })
  @Post('types/:id/publish')
  async publishType(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.body(h, 'publish document type (m09)');
    return specView(
      await this.service.publishType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M09_PERMISSIONS.typeManage,
    auditCode: M09_AUDIT_CODES.typePublished,
    description: 'Activate a document type.',
  })
  @Post('types/:id/activate')
  async activateType(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.body(h, 'activate document type (m09)');
    return specView(
      await this.service.activateType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M09_PERMISSIONS.typeManage,
    auditCode: M09_AUDIT_CODES.typePublished,
    description: 'Retire a document type.',
  })
  @Post('types/:id/retire')
  async retireType(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.body(h, 'retire document type (m09)');
    return specView(
      await this.service.retireType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('types')
  async listTypes(@Headers() h: Record<string, string>) {
    const s = await this.body(h, 'list document types (m09)');
    return { types: (await this.service.listTypes(s.ctx)).map(specView) };
  }
  @Get('types/:id')
  async getType(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.body(h, 'get document type (m09)');
    return specView(await this.service.getType(s.ctx, id));
  }

  // --- retention policies -----------------------------------------------------------------------
  @Endpoint({
    permission: M09_PERMISSIONS.retentionManage,
    auditCode: M09_AUDIT_CODES.retentionCreated,
    description: 'Create a draft retention policy.',
  })
  @Post('retention-policies')
  async createRetention(@Body() body: CreateBody, @Headers() headers: Record<string, string>) {
    const s = await this.body(headers, 'create retention policy (m09)');
    return specView(
      await this.service.createRetention(s.ctx, s.actor.identityId, {
        code: requireString(body.code, 'code', s.correlationId),
        name: requireString(body.name, 'name', s.correlationId),
        ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
        spec: body.spec,
      }),
    );
  }
  @Endpoint({
    permission: M09_PERMISSIONS.retentionManage,
    auditCode: M09_AUDIT_CODES.retentionCreated,
    description: 'Validate a retention policy.',
  })
  @Post('retention-policies/:id/validate')
  async validateRetention(
    @Param('id') id: string,
    @Body() b: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.body(h, 'validate retention policy (m09)');
    return specView(
      await this.service.validateRetention(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M09_PERMISSIONS.retentionManage,
    auditCode: M09_AUDIT_CODES.retentionPublished,
    description: 'Publish a retention policy.',
  })
  @Post('retention-policies/:id/publish')
  async publishRetention(
    @Param('id') id: string,
    @Body() b: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.body(h, 'publish retention policy (m09)');
    return specView(
      await this.service.publishRetention(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M09_PERMISSIONS.retentionManage,
    auditCode: M09_AUDIT_CODES.retentionPublished,
    description: 'Activate a retention policy.',
  })
  @Post('retention-policies/:id/activate')
  async activateRetention(
    @Param('id') id: string,
    @Body() b: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.body(h, 'activate retention policy (m09)');
    return specView(
      await this.service.activateRetention(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('retention-policies')
  async listRetentions(@Headers() h: Record<string, string>) {
    const s = await this.body(h, 'list retention policies (m09)');
    return { retentionPolicies: (await this.service.listRetentions(s.ctx)).map(specView) };
  }
  @Get('retention-policies/:id')
  async getRetention(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.body(h, 'get retention policy (m09)');
    return specView(await this.service.getRetention(s.ctx, id));
  }
}
