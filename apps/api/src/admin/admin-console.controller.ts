import { Body, Controller, Get, Headers, Param, Post, Put, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { AdminOperationService, M04_AUDIT_CODES, M04_PERMISSIONS } from '@finapp/m04-admin';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope } from '../identity/http.ts';
import { operationView, operationHistoryView, savedViewView, preferenceView } from './views.ts';

/**
 * Admin console — the M04-OWNED surface (governed admin-operation trail, saved views, preferences, dashboard) under
 * `/api/v1/admin`. Every route is authenticated + tenant-scoped and declares an `admin.*` permission enforced in the
 * service (default deny). No direct DB access; correlation id + audit context flow through the service.
 */
@Controller('admin')
export class AdminConsoleController {
  private readonly service: AdminOperationService;
  private readonly actors: ActorContextFactory;
  constructor(service: AdminOperationService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- governed operations (read) ---------------------------------------------------------------
  @Get('operations')
  async listOperations(@Query('status') status: string | undefined, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list admin operations (m04)');
    const rows = await this.service.listOperations(
      s.ctx,
      typeof status === 'string' && status !== '' ? status : undefined,
    );
    return { operations: rows.map(operationView) };
  }
  @Get('operations/:id')
  async getOperation(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get admin operation (m04)');
    const out = await this.service.getOperation(s.ctx, id);
    return { operation: operationView(out.operation), history: out.history.map(operationHistoryView) };
  }

  // --- saved views ------------------------------------------------------------------------------
  @Endpoint({
    permission: M04_PERMISSIONS.savedViewManage,
    auditCode: M04_AUDIT_CODES.savedViewSaved,
    description: 'Save an admin console view (filter only).',
  })
  @Post('saved-views')
  async saveView(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'save admin view (m04)');
    return savedViewView(
      await this.service.saveView(s.ctx, s.actor.identityId, {
        area: requireString(b['area'], 'area', s.correlationId),
        name: requireString(b['name'], 'name', s.correlationId),
        filter: b['filter'] ?? {},
      }),
    );
  }
  @Get('saved-views')
  async listViews(@Query('area') area: string | undefined, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list admin views (m04)');
    const rows = await this.service.listViews(
      s.ctx,
      s.actor.identityId,
      typeof area === 'string' && area !== '' ? area : undefined,
    );
    return { savedViews: rows.map(savedViewView) };
  }

  // --- preferences ------------------------------------------------------------------------------
  @Endpoint({
    permission: M04_PERMISSIONS.preferenceManage,
    auditCode: M04_AUDIT_CODES.preferenceUpdated,
    description: 'Set an admin console preference.',
  })
  @Put('preferences')
  async setPreference(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'set admin preference (m04)');
    return preferenceView(
      await this.service.setPreference(s.ctx, s.actor.identityId, {
        prefKey: requireString(b['prefKey'], 'prefKey', s.correlationId),
        prefValue: b['prefValue'] ?? {},
      }),
    );
  }
  @Get('preferences')
  async listPreferences(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list admin preferences (m04)');
    return {
      preferences: (await this.service.listPreferences(s.ctx, s.actor.identityId)).map(preferenceView),
    };
  }

  // --- dashboard (bounded aggregates) -----------------------------------------------------------
  @Get('dashboard')
  async dashboard(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'admin dashboard (m04)');
    const d = await this.service.dashboard(s.ctx);
    return {
      operationsByStatus: d.operationsByStatus,
      recentOperations: d.recentOperations.map(operationView),
    };
  }
}
