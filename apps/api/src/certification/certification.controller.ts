import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { ProgrammeService, M42_PERMISSIONS, M42_AUDIT_CODES } from '@finapp/m42-certification';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireVersion, requireTenantScope } from '../identity/http.ts';
import {
  programmeView,
  assessmentView,
  findingView,
  readinessView,
  signoffView,
  closureView,
} from './views.ts';

/**
 * `/api/v1/platform-certification` (m42) — certification PROGRAMMES + evidence intake (assessments, findings, readiness,
 * evidence, sign-offs). M42 RECORDS governance state + EVIDENCE; it EXECUTES no migration/UAT/pilot/release. A sign-off requires
 * a human signer who did not assess that domain (independence, ADR-012). Reads carry no `@Endpoint` (read permission in-service).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optBool<K extends string>(v: unknown, k: K): Partial<Record<K, boolean>> {
  return typeof v === 'boolean' ? ({ [k]: v } as Record<K, boolean>) : {};
}

@Controller('platform-certification')
export class CertificationController {
  private readonly programmes: ProgrammeService;
  private readonly actors: ActorContextFactory;
  constructor(programmes: ProgrammeService, actors: ActorContextFactory) {
    this.programmes = programmes;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M42_PERMISSIONS.programmeManage,
    auditCode: M42_AUDIT_CODES.programmeOpened,
    description: 'Open a certification programme.',
  })
  @Post('programmes')
  async openProgramme(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'open programme (m42)');
    const p = await this.programmes.openProgramme(s.ctx, {
      programmeKey: requireString(b['programmeKey'], 'programmeKey', s.correlationId),
      stageKey: requireString(b['stageKey'], 'stageKey', s.correlationId),
      title: requireString(b['title'], 'title', s.correlationId),
      ...optStr(b['scope'], 'scope'),
    });
    return programmeView(p);
  }

  @Get('programmes')
  async list(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list programmes (m42)');
    return (await this.programmes.listProgrammes(s.ctx)).map(programmeView);
  }

  @Get('programmes/:id')
  async get(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get programme (m42)');
    const p = await this.programmes.getProgramme(s.ctx, id);
    return p ? programmeView(p) : null;
  }

  // Read-only evidence chain (permissions enforced in-service; no @Endpoint — reads are not audited; RLS-scoped).
  // These back the Stage-8 read-only certification console; NONE mutates state. The DERIVED decision comes only from
  // GET decision/preview (below, in the decision controller) — there is no browser path to issue/close.
  @Get('programmes/:id/assessments')
  async listAssessments(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list assessments (m42)');
    return { assessments: (await this.programmes.listAssessments(s.ctx, id)).map(assessmentView) };
  }

  @Get('programmes/:id/findings')
  async listFindings(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list findings (m42)');
    return { findings: (await this.programmes.listFindings(s.ctx, id)).map(findingView) };
  }

  @Get('programmes/:id/readiness')
  async listReadiness(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list readiness (m42)');
    return { readiness: (await this.programmes.listReadiness(s.ctx, id)).map(readinessView) };
  }

  @Get('programmes/:id/signoffs')
  async listSignoffs(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list signoffs (m42)');
    return { signoffs: (await this.programmes.listSignoffs(s.ctx, id)).map(signoffView) };
  }

  @Get('programmes/:id/closure')
  async getClosure(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get closure (m42)');
    const c = await this.programmes.getClosure(s.ctx, id);
    return { closure: c ? closureView(c) : null };
  }

  @Endpoint({
    permission: M42_PERMISSIONS.assessmentManage,
    auditCode: M42_AUDIT_CODES.assessmentRecorded,
    description: 'Record a domain x aspect assessment (opaque evidence ref).',
  })
  @Post('programmes/:id/assessments')
  async recordAssessment(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record assessment (m42)');
    const a = await this.programmes.recordAssessment(s.ctx, {
      programmeId: id,
      domainKey: requireString(b['domainKey'], 'domainKey', s.correlationId),
      aspectKey: requireString(b['aspectKey'], 'aspectKey', s.correlationId),
      status: requireString(b['status'], 'status', s.correlationId),
      ...optStr(b['evidenceRef'], 'evidenceRef'),
      ...optStr(b['reasonCode'], 'reasonCode'),
    });
    return assessmentView(a);
  }

  @Endpoint({
    permission: M42_PERMISSIONS.findingManage,
    auditCode: M42_AUDIT_CODES.findingRaised,
    description: 'Raise a certification finding.',
  })
  @Post('programmes/:id/findings')
  async raiseFinding(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'raise finding (m42)');
    const f = await this.programmes.raiseFinding(s.ctx, {
      programmeId: id,
      domainKey: requireString(b['domainKey'], 'domainKey', s.correlationId),
      severity: requireString(b['severity'], 'severity', s.correlationId),
      title: requireString(b['title'], 'title', s.correlationId),
      ...optStr(b['aspectKey'], 'aspectKey'),
      ...optStr(b['evidenceRef'], 'evidenceRef'),
      ...optStr(b['ownerRef'], 'ownerRef'),
      ...optStr(b['reasonCode'], 'reasonCode'),
    });
    return findingView(f);
  }

  @Endpoint({
    permission: M42_PERMISSIONS.findingManage,
    auditCode: M42_AUDIT_CODES.findingResolved,
    description: 'Resolve a finding.',
  })
  @Post('findings/:id/resolve')
  async resolveFinding(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'resolve finding (m42)');
    return findingView(
      await this.programmes.resolveFinding(s.ctx, id, requireVersion(b['version'], s.correlationId)),
    );
  }

  @Endpoint({
    permission: M42_PERMISSIONS.assessmentManage,
    auditCode: M42_AUDIT_CODES.migrationRecorded,
    description: 'Record migration/UAT/pilot/release readiness evidence (records, executes nothing).',
  })
  @Post('programmes/:id/readiness')
  async recordReadiness(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record readiness (m42)');
    const r = await this.programmes.recordReadiness(s.ctx, {
      programmeId: id,
      kind: requireString(b['kind'], 'kind', s.correlationId),
      refKey: requireString(b['refKey'], 'refKey', s.correlationId),
      result: requireString(b['result'], 'result', s.correlationId),
      ...optStr(b['planRef'], 'planRef'),
      ...optStr(b['evidenceRef'], 'evidenceRef'),
      ...optStr(b['rollbackRef'], 'rollbackRef'),
      ...optBool(b['signedOff'], 'signedOff'),
      ...optStr(b['reasonCode'], 'reasonCode'),
    });
    return readinessView(r);
  }

  @Endpoint({
    permission: M42_PERMISSIONS.assessmentManage,
    auditCode: M42_AUDIT_CODES.evidenceAdded,
    description: 'Add an opaque evidence reference (no raw body).',
  })
  @Post('programmes/:id/evidence')
  async addEvidence(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add evidence (m42)');
    return this.programmes.addEvidence(s.ctx, {
      programmeId: id,
      subjectKind: requireString(b['subjectKind'], 'subjectKind', s.correlationId),
      evidenceKind: requireString(b['evidenceKind'], 'evidenceKind', s.correlationId),
      evidenceRef: requireString(b['evidenceRef'], 'evidenceRef', s.correlationId),
      ...optStr(b['subjectId'], 'subjectId'),
      ...optStr(b['shaRef'], 'shaRef'),
      ...optStr(b['reasonCode'], 'reasonCode'),
    });
  }

  @Endpoint({
    permission: M42_PERMISSIONS.signoffApprove,
    auditCode: M42_AUDIT_CODES.signoffRecorded,
    description: 'Record a role sign-off (independent human; no self-sign of own domain).',
  })
  @Post('programmes/:id/signoffs')
  async recordSignoff(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record signoff (m42)');
    return this.programmes.recordSignoff(s.ctx, s.actor.identityId, {
      programmeId: id,
      roleKey: requireString(b['roleKey'], 'roleKey', s.correlationId),
      ...optStr(b['domainKey'], 'domainKey'),
      ...optStr(b['disposition'], 'disposition'),
      ...optStr(b['reasonCode'], 'reasonCode'),
    });
  }
}
