import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  RecoveryWorkService,
  M17_AUDIT_CODES,
  M17_PERMISSIONS,
  type DeadlineRule,
} from '@finapp/m17-recovery';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import {
  instrumentView,
  demandView,
  negotiationView,
  arrangementView,
  installmentView,
  enforcementActionView,
  securityView,
  agentView,
  agentReportView,
  receiptView,
  waiverView,
  writeoffView,
  outcomeView,
  deadlineView,
  costView,
  noteView,
  relationshipView,
} from './views.ts';

/**
 * Recovery working entities — enforceable instruments, demands, negotiations, repayment arrangements
 * (maker-checker) + installment schedules (metadata only), enforcement actions, security/collateral
 * (single-winner realize), external agents + reports, receipts (references only), waivers, write-off
 * RECOMMENDATIONS (maker-checker), outcomes, deterministic deadlines/limitation, cost references, notes,
 * relationships, SLA, escalation and analytics, under `/api/v1/recovery`. Contacts, negotiation strategy,
 * settlement terms, security valuations and privileged notes are redacted/filtered by the views.
 * Permission enforced in RecoveryWorkService (default deny).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optNum<K extends string>(v: unknown, k: K): Partial<Record<K, number>> {
  return typeof v === 'number' ? ({ [k]: v } as Record<K, number>) : {};
}
function optBool<K extends string>(v: unknown, k: K): Partial<Record<K, boolean>> {
  return typeof v === 'boolean' ? ({ [k]: v } as Record<K, boolean>) : {};
}

@Controller('recovery')
export class RecoveryController {
  private readonly service: RecoveryWorkService;
  private readonly actors: ActorContextFactory;
  constructor(service: RecoveryWorkService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- instruments ------------------------------------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.instrumentManage,
    auditCode: M17_AUDIT_CODES.instrumentRegistered,
    description: 'Register an enforceable instrument.',
  })
  @Post('recoveries/:id/instruments')
  async registerInstrument(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'register instrument (m17)');
    return instrumentView(
      await this.service.registerInstrument(s.ctx, s.actor.identityId, id, {
        instrumentType: requireString(b['instrumentType'], 'instrumentType', s.correlationId),
        ...optStr(b['reference'], 'reference'),
        ...optStr(b['issuingForum'], 'issuingForum'),
        ...optStr(b['issueDate'], 'issueDate'),
        ...optStr(b['maturityDate'], 'maturityDate'),
        ...optNum(b['faceAmountMinor'], 'faceAmountMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optBool(b['enforceable'], 'enforceable'),
        ...optStr(b['enforceabilityNote'], 'enforceabilityNote'),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['sourceProceedingId'], 'sourceProceedingId'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.instrumentManage,
    auditCode: M17_AUDIT_CODES.instrumentUpdated,
    description: 'Update an instrument.',
  })
  @Post('instruments/:iid')
  async updateInstrument(
    @Param('iid') iid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update instrument (m17)');
    return instrumentView(
      await this.service.updateInstrument(s.ctx, s.actor.identityId, iid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['reference'], 'reference'),
        ...optStr(b['issuingForum'], 'issuingForum'),
        ...optBool(b['enforceable'], 'enforceable'),
        ...optStr(b['enforceabilityNote'], 'enforceabilityNote'),
        ...optStr(b['documentRef'], 'documentRef'),
      }),
    );
  }
  @Get('recoveries/:id/instruments')
  async listInstruments(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list instruments (m17)');
    return { instruments: (await this.service.listInstruments(s.ctx, id)).map(instrumentView) };
  }

  // --- demands ----------------------------------------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.demandManage,
    auditCode: M17_AUDIT_CODES.demandIssued,
    description: 'Issue a demand.',
  })
  @Post('recoveries/:id/demands')
  async issueDemand(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'issue demand (m17)');
    return demandView(
      await this.service.issueDemand(s.ctx, s.actor.identityId, id, {
        demandType: requireString(b['demandType'], 'demandType', s.correlationId),
        ...optStr(b['partyRef'], 'partyRef'),
        ...optNum(b['amountDemandedMinor'], 'amountDemandedMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optStr(b['issuedDate'], 'issuedDate'),
        ...optStr(b['responseDue'], 'responseDue'),
        ...optStr(b['deliveryMethod'], 'deliveryMethod'),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['status'], 'status'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.demandManage,
    auditCode: M17_AUDIT_CODES.demandResponded,
    description: 'Record a demand response.',
  })
  @Post('demands/:did/respond')
  async respondDemand(
    @Param('did') did: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'respond demand (m17)');
    return demandView(
      await this.service.respondDemand(s.ctx, s.actor.identityId, did, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['responseStatus'], 'responseStatus'),
        ...optStr(b['responseDate'], 'responseDate'),
        ...optStr(b['responseSummary'], 'responseSummary'),
        ...optStr(b['status'], 'status'),
      }),
    );
  }
  @Get('recoveries/:id/demands')
  async listDemands(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list demands (m17)');
    return { demands: (await this.service.listDemands(s.ctx, id)).map(demandView) };
  }

  // --- negotiations -----------------------------------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.negotiationManage,
    auditCode: M17_AUDIT_CODES.negotiationOpened,
    description: 'Open a negotiation.',
  })
  @Post('recoveries/:id/negotiations')
  async openNegotiation(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'open negotiation (m17)');
    return negotiationView(
      await this.service.openNegotiation(s.ctx, s.actor.identityId, id, {
        ...optStr(b['partyRef'], 'partyRef'),
        ...optStr(b['openedDate'], 'openedDate'),
        ...optStr(b['positionSummary'], 'positionSummary'),
        ...optNum(b['offeredAmountMinor'], 'offeredAmountMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.negotiationManage,
    auditCode: M17_AUDIT_CODES.negotiationOpened,
    description: 'Update a negotiation.',
  })
  @Post('negotiations/:nid')
  async updateNegotiation(
    @Param('nid') nid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update negotiation (m17)');
    return negotiationView(
      await this.service.updateNegotiation(s.ctx, s.actor.identityId, nid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['positionSummary'], 'positionSummary'),
        ...optStr(b['counterPosition'], 'counterPosition'),
        ...optNum(b['offeredAmountMinor'], 'offeredAmountMinor'),
        ...optStr(b['status'], 'status'),
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.negotiationManage,
    auditCode: M17_AUDIT_CODES.negotiationClosed,
    description: 'Close a negotiation.',
  })
  @Post('negotiations/:nid/close')
  async closeNegotiation(
    @Param('nid') nid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'close negotiation (m17)');
    return negotiationView(
      await this.service.closeNegotiation(s.ctx, s.actor.identityId, nid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['status'], 'status'),
        ...optStr(b['outcome'], 'outcome'),
        ...optStr(b['closedDate'], 'closedDate'),
      }),
    );
  }
  @Get('recoveries/:id/negotiations')
  async listNegotiations(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list negotiations (m17)');
    return { negotiations: (await this.service.listNegotiations(s.ctx, id)).map(negotiationView) };
  }

  // --- arrangements (maker-checker) -------------------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.arrangementManage,
    auditCode: M17_AUDIT_CODES.arrangementCreated,
    description: 'Propose a repayment arrangement.',
  })
  @Post('recoveries/:id/arrangements')
  async proposeArrangement(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'propose arrangement (m17)');
    return arrangementView(
      await this.service.proposeArrangement(s.ctx, s.actor.identityId, id, {
        arrangementType: requireString(b['arrangementType'], 'arrangementType', s.correlationId),
        ...optNum(b['totalAmountMinor'], 'totalAmountMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optNum(b['installmentCount'], 'installmentCount'),
        ...optNum(b['installmentAmountMinor'], 'installmentAmountMinor'),
        ...optStr(b['frequency'], 'frequency'),
        ...optStr(b['startDate'], 'startDate'),
        ...optStr(b['endDate'], 'endDate'),
        ...optStr(b['termsSummary'], 'termsSummary'),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.arrangementApprove,
    auditCode: M17_AUDIT_CODES.arrangementApproved,
    description: 'Approve an arrangement (not the proposer).',
  })
  @Post('arrangements/:aid/approve')
  async approveArrangement(
    @Param('aid') aid: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'approve arrangement (m17)');
    return arrangementView(
      await this.service.approveArrangement(
        s.ctx,
        s.actor.identityId,
        aid,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.arrangementManage,
    auditCode: M17_AUDIT_CODES.arrangementDefaulted,
    description: 'Mark an arrangement defaulted.',
  })
  @Post('arrangements/:aid/default')
  async defaultArrangement(
    @Param('aid') aid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'default arrangement (m17)');
    return arrangementView(
      await this.service.defaultArrangement(s.ctx, s.actor.identityId, aid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['reason'], 'reason'),
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.arrangementManage,
    auditCode: M17_AUDIT_CODES.arrangementCompleted,
    description: 'Complete an arrangement.',
  })
  @Post('arrangements/:aid/complete')
  async completeArrangement(
    @Param('aid') aid: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'complete arrangement (m17)');
    return arrangementView(
      await this.service.completeArrangement(
        s.ctx,
        s.actor.identityId,
        aid,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('recoveries/:id/arrangements')
  async listArrangements(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list arrangements (m17)');
    return { arrangements: (await this.service.listArrangements(s.ctx, id)).map(arrangementView) };
  }

  // --- installments (schedule metadata only) ----------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.installmentManage,
    auditCode: M17_AUDIT_CODES.installmentRecorded,
    description: 'Add an installment to an arrangement schedule.',
  })
  @Post('arrangements/:aid/installments')
  async addInstallment(
    @Param('aid') aid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add installment (m17)');
    return installmentView(
      await this.service.addInstallment(s.ctx, s.actor.identityId, aid, {
        recoveryId: requireString(b['recoveryId'], 'recoveryId', s.correlationId),
        sequenceNumber: typeof b['sequenceNumber'] === 'number' ? b['sequenceNumber'] : Number.NaN,
        ...optStr(b['dueDate'], 'dueDate'),
        ...optNum(b['expectedAmountMinor'], 'expectedAmountMinor'),
        ...optStr(b['currency'], 'currency'),
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.installmentManage,
    auditCode: M17_AUDIT_CODES.installmentRecorded,
    description: 'Record an installment as met/missed (no cash application).',
  })
  @Post('installments/:iid/record')
  async recordInstallment(
    @Param('iid') iid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record installment (m17)');
    const status = b['status'] === 'missed' ? 'missed' : 'met';
    return installmentView(
      await this.service.recordInstallment(s.ctx, s.actor.identityId, iid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        status,
        ...optStr(b['receiptRef'], 'receiptRef'),
        ...optStr(b['paidDate'], 'paidDate'),
        ...optStr(b['note'], 'note'),
      }),
    );
  }
  @Get('recoveries/:id/installments')
  async listInstallments(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list installments (m17)');
    return { installments: (await this.service.listInstallments(s.ctx, id)).map(installmentView) };
  }

  // --- enforcement actions ----------------------------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.enforcementManage,
    auditCode: M17_AUDIT_CODES.enforcementInitiated,
    description: 'Initiate an enforcement action.',
  })
  @Post('recoveries/:id/enforcement-actions')
  async initiateEnforcement(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'initiate enforcement (m17)');
    return enforcementActionView(
      await this.service.initiateEnforcement(s.ctx, s.actor.identityId, id, {
        actionType: requireString(b['actionType'], 'actionType', s.correlationId),
        ...optStr(b['forum'], 'forum'),
        ...optStr(b['reference'], 'reference'),
        ...optStr(b['initiatedDate'], 'initiatedDate'),
        ...optStr(b['targetAssetRef'], 'targetAssetRef'),
        ...optStr(b['targetPartyRef'], 'targetPartyRef'),
        ...optNum(b['expectedAmountMinor'], 'expectedAmountMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optStr(b['agentRef'], 'agentRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.enforcementManage,
    auditCode: M17_AUDIT_CODES.enforcementUpdated,
    description: 'Update an enforcement action.',
  })
  @Post('enforcement-actions/:eid')
  async updateEnforcement(
    @Param('eid') eid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update enforcement (m17)');
    return enforcementActionView(
      await this.service.updateEnforcement(s.ctx, s.actor.identityId, eid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['status'], 'status'),
        ...optStr(b['reference'], 'reference'),
        ...optStr(b['outcome'], 'outcome'),
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.enforcementManage,
    auditCode: M17_AUDIT_CODES.enforcementCompleted,
    description: 'Complete an enforcement action.',
  })
  @Post('enforcement-actions/:eid/complete')
  async completeEnforcement(
    @Param('eid') eid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'complete enforcement (m17)');
    return enforcementActionView(
      await this.service.completeEnforcement(s.ctx, s.actor.identityId, eid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['outcome'], 'outcome'),
      }),
    );
  }
  @Get('recoveries/:id/enforcement-actions')
  async listEnforcements(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list enforcement actions (m17)');
    return {
      enforcementActions: (await this.service.listEnforcements(s.ctx, id)).map(enforcementActionView),
    };
  }

  // --- security (single-winner realize) ---------------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.securityManage,
    auditCode: M17_AUDIT_CODES.securityRegistered,
    description: 'Register security/collateral.',
  })
  @Post('recoveries/:id/security')
  async registerSecurity(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'register security (m17)');
    return securityView(
      await this.service.registerSecurity(s.ctx, s.actor.identityId, id, {
        securityType: requireString(b['securityType'], 'securityType', s.correlationId),
        ...optStr(b['description'], 'description'),
        ...optStr(b['assetRef'], 'assetRef'),
        ...optStr(b['registrationReference'], 'registrationReference'),
        ...optStr(b['chargePriority'], 'chargePriority'),
        ...optNum(b['estimatedValueMinor'], 'estimatedValueMinor'),
        ...optNum(b['forcedSaleValueMinor'], 'forcedSaleValueMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optStr(b['valuationDate'], 'valuationDate'),
        ...optStr(b['valuationRef'], 'valuationRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.securityRealize,
    auditCode: M17_AUDIT_CODES.securityRealized,
    description: 'Record security realization (single-winner reference).',
  })
  @Post('security/:sid/realize')
  async realizeSecurity(
    @Param('sid') sid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'realize security (m17)');
    return securityView(
      await this.service.realizeSecurity(s.ctx, s.actor.identityId, sid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optNum(b['realizedAmountMinor'], 'realizedAmountMinor'),
        ...optStr(b['realizedDate'], 'realizedDate'),
      }),
    );
  }
  @Get('recoveries/:id/security')
  async listSecurities(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list security (m17)');
    return { security: (await this.service.listSecurities(s.ctx, id)).map(securityView) };
  }

  // --- external agents --------------------------------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.agentManage,
    auditCode: M17_AUDIT_CODES.agentInstructed,
    description: 'Instruct an external agent.',
  })
  @Post('recoveries/:id/agents')
  async instructAgent(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'instruct agent (m17)');
    return agentView(
      await this.service.instructAgent(s.ctx, s.actor.identityId, id, {
        ...optStr(b['agentRef'], 'agentRef'),
        ...optStr(b['agentType'], 'agentType'),
        ...optStr(b['engagementReference'], 'engagementReference'),
        ...optStr(b['instructionScope'], 'instructionScope'),
        ...optStr(b['feeArrangementReference'], 'feeArrangementReference'),
        ...optStr(b['reportingFrequency'], 'reportingFrequency'),
        ...optStr(b['nextReportDue'], 'nextReportDue'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.agentManage,
    auditCode: M17_AUDIT_CODES.agentInstructed,
    description: 'Update an external agent.',
  })
  @Post('agents/:aid')
  async updateAgent(
    @Param('aid') aid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update agent (m17)');
    return agentView(
      await this.service.updateAgent(s.ctx, s.actor.identityId, aid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['status'], 'status'),
        ...optStr(b['reportingFrequency'], 'reportingFrequency'),
        ...optStr(b['nextReportDue'], 'nextReportDue'),
        ...optStr(b['performanceNote'], 'performanceNote'),
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.agentManage,
    auditCode: M17_AUDIT_CODES.agentTerminated,
    description: 'Terminate an external agent.',
  })
  @Post('agents/:aid/terminate')
  async terminateAgent(
    @Param('aid') aid: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'terminate agent (m17)');
    return agentView(
      await this.service.terminateAgent(
        s.ctx,
        s.actor.identityId,
        aid,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('recoveries/:id/agents')
  async listAgents(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list agents (m17)');
    return { agents: (await this.service.listAgents(s.ctx, id)).map(agentView) };
  }

  // --- agent reports (append-only) --------------------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.agentReportManage,
    auditCode: M17_AUDIT_CODES.agentReportReceived,
    description: 'Record an agent report.',
  })
  @Post('recoveries/:id/agent-reports')
  async addAgentReport(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add agent report (m17)');
    return agentReportView(
      await this.service.addAgentReport(s.ctx, s.actor.identityId, id, {
        ...optStr(b['agentId'], 'agentId'),
        ...optStr(b['reportingPeriod'], 'reportingPeriod'),
        ...optStr(b['statusSummary'], 'statusSummary'),
        ...optStr(b['actionTaken'], 'actionTaken'),
        ...optStr(b['nextAction'], 'nextAction'),
        ...optNum(b['amountCollectedMinor'], 'amountCollectedMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optStr(b['reportDate'], 'reportDate'),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Get('recoveries/:id/agent-reports')
  async listAgentReports(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list agent reports (m17)');
    return { agentReports: (await this.service.listAgentReports(s.ctx, id)).map(agentReportView) };
  }

  // --- receipts (append-only, REFERENCE only) ---------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.receiptManage,
    auditCode: M17_AUDIT_CODES.receiptRecorded,
    description: 'Record a recovery receipt (reference only).',
  })
  @Post('recoveries/:id/receipts')
  async recordReceipt(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record receipt (m17)');
    return receiptView(
      await this.service.recordReceipt(s.ctx, s.actor.identityId, id, {
        receiptType: requireString(b['receiptType'], 'receiptType', s.correlationId),
        ...optStr(b['externalReference'], 'externalReference'),
        ...optNum(b['amountMinor'], 'amountMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optStr(b['receivedDate'], 'receivedDate'),
        ...optStr(b['partyRef'], 'partyRef'),
        ...optStr(b['arrangementRef'], 'arrangementRef'),
        ...optStr(b['enforcementActionRef'], 'enforcementActionRef'),
        ...optStr(b['securityRef'], 'securityRef'),
        ...optStr(b['financeReference'], 'financeReference'),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
        ...optNum(b['recoveredAmountMinor'], 'recoveredAmountMinor'),
        ...optNum(b['outstandingAmountMinor'], 'outstandingAmountMinor'),
        ...optNum(b['expectedVersion'], 'expectedVersion'),
      }),
    );
  }
  @Get('recoveries/:id/receipts')
  async listReceipts(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list receipts (m17)');
    return { receipts: (await this.service.listReceipts(s.ctx, id)).map(receiptView) };
  }

  // --- waivers (append-only) --------------------------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.waiverGrant,
    auditCode: M17_AUDIT_CODES.waiverGranted,
    description: 'Grant a waiver.',
  })
  @Post('recoveries/:id/waivers')
  async grantWaiver(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'grant waiver (m17)');
    return waiverView(
      await this.service.grantWaiver(s.ctx, s.actor.identityId, id, {
        ...optStr(b['waiverType'], 'waiverType'),
        ...optNum(b['amountMinor'], 'amountMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optStr(b['reason'], 'reason'),
        ...optStr(b['authority'], 'authority'),
        ...optStr(b['grantedDate'], 'grantedDate'),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Get('recoveries/:id/waivers')
  async listWaivers(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list waivers (m17)');
    return { waivers: (await this.service.listWaivers(s.ctx, id)).map(waiverView) };
  }

  // --- write-off recommendations (maker-checker) ------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.writeoffRecommend,
    auditCode: M17_AUDIT_CODES.writeoffRecommended,
    description: 'Recommend a write-off (recommendation only; no accounting).',
  })
  @Post('recoveries/:id/writeoffs')
  async recommendWriteOff(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'recommend write-off (m17)');
    return writeoffView(
      await this.service.recommendWriteOff(s.ctx, s.actor.identityId, id, {
        reasonCode: requireString(b['reasonCode'], 'reasonCode', s.correlationId),
        ...optNum(b['amountMinor'], 'amountMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optStr(b['narrative'], 'narrative'),
        ...optStr(b['recommendedDate'], 'recommendedDate'),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.writeoffApprove,
    auditCode: M17_AUDIT_CODES.writeoffApproved,
    description: 'Approve a write-off recommendation (not the recommender).',
  })
  @Post('writeoffs/:wid/approve')
  async approveWriteOff(
    @Param('wid') wid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'approve write-off (m17)');
    const decision = b['decision'] === 'rejected' ? 'rejected' : 'approved';
    return writeoffView(
      await this.service.approveWriteOff(s.ctx, s.actor.identityId, wid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        decision,
        ...optStr(b['financeReference'], 'financeReference'),
      }),
    );
  }
  @Get('recoveries/:id/writeoffs')
  async listWriteOffs(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list write-offs (m17)');
    return { writeoffs: (await this.service.listWriteOffs(s.ctx, id)).map(writeoffView) };
  }

  // --- outcomes (append-only) -------------------------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.outcomeManage,
    auditCode: M17_AUDIT_CODES.outcomeRecorded,
    description: 'Record a recovery outcome.',
  })
  @Post('recoveries/:id/outcomes')
  async recordOutcome(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record outcome (m17)');
    return outcomeView(
      await this.service.recordOutcome(s.ctx, s.actor.identityId, id, {
        outcomeType: requireString(b['outcomeType'], 'outcomeType', s.correlationId),
        ...optStr(b['outcomeDate'], 'outcomeDate'),
        ...optStr(b['summary'], 'summary'),
        ...optNum(b['recoveredAmountMinor'], 'recoveredAmountMinor'),
        ...optNum(b['waivedAmountMinor'], 'waivedAmountMinor'),
        ...optNum(b['writtenOffAmountMinor'], 'writtenOffAmountMinor'),
        ...optNum(b['outstandingAmountMinor'], 'outstandingAmountMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Get('recoveries/:id/outcomes')
  async listOutcomes(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list outcomes (m17)');
    return { outcomes: (await this.service.listOutcomes(s.ctx, id)).map(outcomeView) };
  }

  // --- deadlines (deterministic; limitation is high-risk) ---------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.deadlineManage,
    auditCode: M17_AUDIT_CODES.deadlineCreated,
    description: 'Add a deadline.',
  })
  @Post('recoveries/:id/deadlines')
  async addDeadline(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add deadline (m17)');
    const rule = b['rule'] as DeadlineRule;
    return deadlineView(
      await this.service.addDeadline(s.ctx, s.actor.identityId, id, {
        deadlineType: requireString(b['deadlineType'], 'deadlineType', s.correlationId),
        rule,
        ...optStr(b['startAt'], 'startAt'),
        ...optStr(b['source'], 'source'),
        ...optStr(b['authority'], 'authority'),
        ...optNum(b['warnWindowMs'], 'warnWindowMs'),
        ...optStr(b['relatedDemand'], 'relatedDemand'),
        ...optStr(b['relatedArrangement'], 'relatedArrangement'),
        ...optStr(b['relatedEnforcement'], 'relatedEnforcement'),
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.deadlineManage,
    auditCode: M17_AUDIT_CODES.deadlineExtended,
    description: 'Extend a deadline.',
  })
  @Post('deadlines/:did/extend')
  async extendDeadline(
    @Param('did') did: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'extend deadline (m17)');
    return deadlineView(
      await this.service.extendDeadline(s.ctx, s.actor.identityId, did, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        extensionTo: requireString(b['extensionTo'], 'extensionTo', s.correlationId),
        ...optStr(b['reason'], 'reason'),
      }),
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.deadlineManage,
    auditCode: M17_AUDIT_CODES.deadlineBreached,
    description: 'Evaluate a deadline.',
  })
  @Post('deadlines/:did/evaluate')
  async evaluateDeadline(@Param('did') did: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'evaluate deadline (m17)');
    return this.service.evaluateDeadline(s.ctx, s.actor.identityId, did);
  }
  @Get('recoveries/:id/deadlines')
  async listDeadlines(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list deadlines (m17)');
    return { deadlines: (await this.service.listDeadlines(s.ctx, id)).map(deadlineView) };
  }

  // --- cost references (references only) ---------------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.costManage,
    auditCode: M17_AUDIT_CODES.costRecorded,
    description: 'Record a cost reference.',
  })
  @Post('recoveries/:id/costs')
  async recordCost(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record cost (m17)');
    return costView(
      await this.service.recordCost(s.ctx, s.actor.identityId, id, {
        ...optStr(b['costType'], 'costType'),
        ...optStr(b['description'], 'description'),
        ...optNum(b['amountMinor'], 'amountMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optStr(b['agentReference'], 'agentReference'),
        ...optStr(b['invoiceReference'], 'invoiceReference'),
        recoverable: b['recoverable'] === true,
      }),
    );
  }
  @Get('recoveries/:id/costs')
  async listCosts(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list costs (m17)');
    return { costs: (await this.service.listCosts(s.ctx, id)).map(costView) };
  }

  // --- notes ------------------------------------------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.recoveryUpdate,
    auditCode: M17_AUDIT_CODES.noteCreated,
    description: 'Add a note (restricted notes need recovery.privileged.create).',
  })
  @Post('recoveries/:id/notes')
  async addNote(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add note (m17)');
    return noteView(
      await this.service.addNote(s.ctx, s.actor.identityId, id, {
        content: requireString(b['content'], 'content', s.correlationId),
        ...optStr(b['noteType'], 'noteType'),
        ...optStr(b['headline'], 'headline'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
      true,
    );
  }
  @Get('recoveries/:id/notes')
  async listNotes(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list notes (m17)');
    const { notes, canReadPrivileged } = await this.service.listNotes(s.ctx, id);
    return { notes: notes.map((n) => noteView(n, canReadPrivileged)) };
  }

  // --- relationships ----------------------------------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.recoveryUpdate,
    auditCode: M17_AUDIT_CODES.relationshipCreated,
    description: 'Link two recoveries.',
  })
  @Post('relationships')
  async link(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'link recoveries (m17)');
    return relationshipView(
      await this.service.link(s.ctx, s.actor.identityId, {
        fromRecoveryId: requireString(b['fromRecoveryId'], 'fromRecoveryId', s.correlationId),
        toRecoveryId: requireString(b['toRecoveryId'], 'toRecoveryId', s.correlationId),
        kind: requireString(b['kind'], 'kind', s.correlationId),
      }),
    );
  }
  @Get('recoveries/:id/relationships')
  async listRelationships(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list relationships (m17)');
    return { relationships: (await this.service.listRelationships(s.ctx, id)).map(relationshipView) };
  }

  // --- SLA + escalation -------------------------------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.deadlineManage,
    auditCode: M17_AUDIT_CODES.slaStarted,
    description: 'Start SLA (materializes deadlines).',
  })
  @Post('recoveries/:id/sla/start')
  async startSla(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'start sla (m17)');
    const rows = await this.service.startSla(
      s.ctx,
      s.actor.identityId,
      id,
      requireString(b['policyCode'], 'policyCode', s.correlationId),
    );
    return { deadlines: rows.length };
  }
  @Endpoint({
    permission: M17_PERMISSIONS.recoveryUpdate,
    auditCode: M17_AUDIT_CODES.escalationTriggered,
    description: 'Trigger escalation (reuses m08).',
  })
  @Post('recoveries/:id/escalate')
  async escalate(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'escalate recovery (m17)');
    const ref = await this.service.triggerEscalation(s.ctx, s.actor.identityId, id, {
      reason: requireString(b['reason'], 'reason', s.correlationId),
    });
    return { escalationRef: ref };
  }

  // --- analytics --------------------------------------------------------------------------------
  @Get('recoveries/analytics/summary')
  async analytics(@Headers() h: Record<string, string>, @Query('dimension') dimension?: string) {
    const s = await this.scoped(h, 'recovery analytics (m17)');
    const dims = [
      'recovery_type',
      'source',
      'jurisdiction',
      'instrument_type',
      'strategy',
      'enforcement_stage',
      'recovery_risk',
      'priority',
      'status',
      'confidentiality',
    ];
    const dim = typeof dimension === 'string' && dims.includes(dimension) ? dimension : 'status';
    return { dimension: dim, buckets: await this.service.analytics(s.ctx, dim) };
  }
}
