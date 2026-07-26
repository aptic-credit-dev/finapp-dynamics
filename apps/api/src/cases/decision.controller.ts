import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CaseDecisionService, M13_AUDIT_CODES, M13_PERMISSIONS } from '@finapp/m13-case';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { decisionView, settlementView, caseView, relationshipView } from './views.ts';

/**
 * Case decisions, settlements, the recovery/legal boundary, escalation, deterministic SLA, relationships and
 * analytics, under `/api/v1/cases`. Decisions + settlements are maker-checker (submitter ≠ approver). Confidential
 * settlement terms are redacted by the view. Escalation reuses m08 (event); recovery/settlement store finance
 * references only. Permission enforced in CaseDecisionService (default deny).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optNum<K extends string>(v: unknown, k: K): Partial<Record<K, number>> {
  return typeof v === 'number' ? ({ [k]: v } as Record<K, number>) : {};
}

@Controller('cases')
export class CaseDecisionController {
  private readonly service: CaseDecisionService;
  private readonly actors: ActorContextFactory;
  constructor(service: CaseDecisionService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- decisions --------------------------------------------------------------------------------
  @Endpoint({
    permission: M13_PERMISSIONS.decisionSubmit,
    auditCode: M13_AUDIT_CODES.decisionSubmitted,
    description: 'Submit a decision.',
  })
  @Post(':id/decisions')
  async submitDecision(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'submit decision (m13)');
    return decisionView(
      await this.service.submitDecision(s.ctx, s.actor.identityId, id, {
        decisionType: requireString(b['decisionType'], 'decisionType', s.correlationId),
        ...optStr(b['summary'], 'summary'),
        ...optStr(b['reasons'], 'reasons'),
        ...optStr(b['conditions'], 'conditions'),
        ...optStr(b['remedyType'], 'remedyType'),
        ...optStr(b['remedyDetail'], 'remedyDetail'),
        ...optStr(b['financeReference'], 'financeReference'),
        reviewAvailable: b['reviewAvailable'] === true,
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M13_PERMISSIONS.decisionApprove,
    auditCode: M13_AUDIT_CODES.decisionApproved,
    description: 'Approve a decision (not the submitter).',
  })
  @Post('decisions/:did/approve')
  async approveDecision(@Param('did') did: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'approve decision (m13)');
    return decisionView(await this.service.approveDecision(s.ctx, s.actor.identityId, did), true);
  }
  @Get(':id/decisions')
  async listDecisions(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list decisions (m13)');
    const { decisions, canReadConfidential } = await this.service.listDecisions(s.ctx, id);
    return { decisions: decisions.map((d) => decisionView(d, canReadConfidential)) };
  }

  // --- settlement -------------------------------------------------------------------------------
  @Endpoint({
    permission: M13_PERMISSIONS.settlementManage,
    auditCode: M13_AUDIT_CODES.settlementProposed,
    description: 'Propose a settlement.',
  })
  @Post(':id/settlements')
  async proposeSettlement(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'propose settlement (m13)');
    return settlementView(
      await this.service.proposeSettlement(s.ctx, s.actor.identityId, id, {
        ...optStr(b['settlementType'], 'settlementType'),
        ...optStr(b['proposedTerms'], 'proposedTerms'),
        ...optStr(b['confidentialTerms'], 'confidentialTerms'),
        ...optNum(b['amountMinor'], 'amountMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optStr(b['nonMonetaryTerms'], 'nonMonetaryTerms'),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M13_PERMISSIONS.settlementApprove,
    auditCode: M13_AUDIT_CODES.settlementApproved,
    description: 'Approve a settlement (not the proposer).',
  })
  @Post('settlements/:sid/approve')
  async approveSettlement(@Param('sid') sid: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'approve settlement (m13)');
    return settlementView(await this.service.approveSettlement(s.ctx, s.actor.identityId, sid), true);
  }
  @Get(':id/settlements')
  async listSettlements(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list settlements (m13)');
    const { settlements, canReadConfidential } = await this.service.listSettlements(s.ctx, id);
    return { settlements: settlements.map((x) => settlementView(x, canReadConfidential)) };
  }

  // --- recovery + legal -------------------------------------------------------------------------
  @Endpoint({
    permission: M13_PERMISSIONS.recoveryManage,
    auditCode: M13_AUDIT_CODES.recoveryUpdated,
    description: 'Update recovery tracking (finance references only).',
  })
  @Post(':id/recovery')
  async updateRecovery(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update recovery (m13)');
    return caseView(
      await this.service.updateRecovery(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['recoveryState'], 'recoveryState'),
        ...optNum(b['claimedMinor'], 'claimedMinor'),
        ...optNum(b['recoveredMinor'], 'recoveredMinor'),
        ...optStr(b['currency'], 'currency'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M13_PERMISSIONS.legalManage,
    auditCode: M13_AUDIT_CODES.legalUpdated,
    description: 'Update legal-matter detail.',
  })
  @Post(':id/legal')
  async updateLegal(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update legal (m13)');
    return caseView(
      await this.service.updateLegal(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['legalStatus'], 'legalStatus'),
        ...optStr(b['courtReference'], 'courtReference'),
      }),
      true,
    );
  }

  // --- escalation + SLA -------------------------------------------------------------------------
  @Endpoint({
    permission: M13_PERMISSIONS.caseUpdate,
    auditCode: M13_AUDIT_CODES.escalationTriggered,
    description: 'Trigger escalation (reuses m08).',
  })
  @Post(':id/escalate')
  async escalate(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'escalate case (m13)');
    const ref = await this.service.triggerEscalation(s.ctx, s.actor.identityId, id, {
      reason: requireString(b['reason'], 'reason', s.correlationId),
    });
    return { escalationRef: ref };
  }
  @Endpoint({
    permission: M13_PERMISSIONS.deadlineManage,
    auditCode: M13_AUDIT_CODES.slaStarted,
    description: 'Start SLA tracking (materializes stage deadlines).',
  })
  @Post(':id/sla/start')
  async startSla(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'start sla (m13)');
    const rows = await this.service.startSla(
      s.ctx,
      s.actor.identityId,
      id,
      requireString(b['policyCode'], 'policyCode', s.correlationId),
    );
    return { deadlines: rows.length };
  }

  // --- relationships ----------------------------------------------------------------------------
  @Endpoint({
    permission: M13_PERMISSIONS.relationshipManage,
    auditCode: M13_AUDIT_CODES.relationshipCreated,
    description: 'Link two cases.',
  })
  @Post('relationships')
  async link(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'link cases (m13)');
    return relationshipView(
      await this.service.link(s.ctx, s.actor.identityId, {
        fromCaseId: requireString(b['fromCaseId'], 'fromCaseId', s.correlationId),
        toCaseId: requireString(b['toCaseId'], 'toCaseId', s.correlationId),
        kind: requireString(b['kind'], 'kind', s.correlationId),
      }),
    );
  }
  @Get(':id/relationships')
  async listRelationships(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list relationships (m13)');
    return { relationships: (await this.service.listRelationships(s.ctx, id)).map(relationshipView) };
  }

  // --- analytics --------------------------------------------------------------------------------
  @Get('analytics/summary')
  async analytics(@Headers() h: Record<string, string>, @Query('dimension') dimension?: string) {
    const s = await this.scoped(h, 'case analytics (m13)');
    const dims = [
      'case_type',
      'source',
      'branch',
      'department',
      'severity',
      'priority',
      'status',
      'confidentiality',
      'legal_status',
      'recovery_state',
      'risk',
    ];
    const dim = typeof dimension === 'string' && dims.includes(dimension) ? dimension : 'status';
    return { dimension: dim, buckets: await this.service.analytics(s.ctx, dim) };
  }
}
