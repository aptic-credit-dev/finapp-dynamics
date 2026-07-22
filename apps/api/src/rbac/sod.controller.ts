import { Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { SodService, RBAC_AUDIT_CODES, RBAC_PERMISSIONS } from '@finapp/m02-rbac';
import { ActorContextFactory, requireUuidParam } from '@finapp/m02-identity';
import { requireString, requireVersion } from '../identity/http.ts';
import { sodRuleView } from './views.ts';

/**
 * Segregation-of-Duties rules, under `/api/v1/rbac` (D2). ADR-019.
 *
 * PLATFORM-SCOPED: SoD administration is control-plane work, gated by the privileged `rbac.sod.*`
 * permissions rather than by tenant membership, so the actor is proven exactly as strictly as anywhere but
 * needs no tenant context. A rule's target tenant is stated explicitly in the request. The global mandatory
 * rules (tenant_id NULL) are seeded by migration and are not editable through this surface — the API creates
 * and retires tenant-scoped rules only. Enforcement of the conflict itself happens at GRANT time in the
 * assignment service; this endpoint only manages the rule set.
 */

interface CreateSodBody {
  tenantId?: unknown;
  ruleType?: unknown;
  codeA?: unknown;
  codeB?: unknown;
  description?: unknown;
  severity?: unknown;
}

interface SetStatusBody {
  status?: unknown;
  expectedVersion?: unknown;
}

@Controller('rbac')
export class SodController {
  private readonly service: SodService;
  private readonly actors: ActorContextFactory;

  constructor(service: SodService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Get('sod-rules')
  async list(@Headers() headers: Record<string, string>) {
    const scoped = await this.actors.forPlatformRequest(headers, 'list sod rules (m02-rbac)');
    const rows = await this.service.list(scoped.ctx);
    return rows.map(sodRuleView);
  }

  @Endpoint({
    permission: RBAC_PERMISSIONS.sodManage,
    auditCode: RBAC_AUDIT_CODES.sodRuleCreated,
    description: 'Create a tenant-scoped segregation-of-duties rule.',
  })
  @Post('sod-rules')
  async create(@Body() body: CreateSodBody, @Headers() headers: Record<string, string>) {
    const scoped = await this.actors.forPlatformRequest(headers, 'create sod rule (m02-rbac)');
    const cid = scoped.correlationId;
    const row = await this.service.create(scoped.ctx, {
      tenantId: requireUuidParam(requireString(body.tenantId, 'tenantId', cid), 'tenantId', cid),
      ruleType: requireString(body.ruleType, 'ruleType', cid),
      codeA: requireString(body.codeA, 'codeA', cid),
      codeB: requireString(body.codeB, 'codeB', cid),
      description: typeof body.description === 'string' ? body.description : null,
      severity: typeof body.severity === 'string' ? body.severity : 'high',
      actor: scoped.actor.identityId,
    });
    return sodRuleView(row);
  }

  @Endpoint({
    permission: RBAC_PERMISSIONS.sodManage,
    auditCode: RBAC_AUDIT_CODES.sodRuleUpdated,
    description: 'Activate or retire a segregation-of-duties rule. Requires expectedVersion.',
  })
  @Patch('sod-rules/:ruleId')
  async setStatus(
    @Param('ruleId') ruleId: string,
    @Body() body: SetStatusBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = await this.actors.forPlatformRequest(headers, 'update sod rule (m02-rbac)');
    const cid = scoped.correlationId;
    const row = await this.service.setStatus(scoped.ctx, {
      id: requireUuidParam(ruleId, 'ruleId', cid),
      expectedVersion: requireVersion(body.expectedVersion, cid),
      status: requireString(body.status, 'status', cid),
      actor: scoped.actor.identityId,
    });
    return sodRuleView(row);
  }
}
