import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { TemplateService, M08_AUDIT_CODES, M08_PERMISSIONS } from '@finapp/m08-notify';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { templateView, versionView } from './views.ts';

/**
 * Notification templates and their versions, under `/api/v1/notifications` (Stage 2.4).
 *
 * A template is authored, versioned, then walked DRAFT → validate → publish → activate → retire, each an
 * explicit route guarding its own permission and audit code. Every handler resolves its actor through
 * `ActorContextFactory` and works in the caller's TENANT context — another tenant's template is physically
 * unreachable under RLS. Permission is enforced in `TemplateService`, not here.
 */

interface CreateBody {
  key?: unknown;
  name?: unknown;
  description?: unknown;
  scope?: unknown;
  spec?: unknown;
}
interface UpdateBody {
  expectedVersion?: unknown;
  name?: unknown;
  description?: unknown;
}
interface NewVersionBody {
  spec?: unknown;
  notes?: unknown;
}
interface ActionBody {
  expectedVersion?: unknown;
  reason?: unknown;
}

@Controller('notifications')
export class TemplatesController {
  private readonly service: TemplateService;
  private readonly actors: ActorContextFactory;
  constructor(service: TemplateService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Endpoint({
    permission: M08_PERMISSIONS.templateAuthor,
    auditCode: M08_AUDIT_CODES.templateCreated,
    description: 'Create a notification template with its first draft version.',
  })
  @Post('templates')
  async create(@Body() body: CreateBody, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'create notification template (m08)'),
    );
    const cid = scoped.correlationId;
    const { template, version } = await this.service.create(scoped.ctx, scoped.actor.identityId, {
      key: requireString(body.key, 'key', cid),
      name: requireString(body.name, 'name', cid),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
      spec: body.spec,
    });
    return { template: templateView(template), version: versionView(version) };
  }

  @Endpoint({
    permission: M08_PERMISSIONS.templateAuthor,
    auditCode: M08_AUDIT_CODES.templateUpdated,
    description: 'Rename or re-describe a template (metadata only).',
  })
  @Post('templates/:id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'update notification template (m08)'),
    );
    const cid = scoped.correlationId;
    const row = await this.service.update(scoped.ctx, scoped.actor.identityId, id, {
      expectedVersion: requireVersion(body.expectedVersion, cid),
      name: requireString(body.name, 'name', cid),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
    });
    return templateView(row);
  }

  @Endpoint({
    permission: M08_PERMISSIONS.templateAuthor,
    auditCode: M08_AUDIT_CODES.versionCreated,
    description: 'Author a new draft version of an existing template.',
  })
  @Post('templates/:id/versions')
  async newVersion(
    @Param('id') id: string,
    @Body() body: NewVersionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'revise notification template (m08)'),
    );
    const row = await this.service.newVersion(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      body.spec,
      typeof body.notes === 'string' ? body.notes : null,
    );
    return versionView(row);
  }

  @Endpoint({
    permission: M08_PERMISSIONS.templateValidate,
    auditCode: M08_AUDIT_CODES.templateValidated,
    description: 'Validate a template version against the engine rules.',
  })
  @Post('versions/:id/validate')
  async validate(
    @Param('id') id: string,
    @Body() body: ActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'validate notification template (m08)'),
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
    permission: M08_PERMISSIONS.templatePublish,
    auditCode: M08_AUDIT_CODES.versionPublished,
    description: 'Publish a validated version (freezes its content, immutable thereafter).',
  })
  @Post('versions/:id/publish')
  async publish(
    @Param('id') id: string,
    @Body() body: ActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'publish notification template (m08)'),
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
    permission: M08_PERMISSIONS.templateActivate,
    auditCode: M08_AUDIT_CODES.versionActivated,
    description: 'Activate a published version (exactly one active version governs sending).',
  })
  @Post('versions/:id/activate')
  async activate(
    @Param('id') id: string,
    @Body() body: ActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'activate notification template (m08)'),
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
    permission: M08_PERMISSIONS.templateRetire,
    auditCode: M08_AUDIT_CODES.versionRetired,
    description: 'Retire a version (no new requests bind to it).',
  })
  @Post('versions/:id/retire')
  async retire(
    @Param('id') id: string,
    @Body() body: ActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'retire notification template (m08)'),
    );
    const row = await this.service.retire(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, scoped.correlationId),
      typeof body.reason === 'string' ? body.reason : null,
    );
    return versionView(row);
  }

  // --- reads (notifications.template.view, enforced in the service) -----------------------------
  @Get('templates')
  async list(@Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'list notification templates (m08)'),
    );
    const rows = await this.service.list(scoped.ctx);
    return { templates: rows.map(templateView) };
  }

  @Get('templates/:id')
  async get(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'get notification template (m08)'),
    );
    return templateView(await this.service.get(scoped.ctx, id));
  }

  @Get('templates/:id/versions')
  async listVersions(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'list template versions (m08)'));
    const rows = await this.service.listVersions(scoped.ctx, id);
    return { versions: rows.map(versionView) };
  }

  @Get('versions/:id')
  async getVersion(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'get template version (m08)'));
    return versionView(await this.service.getVersion(scoped.ctx, id));
  }
}
