import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { ConfigService, M19_AUDIT_CODES, M19_PERMISSIONS } from '@finapp/m19-finance';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { configView, configHistoryView } from './views.ts';

/**
 * Versioned finance configuration per accounting entity + scope (default accounts, posting-rule METADATA — never
 * posting itself), under `/api/v1/finance`. Config is PUBLISHABLE + IMMUTABLE-after-publish through the ONE choke
 * point `checkConfigTransition` (draft → active → superseded → retired): a draft may be edited; a published version
 * is frozen (its content_hash sealed at publish) and a change is a NEW version (supersession). Settings are opaque
 * config JSON — no monetary amounts, balances or float (ADR-007). Permission enforced in ConfigService (default
 * deny). Read (GET) routes carry no `@Endpoint` — the read permission is enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('finance')
export class FinanceConfigController {
  private readonly service: ConfigService;
  private readonly actors: ActorContextFactory;
  constructor(service: ConfigService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- create (draft) ---------------------------------------------------------------------------
  @Endpoint({
    permission: M19_PERMISSIONS.configManage,
    auditCode: M19_AUDIT_CODES.configCreated,
    description: 'Create a finance configuration (draft).',
  })
  @Post('configs')
  async createConfig(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create config (m19)');
    const idem = h['idempotency-key'];
    return configView(
      await this.service.createConfig(s.ctx, s.actor.identityId, {
        entityId: requireString(b['entityId'], 'entityId', s.correlationId),
        ...optStr(b['scope'], 'scope'),
        ...('settings' in b ? { settings: b['settings'] } : {}),
        ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
      }),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.configManage,
    auditCode: M19_AUDIT_CODES.configCreated,
    description: 'Edit a draft finance configuration.',
  })
  @Post('configs/:id')
  async updateDraft(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update config draft (m19)');
    return configView(
      await this.service.updateDraft(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        settings: b['settings'],
      }),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.configPublish,
    auditCode: M19_AUDIT_CODES.configPublished,
    description: 'Publish a draft finance configuration (freeze content hash).',
  })
  @Post('configs/:id/publish')
  async publishConfig(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish config (m19)');
    return configView(
      await this.service.publishConfig(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.configPublish,
    auditCode: M19_AUDIT_CODES.configSuperseded,
    description: 'Supersede an active configuration with a new version.',
  })
  @Post('configs/:id/supersede')
  async supersedeConfig(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'supersede config (m19)');
    const r = await this.service.supersedeConfig(s.ctx, s.actor.identityId, id, {
      expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
      ...('settings' in b ? { settings: b['settings'] } : {}),
    });
    return { prior: configView(r.prior), successor: configView(r.successor) };
  }
  @Endpoint({
    permission: M19_PERMISSIONS.configManage,
    auditCode: M19_AUDIT_CODES.configSuperseded,
    description: 'Retire a finance configuration.',
  })
  @Post('configs/:id/retire')
  async retireConfig(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'retire config (m19)');
    return configView(
      await this.service.retireConfig(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('configs')
  async listConfigs(
    @Headers() h: Record<string, string>,
    @Query('entityId') entityId?: string,
    @Query('scope') scope?: string,
  ) {
    const s = await this.scoped(h, 'list configs (m19)');
    const rows = await this.service.listConfigs(s.ctx, {
      entityId: requireString(entityId, 'entityId', s.correlationId),
      ...optStr(scope, 'scope'),
    });
    return { configs: rows.map(configView) };
  }
  @Get('configs/:id')
  async getConfig(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get config (m19)');
    return configView(await this.service.getConfig(s.ctx, id));
  }
  @Get('configs/:id/history')
  async listConfigHistory(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list config history (m19)');
    return { history: (await this.service.listConfigHistory(s.ctx, id)).map(configHistoryView) };
  }
}
