import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { ReleaseService, M37_PERMISSIONS, M37_AUDIT_CODES } from '@finapp/m37-govrelease';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { releaseView, gateView, evidenceView } from './views.ts';

/**
 * Governed RELEASES + QA GATES + EVIDENCE under `/api/v1/releases`. Requesting a release, adding gates, recording checks,
 * validating and requesting review are authoring actions; RELEASE APPROVAL (a controlled maker-checker promotion to released
 * over a passing QA gate) and ROLLBACK are privileged and audited. AI never approves or releases. Reads carry no `@Endpoint`.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optBool<K extends string>(v: unknown, k: K): Partial<Record<K, boolean>> {
  return typeof v === 'boolean' ? ({ [k]: v } as Record<K, boolean>) : {};
}
function reqNum(v: unknown, name: string, cid: string): number {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  throw new Error(`${name} is required (correlation ${cid})`);
}

@Controller('releases')
export class GovreleaseReleasesController {
  private readonly releases: ReleaseService;
  private readonly actors: ActorContextFactory;
  constructor(releases: ReleaseService, actors: ActorContextFactory) {
    this.releases = releases;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M37_PERMISSIONS.releaseAuthor,
    auditCode: M37_AUDIT_CODES.releaseRequested,
    description: 'Request a release of an artifact to an environment (artifact must be releasable upstream).',
  })
  @Post()
  async requestRelease(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'request release (m37)');
    const r = await this.releases.requestRelease(s.ctx, s.actor.identityId, {
      artifactId: requireString(b['artifactId'], 'artifactId', s.correlationId),
      environmentId: requireString(b['environmentId'], 'environmentId', s.correlationId),
      releaseKey: requireString(b['releaseKey'], 'releaseKey', s.correlationId),
      toVersion: reqNum(b['toVersion'], 'toVersion', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return releaseView(r);
  }

  @Get()
  async listReleases(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse releases (m37)');
    const rows = await this.releases.listReleases(s.ctx, {});
    return { releases: rows.map(releaseView) };
  }

  @Endpoint({
    permission: M37_PERMISSIONS.releaseAuthor,
    auditCode: M37_AUDIT_CODES.gateAdded,
    description: 'Add a required QA gate to a release.',
  })
  @Post(':id/gates')
  async addGate(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add release gate (m37)');
    const g = await this.releases.addGate(s.ctx, s.actor.identityId, id, {
      gateKey: requireString(b['gateKey'], 'gateKey', s.correlationId),
      ...optStr(b['kind'], 'kind'),
      ...optBool(b['required'], 'required'),
    });
    return gateView(g);
  }

  @Endpoint({
    permission: M37_PERMISSIONS.gateManage,
    auditCode: M37_AUDIT_CODES.checkRecorded,
    description: 'Record an append-only QA check result for a gate.',
  })
  @Post('gates/:id/checks')
  async recordCheck(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record QA check (m37)');
    const g = await this.releases.recordCheck(s.ctx, s.actor.identityId, id, {
      status: requireString(b['status'], 'status', s.correlationId),
      ...optStr(b['checkKind'], 'checkKind'),
      ...optStr(b['evidenceRef'], 'evidenceRef'),
    });
    return gateView(g);
  }

  @Endpoint({
    permission: M37_PERMISSIONS.releaseAuthor,
    auditCode: M37_AUDIT_CODES.qaPassed,
    description: 'Validate a release (the QA evidence gate: every required gate passed).',
  })
  @Post(':id/validate')
  async validateRelease(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'validate release QA (m37)');
    const out = await this.releases.validateReleaseQa(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return { passed: out.passed, reasonCode: out.reasonCode };
  }

  @Endpoint({
    permission: M37_PERMISSIONS.releaseAuthor,
    auditCode: M37_AUDIT_CODES.reviewRequested,
    description: 'Send a QA-passed release for review.',
  })
  @Post(':id/review')
  async reviewRelease(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'request release review (m37)');
    const r = await this.releases.requestReview(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return releaseView(r);
  }

  @Endpoint({
    permission: M37_PERMISSIONS.releaseApprove,
    auditCode: M37_AUDIT_CODES.releaseApproved,
    description: 'Approve + promote a release to released (maker-checker; approver != requester, human).',
  })
  @Post(':id/approve')
  async approveRelease(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'approve release (m37)');
    const r = await this.releases.approveRelease(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return releaseView(r);
  }

  @Endpoint({
    permission: M37_PERMISSIONS.releaseExecute,
    auditCode: M37_AUDIT_CODES.releaseRolledBack,
    description: 'Roll back a released record.',
  })
  @Post(':id/rollback')
  async rollbackRelease(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'rollback release (m37)');
    const r = await this.releases.rollbackRelease(s.ctx, s.actor.identityId, id);
    return releaseView(r);
  }

  @Endpoint({
    permission: M37_PERMISSIONS.releaseAuthor,
    auditCode: M37_AUDIT_CODES.evidenceAdded,
    description: 'Attach release evidence (opaque report ref + optional opaque secretref signature).',
  })
  @Post(':id/evidence')
  async addEvidence(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add release evidence (m37)');
    const e = await this.releases.addEvidence(s.ctx, s.actor.identityId, id, {
      evidenceKind: requireString(b['evidenceKind'], 'evidenceKind', s.correlationId),
      ...optStr(b['evidenceRef'], 'evidenceRef'),
      ...optStr(b['signatureRef'], 'signatureRef'),
    });
    return evidenceView(e);
  }
}
