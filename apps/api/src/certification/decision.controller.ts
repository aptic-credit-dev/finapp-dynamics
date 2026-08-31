import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { DecisionService, M42_PERMISSIONS, M42_AUDIT_CODES } from '@finapp/m42-certification';
import { ActorContextFactory } from '@finapp/m02-identity';
import { badRequest, requireString, requireVersion, requireTenantScope } from '../identity/http.ts';
import { waiverView } from './views.ts';

/**
 * `/api/v1/platform-certification` (m42) — the HIGH-RISK controls: waivers, the DERIVED GO/CONDITIONAL_GO/NO_GO decision, and
 * the stage closure. A verdict is DERIVED from governed evidence (never caller-set). Waiver approval / decision issuance /
 * closure are maker-checker/SoD (a human certifier != the requester; AI/system/automation refused). An issued decision + closure
 * are immutable. No endpoint executes a migration/release/deployment.
 */
function parseDate(v: unknown, field: string, correlationId: string): Date {
  const d = typeof v === 'string' ? new Date(v) : new Date(NaN);
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} must be an ISO date.`, correlationId);
  return d;
}
function parseConditions(v: unknown): {
  conditionKey: string;
  description: string;
  ownerRef?: string | null;
  dueAt?: Date | null;
  evidenceRef?: string | null;
}[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({
      conditionKey: typeof c['conditionKey'] === 'string' ? c['conditionKey'] : '',
      description: typeof c['description'] === 'string' ? c['description'] : '',
      ownerRef: typeof c['ownerRef'] === 'string' ? c['ownerRef'] : null,
      dueAt: typeof c['dueAt'] === 'string' ? new Date(c['dueAt']) : null,
      evidenceRef: typeof c['evidenceRef'] === 'string' ? c['evidenceRef'] : null,
    }))
    .filter((c) => c.conditionKey !== '' && c.description !== '');
}

@Controller('platform-certification')
export class CertificationDecisionController {
  private readonly decisions: DecisionService;
  private readonly actors: ActorContextFactory;
  constructor(decisions: DecisionService, actors: ActorContextFactory) {
    this.decisions = decisions;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M42_PERMISSIONS.waiverRequest,
    auditCode: M42_AUDIT_CODES.waiverRequested,
    description: 'Request a waiver against a finding.',
  })
  @Post('programmes/:id/waivers')
  async requestWaiver(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'request waiver (m42)');
    const w = await this.decisions.requestWaiver(s.ctx, {
      programmeId: id,
      findingId: requireString(b['findingId'], 'findingId', s.correlationId),
      scope: requireString(b['scope'], 'scope', s.correlationId),
      reason: requireString(b['reason'], 'reason', s.correlationId),
      ...(typeof b['isAbsolute'] === 'boolean' ? { isAbsolute: b['isAbsolute'] } : {}),
    });
    return waiverView(w);
  }

  @Endpoint({
    permission: M42_PERMISSIONS.waiverApprove,
    auditCode: M42_AUDIT_CODES.waiverApproved,
    description: 'Approve/reject a waiver (maker-checker; absolute controls never waivable).',
  })
  @Post('waivers/:id/approve')
  async approveWaiver(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'approve waiver (m42)');
    const approve = b['approve'] !== false;
    const w = await this.decisions.approveWaiver(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['version'], s.correlationId),
      {
        validTo: parseDate(b['validTo'], 'validTo', s.correlationId),
        approve,
      },
    );
    return waiverView(w);
  }

  // Read-only list of a programme's waivers (any state) — permission enforced in-service; RLS-scoped; no mutation.
  @Get('programmes/:id/waivers')
  async listWaivers(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list waivers (m42)');
    return { waivers: (await this.decisions.listWaivers(s.ctx, id)).map(waiverView) };
  }

  // Read-only DERIVED verdict + blockers (server-derived by evaluateCertificationDecision; NEVER caller-set). This is
  // a preview, not a decision: no state change, no audit, no GO issuance. The mutating decision/closure remain
  // evidence/API-driven and are deliberately NOT surfaced to the browser (deny-by-default preserved).
  @Get('programmes/:id/decision/preview')
  async preview(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'preview decision (m42)');
    return this.decisions.previewDecision(s.ctx, id);
  }

  @Endpoint({
    permission: M42_PERMISSIONS.decisionIssue,
    auditCode: M42_AUDIT_CODES.decisionIssued,
    description:
      'Issue the DERIVED GO/CONDITIONAL_GO/NO_GO decision (maker-checker; verdict is derived, never set).',
  })
  @Post('programmes/:id/decision')
  async issueDecision(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'issue decision (m42)');
    return this.decisions.issueDecision(s.ctx, s.actor.identityId, {
      programmeId: id,
      requestedBy: requireString(b['requestedBy'], 'requestedBy', s.correlationId),
      idempotencyKey: requireString(b['idempotencyKey'], 'idempotencyKey', s.correlationId),
      conditions: parseConditions(b['conditions']),
    });
  }

  @Endpoint({
    permission: M42_PERMISSIONS.decisionIssue,
    auditCode: M42_AUDIT_CODES.closureIssued,
    description: 'Issue the immutable Stage-6 closure artifact (maker-checker).',
  })
  @Post('programmes/:id/closure')
  async closeStage(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'close stage (m42)');
    return this.decisions.closeStage(s.ctx, s.actor.identityId, {
      programmeId: id,
      requestedBy: requireString(b['requestedBy'], 'requestedBy', s.correlationId),
      idempotencyKey: requireString(b['idempotencyKey'], 'idempotencyKey', s.correlationId),
      assessedModules: requireString(b['assessedModules'], 'assessedModules', s.correlationId),
      ...(typeof b['implCertRefs'] === 'string' ? { implCertRefs: b['implCertRefs'] } : {}),
      ...(typeof b['artifactRef'] === 'string' ? { artifactRef: b['artifactRef'] } : {}),
      ...(typeof b['findingsSummary'] === 'string' ? { findingsSummary: b['findingsSummary'] } : {}),
      ...(typeof b['signoffsSummary'] === 'string' ? { signoffsSummary: b['signoffsSummary'] } : {}),
      ...(typeof b['conditionsSummary'] === 'string' ? { conditionsSummary: b['conditionsSummary'] } : {}),
    });
  }
}
