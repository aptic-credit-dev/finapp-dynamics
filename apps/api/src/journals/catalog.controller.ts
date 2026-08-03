import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CatalogService, M21_AUDIT_CODES, M21_PERMISSIONS } from '@finapp/m21-journal';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { journalTypeView, journalConfigView, reasonCodeView } from './views.ts';

/**
 * Journal-engine CONFIGURABLE reference data — journal types (versioned, one active per code), engine config
 * (versioned, immutable-after-publish, one active per scope) and the validation reason-code registry — under
 * `/api/v1/journals`. Nothing Aptic-/Kenya-specific. type/config manage/publish + reason-code manage are privileged
 * (enforced in-service). Read routes carry no `@Endpoint`.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('journals')
export class JournalCatalogController {
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
    permission: M21_PERMISSIONS.typeManage,
    auditCode: M21_AUDIT_CODES.typeCreated,
    description: 'Create a journal type.',
  })
  @Post('types')
  async createType(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create journal type (m21)');
    return journalTypeView(
      await this.service.createType(s.ctx, s.actor.identityId, {
        code: requireString(b['code'], 'code', s.correlationId),
        ...optStr(b['name'], 'name'),
        ...optStr(b['kind'], 'kind'),
        ...(typeof b['requiresBalance'] === 'boolean' ? { requiresBalance: b['requiresBalance'] } : {}),
      }),
    );
  }
  @Endpoint({
    permission: M21_PERMISSIONS.typeManage,
    auditCode: M21_AUDIT_CODES.typeUpdated,
    description: 'Publish a journal type.',
  })
  @Post('types/:id/publish')
  async publishType(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish journal type (m21)');
    return journalTypeView(
      await this.service.publishType(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
      ),
    );
  }
  @Get('types')
  async listTypes(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list journal types (m21)');
    return { types: (await this.service.listTypes(s.ctx)).map(journalTypeView) };
  }
  @Get('types/:id')
  async getType(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get journal type (m21)');
    return journalTypeView(await this.service.getType(s.ctx, id));
  }

  @Endpoint({
    permission: M21_PERMISSIONS.configManage,
    auditCode: M21_AUDIT_CODES.configCreated,
    description: 'Create a journal-engine config.',
  })
  @Post('config')
  async createConfig(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create journal config (m21)');
    const idem = h['idempotency-key'];
    return journalConfigView(
      await this.service.createConfig(s.ctx, s.actor.identityId, {
        ...optStr(b['scope'], 'scope'),
        ...optStr(b['name'], 'name'),
        ...(typeof b['maxLines'] === 'number' ? { maxLines: b['maxLines'] } : {}),
        ...(typeof b['allowManualDraft'] === 'boolean' ? { allowManualDraft: b['allowManualDraft'] } : {}),
        ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
      }),
    );
  }
  @Endpoint({
    permission: M21_PERMISSIONS.configPublish,
    auditCode: M21_AUDIT_CODES.configPublished,
    description: 'Publish a journal-engine config.',
  })
  @Post('config/:id/publish')
  async publishConfig(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish journal config (m21)');
    return journalConfigView(
      await this.service.publishConfig(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
      ),
    );
  }
  @Get('config')
  async listConfig(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list journal config (m21)');
    return { config: (await this.service.listConfigs(s.ctx)).map(journalConfigView) };
  }

  @Endpoint({
    permission: M21_PERMISSIONS.reasonCodeManage,
    auditCode: M21_AUDIT_CODES.reasonCodeRegistered,
    description: 'Register a validation reason code.',
  })
  @Post('reason-codes')
  async registerReasonCode(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register reason code (m21)');
    return reasonCodeView(
      await this.service.registerReasonCode(s.ctx, s.actor.identityId, {
        code: requireString(b['code'], 'code', s.correlationId),
        category: requireString(b['category'], 'category', s.correlationId),
        severity: requireString(b['severity'], 'severity', s.correlationId),
        ...optStr(b['description'], 'description'),
      }),
    );
  }
  @Get('reason-codes')
  async listReasonCodes(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list reason codes (m21)');
    return { reasonCodes: (await this.service.listReasonCodes(s.ctx)).map(reasonCodeView) };
  }
}
