import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { MatterLegalService, M14_AUDIT_CODES, M14_PERMISSIONS } from '@finapp/m14-legal';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import {
  positionView,
  opinionView,
  counselView,
  counselReportView,
  costView,
  settlementView,
  outcomeView,
  matterView,
  relationshipView,
} from './views.ts';

/**
 * Legal analysis + outcome — positions, opinions, external counsel + reports, cost/exposure references,
 * settlement (maker-checker), judgment/outcome, appeal/enforcement references, escalation, SLA, relationships and
 * analytics, under `/api/v1/legal`. Legal positions are gated behind `legal.position.read`; settlements are
 * maker-checker; confidential terms are redacted. Permission enforced in MatterLegalService (default deny).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optNum<K extends string>(v: unknown, k: K): Partial<Record<K, number>> {
  return typeof v === 'number' ? ({ [k]: v } as Record<K, number>) : {};
}

@Controller('legal')
export class LegalAnalysisController {
  private readonly service: MatterLegalService;
  private readonly actors: ActorContextFactory;
  constructor(service: MatterLegalService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- positions (privileged) -------------------------------------------------------------------
  @Endpoint({
    permission: M14_PERMISSIONS.positionManage,
    auditCode: M14_AUDIT_CODES.positionRecorded,
    description: 'Record a legal position/strategy.',
  })
  @Post('matters/:id/positions')
  async recordPosition(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record position (m14)');
    return positionView(
      await this.service.recordPosition(s.ctx, s.actor.identityId, id, {
        ...optStr(b['position'], 'position'),
        ...optStr(b['strategy'], 'strategy'),
        ...optStr(b['strengths'], 'strengths'),
        ...optStr(b['weaknesses'], 'weaknesses'),
        ...optStr(b['exposureSummary'], 'exposureSummary'),
        ...optStr(b['recommendedApproach'], 'recommendedApproach'),
        ...optStr(b['settlementPosture'], 'settlementPosture'),
        ...optStr(b['limitationRisks'], 'limitationRisks'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Get('matters/:id/positions')
  async listPositions(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list positions (m14)');
    const { positions } = await this.service.listPositions(s.ctx, id);
    return { positions: positions.map(positionView) };
  }

  // --- opinions ---------------------------------------------------------------------------------
  @Endpoint({
    permission: M14_PERMISSIONS.opinionManage,
    auditCode: M14_AUDIT_CODES.opinionRegistered,
    description: 'Register a legal opinion.',
  })
  @Post('matters/:id/opinions')
  async registerOpinion(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'register opinion (m14)');
    return opinionView(
      await this.service.registerOpinion(s.ctx, s.actor.identityId, id, {
        ...optStr(b['opinionType'], 'opinionType'),
        ...optStr(b['questionPresented'], 'questionPresented'),
        ...optStr(b['summaryConclusion'], 'summaryConclusion'),
        ...optStr(b['riskRating'], 'riskRating'),
        ...optStr(b['recommendation'], 'recommendation'),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
      true,
    );
  }
  @Get('matters/:id/opinions')
  async listOpinions(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list opinions (m14)');
    const { opinions, canReadConfidential } = await this.service.listOpinions(s.ctx, id);
    return { opinions: opinions.map((o) => opinionView(o, canReadConfidential)) };
  }

  // --- external counsel + reports ---------------------------------------------------------------
  @Endpoint({
    permission: M14_PERMISSIONS.externalCounselManage,
    auditCode: M14_AUDIT_CODES.counselInstructed,
    description: 'Instruct external counsel.',
  })
  @Post('matters/:id/counsel')
  async instructCounsel(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'instruct counsel (m14)');
    return counselView(
      await this.service.instructCounsel(s.ctx, s.actor.identityId, id, {
        ...optStr(b['lawFirmRef'], 'lawFirmRef'),
        ...optStr(b['advocateRef'], 'advocateRef'),
        ...optStr(b['instructionScope'], 'instructionScope'),
        ...optStr(b['engagementReference'], 'engagementReference'),
        ...optStr(b['reportingFrequency'], 'reportingFrequency'),
      }),
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.externalCounselManage,
    auditCode: M14_AUDIT_CODES.counselInstructed,
    description: 'Update external counsel.',
  })
  @Post('counsel/:cid')
  async updateCounsel(
    @Param('cid') cid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update counsel (m14)');
    return counselView(
      await this.service.updateCounsel(s.ctx, s.actor.identityId, cid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['status'], 'status'),
        ...optStr(b['lastUpdateSummary'], 'lastUpdateSummary'),
        ...optStr(b['nextReportDue'], 'nextReportDue'),
      }),
    );
  }
  @Get('matters/:id/counsel')
  async listCounsel(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list counsel (m14)');
    return { counsel: (await this.service.listCounsel(s.ctx, id)).map(counselView) };
  }
  @Endpoint({
    permission: M14_PERMISSIONS.counselReportManage,
    auditCode: M14_AUDIT_CODES.counselReportReceived,
    description: 'Record a counsel report.',
  })
  @Post('matters/:id/counsel-reports')
  async addCounselReport(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add counsel report (m14)');
    return counselReportView(
      await this.service.addCounselReport(s.ctx, s.actor.identityId, id, {
        ...optStr(b['counselId'], 'counselId'),
        ...optStr(b['reportingPeriod'], 'reportingPeriod'),
        ...optStr(b['statusSummary'], 'statusSummary'),
        ...optStr(b['actionTaken'], 'actionTaken'),
        ...optStr(b['nextAction'], 'nextAction'),
        ...optStr(b['risks'], 'risks'),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
      true,
    );
  }
  @Get('matters/:id/counsel-reports')
  async listCounselReports(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list counsel reports (m14)');
    return {
      reports: (await this.service.listCounselReports(s.ctx, id)).map((r) => counselReportView(r, true)),
    };
  }

  // --- costs + exposure -------------------------------------------------------------------------
  @Endpoint({
    permission: M14_PERMISSIONS.costManage,
    auditCode: M14_AUDIT_CODES.costRecorded,
    description: 'Record a cost reference.',
  })
  @Post('matters/:id/costs')
  async recordCost(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record cost (m14)');
    return costView(
      await this.service.recordCost(s.ctx, s.actor.identityId, id, {
        ...optStr(b['costType'], 'costType'),
        ...optStr(b['description'], 'description'),
        ...optNum(b['amountMinor'], 'amountMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optStr(b['invoiceReference'], 'invoiceReference'),
        recoverable: b['recoverable'] === true,
      }),
    );
  }
  @Get('matters/:id/costs')
  async listCosts(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list costs (m14)');
    return { costs: (await this.service.listCosts(s.ctx, id)).map(costView) };
  }
  @Endpoint({
    permission: M14_PERMISSIONS.exposureManage,
    auditCode: M14_AUDIT_CODES.exposureUpdated,
    description: 'Update exposure (references only).',
  })
  @Post('matters/:id/exposure')
  async updateExposure(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update exposure (m14)');
    return matterView(
      await this.service.updateExposure(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optNum(b['claimAmountMinor'], 'claimAmountMinor'),
        ...optNum(b['exposureAmountMinor'], 'exposureAmountMinor'),
        ...optStr(b['currency'], 'currency'),
      }),
      true,
    );
  }

  // --- settlement (maker-checker) ---------------------------------------------------------------
  @Endpoint({
    permission: M14_PERMISSIONS.settlementSubmit,
    auditCode: M14_AUDIT_CODES.settlementProposed,
    description: 'Propose a settlement.',
  })
  @Post('matters/:id/settlements')
  async proposeSettlement(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'propose settlement (m14)');
    return settlementView(
      await this.service.proposeSettlement(s.ctx, s.actor.identityId, id, {
        ...optStr(b['proposal'], 'proposal'),
        ...optStr(b['monetaryTerms'], 'monetaryTerms'),
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
    permission: M14_PERMISSIONS.settlementApprove,
    auditCode: M14_AUDIT_CODES.settlementApproved,
    description: 'Approve a settlement (not the proposer).',
  })
  @Post('settlements/:sid/approve')
  async approveSettlement(@Param('sid') sid: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'approve settlement (m14)');
    return settlementView(await this.service.approveSettlement(s.ctx, s.actor.identityId, sid), true);
  }
  @Get('matters/:id/settlements')
  async listSettlements(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list settlements (m14)');
    const { settlements, canReadConfidential } = await this.service.listSettlements(s.ctx, id);
    return { settlements: settlements.map((x) => settlementView(x, canReadConfidential)) };
  }

  // --- judgment / appeal / enforcement ----------------------------------------------------------
  @Endpoint({
    permission: M14_PERMISSIONS.judgmentManage,
    auditCode: M14_AUDIT_CODES.judgmentRecorded,
    description: 'Record a judgment/outcome.',
  })
  @Post('matters/:id/outcomes')
  async recordOutcome(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record outcome (m14)');
    return outcomeView(
      await this.service.recordOutcome(s.ctx, s.actor.identityId, id, {
        outcomeType: requireString(b['outcomeType'], 'outcomeType', s.correlationId),
        ...optStr(b['outcomeDate'], 'outcomeDate'),
        ...optStr(b['summary'], 'summary'),
        ...optNum(b['amountAwardedMinor'], 'amountAwardedMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optNum(b['costsAwardedMinor'], 'costsAwardedMinor'),
        ...optStr(b['orders'], 'orders'),
        ...optStr(b['documentRef'], 'documentRef'),
        appealable: b['appealable'] === true,
        ...optStr(b['appealDeadline'], 'appealDeadline'),
      }),
    );
  }
  @Get('matters/:id/outcomes')
  async listOutcomes(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list outcomes (m14)');
    return { outcomes: (await this.service.listOutcomes(s.ctx, id)).map(outcomeView) };
  }
  @Endpoint({
    permission: M14_PERMISSIONS.appealManage,
    auditCode: M14_AUDIT_CODES.appealInitiated,
    description: 'Update appeal.',
  })
  @Post('matters/:id/appeal')
  async updateAppeal(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update appeal (m14)');
    return matterView(
      await this.service.updateAppeal(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['appealStatus'], 'appealStatus'),
        ...optStr(b['appealForum'], 'appealForum'),
        ...optStr(b['appealDeadline'], 'appealDeadline'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.enforcementManage,
    auditCode: M14_AUDIT_CODES.enforcementUpdated,
    description: 'Update enforcement (references only).',
  })
  @Post('matters/:id/enforcement')
  async updateEnforcement(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update enforcement (m14)');
    return matterView(
      await this.service.updateEnforcement(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['enforcementStage'], 'enforcementStage'),
        ...optNum(b['recoveredMinor'], 'recoveredMinor'),
      }),
      true,
    );
  }

  // --- escalation + SLA -------------------------------------------------------------------------
  @Endpoint({
    permission: M14_PERMISSIONS.matterUpdate,
    auditCode: M14_AUDIT_CODES.escalationTriggered,
    description: 'Trigger escalation (reuses m08).',
  })
  @Post('matters/:id/escalate')
  async escalate(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'escalate matter (m14)');
    const ref = await this.service.triggerEscalation(s.ctx, s.actor.identityId, id, {
      reason: requireString(b['reason'], 'reason', s.correlationId),
    });
    return { escalationRef: ref };
  }
  @Endpoint({
    permission: M14_PERMISSIONS.deadlineManage,
    auditCode: M14_AUDIT_CODES.slaStarted,
    description: 'Start SLA (materializes deadlines).',
  })
  @Post('matters/:id/sla/start')
  async startSla(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'start sla (m14)');
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
    permission: M14_PERMISSIONS.relationshipManage,
    auditCode: M14_AUDIT_CODES.relationshipCreated,
    description: 'Link two matters.',
  })
  @Post('relationships')
  async link(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'link matters (m14)');
    return relationshipView(
      await this.service.link(s.ctx, s.actor.identityId, {
        fromMatterId: requireString(b['fromMatterId'], 'fromMatterId', s.correlationId),
        toMatterId: requireString(b['toMatterId'], 'toMatterId', s.correlationId),
        kind: requireString(b['kind'], 'kind', s.correlationId),
      }),
    );
  }
  @Get('matters/:id/relationships')
  async listRelationships(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list relationships (m14)');
    return { relationships: (await this.service.listRelationships(s.ctx, id)).map(relationshipView) };
  }

  // --- analytics --------------------------------------------------------------------------------
  @Get('analytics/summary')
  async analytics(@Headers() h: Record<string, string>, @Query('dimension') dimension?: string) {
    const s = await this.scoped(h, 'legal analytics (m14)');
    const dims = [
      'matter_type',
      'source',
      'jurisdiction',
      'forum',
      'branch',
      'department',
      'legal_risk',
      'priority',
      'status',
      'confidentiality',
      'enforcement_state',
    ];
    const dim = typeof dimension === 'string' && dims.includes(dimension) ? dimension : 'status';
    return { dimension: dim, buckets: await this.service.analytics(s.ctx, dim) };
  }
}
