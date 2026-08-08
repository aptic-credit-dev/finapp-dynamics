import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CopilotSessionService, M28_PERMISSIONS, M28_AUDIT_CODES } from '@finapp/m28-executive-ai';
import { ActorContextFactory } from '@finapp/m02-identity';
import { optionalLimit, optionalOffset, requireTenantScope } from '../identity/http.ts';
import { sessionView } from './views.ts';

/**
 * Executive-copilot SESSIONS under `/api/v1/copilot`. A session is a bounded conversation scope; a 'platform'-scoped or
 * confidential/restricted session needs the dedicated privileged permission (enforced in `CopilotSessionService`,
 * default deny). Creation is audited; reads carry no `@Endpoint` (the read permission is enforced in-service).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('copilot')
export class CopilotSessionsController {
  private readonly service: CopilotSessionService;
  private readonly actors: ActorContextFactory;
  constructor(service: CopilotSessionService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M28_PERMISSIONS.copilotQuery,
    auditCode: M28_AUDIT_CODES.sessionCreated,
    description: 'Open an executive-copilot session (read-only assistant scope).',
  })
  @Post('sessions')
  async createSession(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create copilot session (m28)');
    const idem = h['idempotency-key'];
    return sessionView(
      await this.service.createSession(s.ctx, s.actor.identityId, {
        ...optStr(b['scopeLevel'], 'scopeLevel'),
        ...optStr(b['subjectLabel'], 'subjectLabel'),
        ...optStr(b['classification'], 'classification'),
        ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
      }),
    );
  }

  @Get('sessions')
  async listSessions(
    @Headers() h: Record<string, string>,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const s = await this.scoped(h, 'list copilot sessions (m28)');
    const rows = await this.service.listSessions(s.ctx, {
      ...optionalLimit(limit, s.correlationId),
      ...optionalOffset(offset, s.correlationId),
    });
    return { sessions: rows.map(sessionView) };
  }

  @Get('sessions/:id')
  async getSession(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get copilot session (m28)');
    return sessionView(await this.service.getSession(s.ctx, id));
  }
}
