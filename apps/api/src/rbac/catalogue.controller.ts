import { Controller, Get, Headers } from '@nestjs/common';
import { CatalogueService } from '@finapp/m02-rbac';
import { ActorContextFactory } from '@finapp/m02-identity';
import { permissionView } from './views.ts';

/**
 * The governed permission catalogue, under `/api/v1/rbac` (D2).
 *
 * Read-only, and PLATFORM-SCOPED: knowing which permissions exist is control-plane information, gated by
 * `rbac.permission.view` rather than tenant membership. The set is global reference data (the permissions
 * table has no RLS), so there is no per-tenant view to leak. Enforcement is in the service.
 */
@Controller('rbac')
export class CatalogueController {
  private readonly service: CatalogueService;
  private readonly actors: ActorContextFactory;

  constructor(service: CatalogueService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Get('permissions')
  async list(@Headers() headers: Record<string, string>) {
    const scoped = await this.actors.forPlatformRequest(headers, 'list permission catalogue (m02-rbac)');
    const rows = await this.service.listPermissions(scoped.ctx);
    return rows.map(permissionView);
  }
}
