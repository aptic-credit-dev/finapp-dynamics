import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { GovernanceService, M41_PERMISSIONS, M41_AUDIT_CODES } from '@finapp/m41-security';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope } from '../identity/http.ts';
import { grcControlView, grcControlListView, grcAssessmentView } from './views.ts';

/**
 * GRC controls + assessments under `/api/v1/grc`. Controls + assessments are governed evidence — they do NOT duplicate m03
 * audit or m42 certification (m42 may consume this evidence by contract). Reads carry no `@Endpoint`.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('grc')
export class GrcController {
  private readonly governance: GovernanceService;
  private readonly actors: ActorContextFactory;
  constructor(governance: GovernanceService, actors: ActorContextFactory) {
    this.governance = governance;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M41_PERMISSIONS.grcControlManage,
    auditCode: M41_AUDIT_CODES.grcControlDefined,
    description: 'Define a GRC control.',
  })
  @Post('controls')
  async defineControl(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'define control (m41)');
    const c = await this.governance.defineControl(s.ctx, {
      controlKey: requireString(b['controlKey'], 'controlKey', s.correlationId),
      framework: requireString(b['framework'], 'framework', s.correlationId),
      title: requireString(b['title'], 'title', s.correlationId),
      ...optStr(b['scope'], 'scope'),
    });
    return grcControlView(c);
  }

  @Endpoint({
    permission: M41_PERMISSIONS.grcAssessmentRecord,
    auditCode: M41_AUDIT_CODES.grcAssessmentRecorded,
    description: 'Record a control assessment (append-only evidence).',
  })
  @Post('controls/:id/assessments')
  async recordAssessment(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record assessment (m41)');
    return this.governance.recordAssessment(s.ctx, id, {
      status: requireString(b['status'], 'status', s.correlationId),
      ...optStr(b['evidenceRef'], 'evidenceRef'),
      ...optStr(b['reasonCode'], 'reasonCode'),
    });
  }

  // Read surface (permission grc.control.read, RLS-scoped, no @Endpoint — reads are not audited). Mirrors the
  // GET /security/secrets pattern; exposes the canonical GRC control register + append-only assessment evidence.
  @Get('controls')
  async listControls(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list controls (m41)');
    return { controls: (await this.governance.listControls(s.ctx)).map(grcControlListView) };
  }

  @Get('controls/:id/assessments')
  async listAssessments(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list assessments (m41)');
    return { assessments: (await this.governance.listAssessments(s.ctx, id)).map(grcAssessmentView) };
  }
}
