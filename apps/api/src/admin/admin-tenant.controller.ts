import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { TenantAdminService, M04_AUDIT_CODES, M04_PERMISSIONS } from '@finapp/m04-admin';
import { ActorContextFactory, requireUuidParam } from '@finapp/m02-identity';
import {
  actionOpts,
  optionalLimit,
  optionalOffset,
  requireTenantScope,
  type ActionBody,
} from '../identity/http.ts';

/**
 * Tenant administration — an ORCHESTRATION surface under `/api/v1/admin`. Every route requires an `admin.tenant.*`
 * permission (enforced in the M04 service) AND delegates to the m01 `TenantService`, which enforces ITS own permission,
 * transaction and audit (delegated authority; no bypass). Suspend/reactivate are recorded in the M04 admin-operation
 * ledger; the authoritative state change + audit are m01's. `x-tenant-id` scopes the caller; a tenant admin can only
 * act within their own tenant (RLS + m01 gate). No direct DB access.
 */
@Controller('admin')
export class AdminTenantController {
  private readonly service: TenantAdminService;
  private readonly actors: ActorContextFactory;
  constructor(service: TenantAdminService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Get('tenants')
  async list(
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'admin list tenants (m04)');
    const out = await this.service.list(s.ctx, {
      ...(typeof status === 'string' && status !== '' ? { status } : {}),
      ...optionalLimit(limit, s.correlationId),
      ...optionalOffset(offset, s.correlationId),
    });
    return out;
  }
  @Get('tenants/:id')
  async get(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'admin get tenant (m04)');
    return { tenant: await this.service.get(s.ctx, requireUuidParam(id, 'id', s.correlationId)) };
  }
  @Get('tenants/:id/status-history')
  async history(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'admin tenant status history (m04)');
    return { history: await this.service.statusHistory(s.ctx, requireUuidParam(id, 'id', s.correlationId)) };
  }

  @Endpoint({
    permission: M04_PERMISSIONS.tenantSuspend,
    auditCode: M04_AUDIT_CODES.tenantSuspended,
    description: 'Suspend a tenant (orchestrates m01; recorded in the admin operation ledger).',
  })
  @Post('tenants/:id/suspend')
  async suspend(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'admin suspend tenant (m04)');
    const idem = h['idempotency-key'];
    return {
      tenant: await this.service.suspend(
        s.ctx,
        s.actor.identityId,
        requireUuidParam(id, 'id', s.correlationId),
        actionOpts(b, s.correlationId),
        typeof idem === 'string' && idem !== '' ? idem : undefined,
      ),
    };
  }

  @Endpoint({
    permission: M04_PERMISSIONS.tenantReactivate,
    auditCode: M04_AUDIT_CODES.tenantReactivated,
    description: 'Reactivate a tenant (orchestrates m01; recorded in the admin operation ledger).',
  })
  @Post('tenants/:id/reactivate')
  async reactivate(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'admin reactivate tenant (m04)');
    const idem = h['idempotency-key'];
    return {
      tenant: await this.service.reactivate(
        s.ctx,
        s.actor.identityId,
        requireUuidParam(id, 'id', s.correlationId),
        actionOpts(b, s.correlationId),
        typeof idem === 'string' && idem !== '' ? idem : undefined,
      ),
    };
  }
}
