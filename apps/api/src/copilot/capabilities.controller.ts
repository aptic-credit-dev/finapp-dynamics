import { Controller, Get, Headers } from '@nestjs/common';
import { CopilotConfigurationService } from '@finapp/m28-executive-ai';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireTenantScope } from '../identity/http.ts';

/**
 * Executive-copilot CAPABILITIES under `/api/v1/copilot`. A read (ai.copilot.read, default deny, enforced in-service)
 * describing the copilot's read-only, cited, RLS-masked contract, the intent classes it supports and the controlled
 * actions it will NEVER take. Returns safe, static governance metadata only.
 */
@Controller('copilot')
export class CopilotCapabilitiesController {
  private readonly service: CopilotConfigurationService;
  private readonly actors: ActorContextFactory;
  constructor(service: CopilotConfigurationService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Get('capabilities')
  async capabilities(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get copilot capabilities (m28)');
    return this.service.describeCapabilities(s.ctx);
  }
}
