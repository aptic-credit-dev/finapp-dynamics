import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint, ProblemError } from '@finapp/kernel';
import {
  // VALUE import, deliberately not `import type`: NestJS resolves constructor dependencies from the
  // design-time metadata `emitDecoratorMetadata` writes, which a type-only import erases before emission.
  DefinitionService,
  M06_AUDIT_CODES,
  M06_PERMISSIONS,
} from '@finapp/m06-workflow';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { definitionView, versionView } from './views.ts';

/**
 * Workflow definitions and their versions, under `/api/v1/workflow` (D2).
 *
 * A definition is authored, versioned, then walked through validate → publish → activate → retire, each an
 * explicit route guarding its own permission and audit code. Every handler resolves its actor through
 * `ActorContextFactory` and works in the caller's TENANT context — a definition for another tenant is
 * physically unreachable under RLS, not merely refused. Permission is enforced in `DefinitionService`, not
 * here; the `@Endpoint` permission is the declaration, the service the single place it is checked.
 */

interface CreateDefinitionBody {
  code?: unknown;
  name?: unknown;
  description?: unknown;
  spec?: unknown;
}

interface NewVersionBody {
  spec?: unknown;
}

interface VersionActionBody {
  expectedVersion?: unknown;
  reason?: unknown;
}

@Controller('workflow')
export class DefinitionsController {
  private readonly service: DefinitionService;
  private readonly actors: ActorContextFactory;

  constructor(service: DefinitionService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Endpoint({
    permission: M06_PERMISSIONS.definitionCreate,
    auditCode: M06_AUDIT_CODES.definitionCreated,
    description: 'Create a workflow definition with its first draft version.',
  })
  @Post('definitions')
  async create(@Body() body: CreateDefinitionBody, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'create workflow definition (m06)'),
    );
    const cid = scoped.correlationId;
    const { definition, version } = await this.service.create(scoped.ctx, scoped.actor.identityId, {
      code: requireString(body.code, 'code', cid),
      name: requireString(body.name, 'name', cid),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      spec: body.spec,
    });
    return { definition: definitionView(definition), version: versionView(version) };
  }

  @Get('definitions/:id')
  async get(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'read workflow definition version (m06)'),
    );
    const row = await this.service.view(scoped.ctx, id);
    if (row === null)
      throw ProblemError.notFound('Workflow definition version not found.', scoped.correlationId);
    return versionView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.definitionEdit,
    auditCode: M06_AUDIT_CODES.definitionUpdated,
    description: 'Draft a new version of an existing workflow definition.',
  })
  @Post('definitions/:id/versions')
  async newVersion(
    @Param('id') id: string,
    @Body() body: NewVersionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'draft workflow definition version (m06)'),
    );
    const row = await this.service.newVersion(scoped.ctx, scoped.actor.identityId, id, body.spec);
    return versionView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.definitionValidate,
    auditCode: M06_AUDIT_CODES.definitionValidated,
    description: 'Validate a draft version. Requires expectedVersion.',
  })
  @Post('definitions/:id/validate')
  async validate(
    @Param('id') id: string,
    @Body() body: VersionActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'validate workflow version (m06)'),
    );
    const row = await this.service.validate(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, scoped.correlationId),
    );
    return versionView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.definitionPublish,
    auditCode: M06_AUDIT_CODES.definitionPublished,
    description: 'Publish a validated version. Requires expectedVersion.',
  })
  @Post('definitions/:id/publish')
  async publish(
    @Param('id') id: string,
    @Body() body: VersionActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'publish workflow version (m06)'),
    );
    const row = await this.service.publish(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, scoped.correlationId),
    );
    return versionView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.definitionActivate,
    auditCode: M06_AUDIT_CODES.definitionActivated,
    description: 'Activate a published version. Requires expectedVersion.',
  })
  @Post('definitions/:id/activate')
  async activate(
    @Param('id') id: string,
    @Body() body: VersionActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'activate workflow version (m06)'),
    );
    const row = await this.service.activate(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, scoped.correlationId),
    );
    return versionView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.definitionRetire,
    auditCode: M06_AUDIT_CODES.definitionRetired,
    description: 'Retire a version. Requires expectedVersion and a reason.',
  })
  @Post('definitions/:id/retire')
  async retire(
    @Param('id') id: string,
    @Body() body: VersionActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'retire workflow version (m06)'));
    const cid = scoped.correlationId;
    const row = await this.service.retire(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, cid),
      requireString(body.reason, 'reason', cid),
    );
    return versionView(row);
  }
}
