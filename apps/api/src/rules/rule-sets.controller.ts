import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  // VALUE import, deliberately not `import type`: NestJS resolves constructor dependencies from the
  // design-time metadata `emitDecoratorMetadata` writes, which a type-only import erases before emission.
  RuleSetService,
  M07_AUDIT_CODES,
  M07_PERMISSIONS,
} from '@finapp/m07-rules';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { ruleSetView, versionView, historyView } from './views.ts';

/**
 * Decision rule sets and their versions, under `/api/v1/rules` (Stage 2.3).
 *
 * A rule set is authored, versioned, then walked DRAFT → validate → publish → activate → retire, each an
 * explicit route guarding its own permission and audit code. Every handler resolves its actor through
 * `ActorContextFactory` and works in the caller's TENANT context — another tenant's rule set is physically
 * unreachable under RLS, not merely refused. Permission is enforced in `RuleSetService`, not here; the
 * `@Endpoint` permission is the declaration, the service the single place it is checked. GET reads carry no
 * `@Endpoint`; their view permission is enforced inside the service.
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

@Controller('rules')
export class RuleSetsController {
  private readonly service: RuleSetService;
  private readonly actors: ActorContextFactory;

  constructor(service: RuleSetService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Endpoint({
    permission: M07_PERMISSIONS.engineAuthor,
    auditCode: M07_AUDIT_CODES.setCreated,
    description: 'Create a decision rule set with its first draft version.',
  })
  @Post('sets')
  async create(@Body() body: CreateBody, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'create rule set (m07)'));
    const cid = scoped.correlationId;
    const { ruleSet, version } = await this.service.create(scoped.ctx, scoped.actor.identityId, {
      key: requireString(body.key, 'key', cid),
      name: requireString(body.name, 'name', cid),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
      spec: body.spec,
    });
    return { ruleSet: ruleSetView(ruleSet), version: versionView(version) };
  }

  @Endpoint({
    permission: M07_PERMISSIONS.engineAuthor,
    auditCode: M07_AUDIT_CODES.setUpdated,
    description: 'Rename or re-describe a rule set (metadata only).',
  })
  @Post('sets/:id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'update rule set (m07)'));
    const cid = scoped.correlationId;
    const row = await this.service.update(scoped.ctx, scoped.actor.identityId, id, {
      expectedVersion: requireVersion(body.expectedVersion, cid),
      name: requireString(body.name, 'name', cid),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
    });
    return ruleSetView(row);
  }

  @Endpoint({
    permission: M07_PERMISSIONS.engineAuthor,
    auditCode: M07_AUDIT_CODES.versionCreated,
    description: 'Author a new draft version of an existing rule set.',
  })
  @Post('sets/:id/versions')
  async newVersion(
    @Param('id') id: string,
    @Body() body: NewVersionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'revise rule set (m07)'));
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
    permission: M07_PERMISSIONS.engineValidate,
    auditCode: M07_AUDIT_CODES.setValidated,
    description: 'Validate a rule set version against the engine rules.',
  })
  @Post('versions/:id/validate')
  async validate(
    @Param('id') id: string,
    @Body() body: ActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'validate rule set (m07)'));
    const row = await this.service.validate(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, scoped.correlationId),
    );
    return versionView(row);
  }

  @Endpoint({
    permission: M07_PERMISSIONS.enginePublish,
    auditCode: M07_AUDIT_CODES.versionPublished,
    description: 'Publish a validated version (freezes its content, immutable thereafter).',
  })
  @Post('versions/:id/publish')
  async publish(
    @Param('id') id: string,
    @Body() body: ActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'publish rule set (m07)'));
    const row = await this.service.publish(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, scoped.correlationId),
    );
    return versionView(row);
  }

  @Endpoint({
    permission: M07_PERMISSIONS.engineActivate,
    auditCode: M07_AUDIT_CODES.versionActivated,
    description: 'Activate a published version (exactly one active version governs evaluation).',
  })
  @Post('versions/:id/activate')
  async activate(
    @Param('id') id: string,
    @Body() body: ActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'activate rule set (m07)'));
    const row = await this.service.activate(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, scoped.correlationId),
    );
    return versionView(row);
  }

  @Endpoint({
    permission: M07_PERMISSIONS.engineRetire,
    auditCode: M07_AUDIT_CODES.versionRetired,
    description: 'Retire a version (no new evaluations bind to it).',
  })
  @Post('versions/:id/retire')
  async retire(
    @Param('id') id: string,
    @Body() body: ActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'retire rule set (m07)'));
    const row = await this.service.retire(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, scoped.correlationId),
      typeof body.reason === 'string' ? body.reason : null,
    );
    return versionView(row);
  }

  // --- reads (rules.engine.view, enforced in the service) ---------------------------------------
  @Get('sets')
  async list(@Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'list rule sets (m07)'));
    const rows = await this.service.list(scoped.ctx);
    return { ruleSets: rows.map(ruleSetView) };
  }

  @Get('sets/:id')
  async get(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'get rule set (m07)'));
    return ruleSetView(await this.service.get(scoped.ctx, id));
  }

  @Get('sets/:id/versions')
  async listVersions(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'list versions (m07)'));
    const rows = await this.service.listVersions(scoped.ctx, id);
    return { versions: rows.map(versionView) };
  }

  @Get('versions/:id')
  async getVersion(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'get version (m07)'));
    return versionView(await this.service.getVersion(scoped.ctx, id));
  }

  @Get('sets/:id/history')
  async history(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'rule set history (m07)'));
    const rows = await this.service.history(scoped.ctx, id);
    return { history: rows.map(historyView) };
  }
}
