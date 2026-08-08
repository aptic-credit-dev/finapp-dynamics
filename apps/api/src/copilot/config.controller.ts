import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CopilotConfigurationService, M28_PERMISSIONS, M28_AUDIT_CODES } from '@finapp/m28-executive-ai';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireTenantScope, requireVersion } from '../identity/http.ts';
import { configView } from './views.ts';

/**
 * Executive-copilot CONFIG under `/api/v1/copilot`. Versioned config per scope; READ-ONLY, CITATIONS and human-reviewed
 * export are always on (DB CHECKs — the copilot is advisory only and never acts). Create + publish are privileged
 * (ai.copilot.configure) and audited; the read carries no `@Endpoint` (the read permission is enforced in-service).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optNum<K extends string>(v: unknown, k: K): Partial<Record<K, number>> {
  return typeof v === 'number' && Number.isFinite(v) ? ({ [k]: v } as Record<K, number>) : {};
}

@Controller('copilot')
export class CopilotConfigController {
  private readonly service: CopilotConfigurationService;
  private readonly actors: ActorContextFactory;
  constructor(service: CopilotConfigurationService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M28_PERMISSIONS.copilotConfigure,
    auditCode: M28_AUDIT_CODES.configUpdated,
    description: 'Create a copilot configuration (draft).',
  })
  @Post('config')
  async createConfig(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create copilot config (m28)');
    const idem = h['idempotency-key'];
    return configView(
      await this.service.createConfig(s.ctx, s.actor.identityId, {
        ...optStr(b['scope'], 'scope'),
        ...optStr(b['name'], 'name'),
        ...optNum(b['minConfidenceBps'], 'minConfidenceBps'),
        ...optNum(b['maxSources'], 'maxSources'),
        ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
      }),
    );
  }

  @Endpoint({
    permission: M28_PERMISSIONS.copilotConfigure,
    auditCode: M28_AUDIT_CODES.configUpdated,
    description: 'Publish a draft copilot configuration (activate).',
  })
  @Post('config/:id/publish')
  async publishConfig(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish copilot config (m28)');
    return configView(
      await this.service.publishConfig(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }

  @Get('config')
  async listConfig(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list copilot config (m28)');
    return { config: (await this.service.listConfigs(s.ctx)).map(configView) };
  }
}
