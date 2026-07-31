import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CertificationService, M20_AUDIT_CODES, M20_PERMISSIONS } from '@finapp/m20-glrecon';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { certificationView, certificationHistoryView } from './views.ts';

/**
 * Balance certification, under `/api/v1/gl-reconciliation`. A balance with open blocking exceptions/items may ONLY be
 * certified through a PRIVILEGED override (gl_reconciliation.certification.override) carrying a reason (fail closed).
 * Permission enforced in-service (default deny); read routes carry no `@Endpoint`. m20 certifies a reconciliation; it
 * never posts a journal or writes to the GL. Balances are INTEGER MINOR UNITS carried as STRINGS out (ADR-007).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('gl-reconciliation')
export class GlreconCertificationController {
  private readonly service: CertificationService;
  private readonly actors: ActorContextFactory;
  constructor(service: CertificationService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M20_PERMISSIONS.certificationCreate,
    auditCode: M20_AUDIT_CODES.certificationCreated,
    description: 'Draft a balance certification for a run.',
  })
  @Post('certifications')
  async create(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create certification (m20)');
    return certificationView(
      await this.service.createCertification(
        s.ctx,
        s.actor.identityId,
        requireString(b['runId'], 'runId', s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.certificationCreate,
    auditCode: M20_AUDIT_CODES.certificationCreated,
    description: 'Certify a balance (override with reason required if blockers are open).',
  })
  @Post('certifications/:id/certify')
  async certify(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'certify balance (m20)');
    return certificationView(
      await this.service.certifyBalance(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        {
          override: b['override'] === true,
          ...optStr(b['overrideReason'], 'overrideReason'),
        },
      ),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.certificationCreate,
    auditCode: M20_AUDIT_CODES.certificationRejected,
    description: 'Reject a draft certification.',
  })
  @Post('certifications/:id/reject')
  async reject(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reject certification (m20)');
    return certificationView(
      await this.service.rejectCertification(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        requireString(b['reason'], 'reason', s.correlationId),
      ),
    );
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('runs/:id/certifications')
  async listByRun(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list certifications (m20)');
    return { certifications: (await this.service.listCertifications(s.ctx, id)).map(certificationView) };
  }
  @Get('certifications/:id')
  async get(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get certification (m20)');
    return certificationView(await this.service.getCertification(s.ctx, id));
  }
  @Get('certifications/:id/history')
  async history(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'certification history (m20)');
    return {
      history: (await this.service.listCertificationHistory(s.ctx, id)).map(certificationHistoryView),
    };
  }
}
