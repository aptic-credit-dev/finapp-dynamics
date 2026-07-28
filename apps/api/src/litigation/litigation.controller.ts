import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  LitigationWorkService,
  M16_AUDIT_CODES,
  M16_PERMISSIONS,
  type DeadlineRule,
} from '@finapp/m16-litigation';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import {
  filingView,
  serviceView,
  appearanceView,
  recordView,
  witnessView,
  expertView,
  exhibitView,
  bundleView,
  bundleItemView,
  orderView,
  complianceView,
  outcomeView,
  appealView,
  deadlineView,
  costView,
  noteView,
  relationshipView,
} from './views.ts';

/**
 * Litigation working entities — filings (maker-checker), service (single-winner verify), appearances/diary,
 * hearing records, witnesses, experts, exhibits (single-winner admit), bundles (maker-checker), orders, compliance
 * obligations, rulings/judgments, appeals, deadlines/limitation, costs, notes, relationships, SLA, escalation and
 * the safe m17/m18 boundary signals, under `/api/v1/litigation`. Contacts + privileged notes are redacted/filtered.
 * Permission enforced in LitigationWorkService (default deny).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optNum<K extends string>(v: unknown, k: K): Partial<Record<K, number>> {
  return typeof v === 'number' ? ({ [k]: v } as Record<K, number>) : {};
}

@Controller('litigation')
export class LitigationController {
  private readonly service: LitigationWorkService;
  private readonly actors: ActorContextFactory;
  constructor(service: LitigationWorkService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- filings ----------------------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.filingManage,
    auditCode: M16_AUDIT_CODES.filingRegistered,
    description: 'Register a filing.',
  })
  @Post('proceedings/:id/filings')
  async registerFiling(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'register filing (m16)');
    return filingView(
      await this.service.registerFiling(s.ctx, s.actor.identityId, id, {
        filingRole: requireString(b['filingRole'], 'filingRole', s.correlationId),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optNum(b['documentVersion'], 'documentVersion'),
        ...optStr(b['receivingRegistry'], 'receivingRegistry'),
        ...optStr(b['filingReference'], 'filingReference'),
        privileged: b['privileged'] === true,
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.filingManage,
    auditCode: M16_AUDIT_CODES.filingReviewed,
    description: 'Review a filing.',
  })
  @Post('filings/:fid/review')
  async reviewFiling(
    @Param('fid') fid: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'review filing (m16)');
    return filingView(
      await this.service.reviewFiling(
        s.ctx,
        s.actor.identityId,
        fid,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.filingApprove,
    auditCode: M16_AUDIT_CODES.filingApproved,
    description: 'Approve a filing (not the preparer).',
  })
  @Post('filings/:fid/approve')
  async approveFiling(
    @Param('fid') fid: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'approve filing (m16)');
    return filingView(
      await this.service.approveFiling(
        s.ctx,
        s.actor.identityId,
        fid,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.filingManage,
    auditCode: M16_AUDIT_CODES.filingFiled,
    description: 'File a filing.',
  })
  @Post('filings/:fid/file')
  async fileFiling(
    @Param('fid') fid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'file filing (m16)');
    return filingView(
      await this.service.fileFiling(s.ctx, s.actor.identityId, fid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['courtStampReference'], 'courtStampReference'),
      }),
    );
  }
  @Get('proceedings/:id/filings')
  async listFilings(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list filings (m16)');
    return { filings: (await this.service.listFilings(s.ctx, id)).map(filingView) };
  }

  // --- service ----------------------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.serviceManage,
    auditCode: M16_AUDIT_CODES.serviceRecorded,
    description: 'Record service of process.',
  })
  @Post('proceedings/:id/service')
  async recordService(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record service (m16)');
    return serviceView(
      await this.service.recordService(s.ctx, s.actor.identityId, id, {
        ...optStr(b['itemServed'], 'itemServed'),
        ...optStr(b['partyRef'], 'partyRef'),
        ...optStr(b['serviceMethod'], 'serviceMethod'),
        ...optStr(b['serviceDate'], 'serviceDate'),
        ...optStr(b['locationReference'], 'locationReference'),
        ...optStr(b['recipient'], 'recipient'),
        ...optStr(b['serviceStatus'], 'serviceStatus'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.serviceVerify,
    auditCode: M16_AUDIT_CODES.serviceVerified,
    description: 'Verify service (single-winner).',
  })
  @Post('service/:sid/verify')
  async verifyService(
    @Param('sid') sid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'verify service (m16)');
    const decision = b['decision'] === 'rejected' ? 'rejected' : 'verified';
    return serviceView(await this.service.verifyService(s.ctx, s.actor.identityId, sid, decision));
  }
  @Get('proceedings/:id/service')
  async listServices(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list service (m16)');
    return { service: (await this.service.listServices(s.ctx, id)).map(serviceView) };
  }

  // --- appearances ------------------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.appearanceManage,
    auditCode: M16_AUDIT_CODES.appearanceScheduled,
    description: 'Schedule an appearance.',
  })
  @Post('proceedings/:id/appearances')
  async scheduleAppearance(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'schedule appearance (m16)');
    return appearanceView(
      await this.service.scheduleAppearance(s.ctx, s.actor.identityId, id, {
        appearanceType: requireString(b['appearanceType'], 'appearanceType', s.correlationId),
        ...optStr(b['scheduledAt'], 'scheduledAt'),
        ...optStr(b['forum'], 'forum'),
        ...optStr(b['venue'], 'venue'),
        ...optStr(b['presidingRef'], 'presidingRef'),
        ...optStr(b['purpose'], 'purpose'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.appearanceManage,
    auditCode: M16_AUDIT_CODES.appearanceUpdated,
    description: 'Update an appearance.',
  })
  @Post('appearances/:aid')
  async updateAppearance(
    @Param('aid') aid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update appearance (m16)');
    return appearanceView(
      await this.service.updateAppearance(s.ctx, s.actor.identityId, aid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['scheduledAt'], 'scheduledAt'),
        ...optStr(b['forum'], 'forum'),
        ...optStr(b['venue'], 'venue'),
        ...optStr(b['presidingRef'], 'presidingRef'),
        ...optStr(b['purpose'], 'purpose'),
      }),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.appearanceComplete,
    auditCode: M16_AUDIT_CODES.appearanceCompleted,
    description: 'Complete an appearance.',
  })
  @Post('appearances/:aid/complete')
  async completeAppearance(
    @Param('aid') aid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'complete appearance (m16)');
    return appearanceView(
      await this.service.completeAppearance(s.ctx, s.actor.identityId, aid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['outcome'], 'outcome'),
        ...optStr(b['directions'], 'directions'),
        ...optStr(b['nextAction'], 'nextAction'),
        ...optStr(b['nextAt'], 'nextAt'),
      }),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.appearanceManage,
    auditCode: M16_AUDIT_CODES.appearanceAdjourned,
    description: 'Adjourn an appearance.',
  })
  @Post('appearances/:aid/adjourn')
  async adjournAppearance(
    @Param('aid') aid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'adjourn appearance (m16)');
    return appearanceView(
      await this.service.adjournAppearance(s.ctx, s.actor.identityId, aid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['reason'], 'reason'),
        ...optStr(b['nextAt'], 'nextAt'),
      }),
    );
  }
  @Get('proceedings/:id/appearances')
  async listAppearances(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list appearances (m16)');
    return { appearances: (await this.service.listAppearances(s.ctx, id)).map(appearanceView) };
  }

  // --- proceeding records -----------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.appearanceManage,
    auditCode: M16_AUDIT_CODES.recordCaptured,
    description: 'Capture a hearing record.',
  })
  @Post('proceedings/:id/records')
  async captureRecord(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'capture record (m16)');
    return recordView(
      await this.service.captureRecord(s.ctx, s.actor.identityId, id, {
        ...optStr(b['appearanceId'], 'appearanceId'),
        ...optStr(b['attendance'], 'attendance'),
        ...optStr(b['submissionsSummary'], 'submissionsSummary'),
        ...optStr(b['evidenceTaken'], 'evidenceTaken'),
        ...optStr(b['directions'], 'directions'),
        ...optStr(b['ordersSummary'], 'ordersSummary'),
        ...optStr(b['nextAt'], 'nextAt'),
        ...optStr(b['documentRef'], 'documentRef'),
        privileged: b['privileged'] === true,
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Get('proceedings/:id/records')
  async listRecords(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list records (m16)');
    return { records: (await this.service.listRecords(s.ctx, id)).map(recordView) };
  }

  // --- witnesses --------------------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.witnessManage,
    auditCode: M16_AUDIT_CODES.witnessAdded,
    description: 'Add a witness.',
  })
  @Post('proceedings/:id/witnesses')
  async addWitness(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add witness (m16)');
    return witnessView(
      await this.service.addWitness(s.ctx, s.actor.identityId, id, {
        witnessType: requireString(b['witnessType'], 'witnessType', s.correlationId),
        ...optStr(b['witnessRef'], 'witnessRef'),
        ...optStr(b['role'], 'role'),
        ...optStr(b['relevance'], 'relevance'),
        ...optStr(b['statementDocumentRef'], 'statementDocumentRef'),
        ...optStr(b['contactRef'], 'contactRef'),
        protectionFlag: b['protectionFlag'] === true,
        ...optStr(b['confidentiality'], 'confidentiality'),
        privileged: b['privileged'] === true,
      }),
      true,
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.witnessManage,
    auditCode: M16_AUDIT_CODES.witnessStatementLinked,
    description: 'Update a witness.',
  })
  @Post('witnesses/:wid')
  async updateWitness(
    @Param('wid') wid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update witness (m16)');
    return witnessView(
      await this.service.updateWitness(s.ctx, s.actor.identityId, wid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['attendanceStatus'], 'attendanceStatus'),
        ...optStr(b['summonsStatus'], 'summonsStatus'),
        ...optStr(b['preparationStatus'], 'preparationStatus'),
        ...optStr(b['examinationStatus'], 'examinationStatus'),
        ...optStr(b['statementDocumentRef'], 'statementDocumentRef'),
      }),
      true,
    );
  }
  @Get('proceedings/:id/witnesses')
  async listWitnesses(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list witnesses (m16)');
    const { witnesses, canReadContact } = await this.service.listWitnesses(s.ctx, id);
    return { witnesses: witnesses.map((w) => witnessView(w, canReadContact)) };
  }

  // --- experts ----------------------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.expertManage,
    auditCode: M16_AUDIT_CODES.expertAdded,
    description: 'Add an expert.',
  })
  @Post('proceedings/:id/experts')
  async addExpert(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add expert (m16)');
    return expertView(
      await this.service.addExpert(s.ctx, s.actor.identityId, id, {
        ...optStr(b['expertRef'], 'expertRef'),
        ...optStr(b['expertise'], 'expertise'),
        ...optStr(b['engagementReference'], 'engagementReference'),
        ...optStr(b['instructionScope'], 'instructionScope'),
        ...optStr(b['reportDocumentRef'], 'reportDocumentRef'),
        ...optStr(b['reportDueDate'], 'reportDueDate'),
        ...optStr(b['confidentiality'], 'confidentiality'),
        privileged: b['privileged'] === true,
      }),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.expertManage,
    auditCode: M16_AUDIT_CODES.expertAdded,
    description: 'Update an expert.',
  })
  @Post('experts/:eid')
  async updateExpert(
    @Param('eid') eid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update expert (m16)');
    return expertView(
      await this.service.updateExpert(s.ctx, s.actor.identityId, eid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['reportStatus'], 'reportStatus'),
        ...optStr(b['attendanceStatus'], 'attendanceStatus'),
        ...optStr(b['reportDocumentRef'], 'reportDocumentRef'),
      }),
    );
  }
  @Get('proceedings/:id/experts')
  async listExperts(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list experts (m16)');
    return { experts: (await this.service.listExperts(s.ctx, id)).map(expertView) };
  }

  // --- exhibits ---------------------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.exhibitManage,
    auditCode: M16_AUDIT_CODES.exhibitRegistered,
    description: 'Register an exhibit.',
  })
  @Post('proceedings/:id/exhibits')
  async registerExhibit(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'register exhibit (m16)');
    return exhibitView(
      await this.service.registerExhibit(s.ctx, s.actor.identityId, id, {
        ...optStr(b['exhibitNumber'], 'exhibitNumber'),
        ...optStr(b['description'], 'description'),
        ...optStr(b['source'], 'source'),
        ...optStr(b['relatedWitness'], 'relatedWitness'),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['evidenceRef'], 'evidenceRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
        privileged: b['privileged'] === true,
      }),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.exhibitManage,
    auditCode: M16_AUDIT_CODES.exhibitAdmitted,
    description: 'Decide an exhibit (single-winner).',
  })
  @Post('exhibits/:xid/admit')
  async admitExhibit(
    @Param('xid') xid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'admit exhibit (m16)');
    const raw = b['decision'];
    const decision = raw === 'rejected' || raw === 'marked' || raw === 'withdrawn' ? raw : 'admitted';
    return exhibitView(await this.service.admitExhibit(s.ctx, s.actor.identityId, xid, decision));
  }
  @Get('proceedings/:id/exhibits')
  async listExhibits(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list exhibits (m16)');
    return { exhibits: (await this.service.listExhibits(s.ctx, id)).map(exhibitView) };
  }

  // --- bundles ----------------------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.bundleManage,
    auditCode: M16_AUDIT_CODES.bundleCreated,
    description: 'Create a hearing bundle.',
  })
  @Post('proceedings/:id/bundles')
  async createBundle(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'create bundle (m16)');
    return bundleView(
      await this.service.createBundle(s.ctx, s.actor.identityId, id, {
        ...optStr(b['bundleType'], 'bundleType'),
        ...optStr(b['title'], 'title'),
        ...optStr(b['indexDocumentRef'], 'indexDocumentRef'),
        ...optStr(b['appearanceRef'], 'appearanceRef'),
        privileged: b['privileged'] === true,
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.bundleApprove,
    auditCode: M16_AUDIT_CODES.bundleApproved,
    description: 'Approve a bundle (not the preparer).',
  })
  @Post('bundles/:bid/approve')
  async approveBundle(
    @Param('bid') bid: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'approve bundle (m16)');
    return bundleView(
      await this.service.approveBundle(
        s.ctx,
        s.actor.identityId,
        bid,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.bundleManage,
    auditCode: M16_AUDIT_CODES.bundleFiled,
    description: 'File a bundle.',
  })
  @Post('bundles/:bid/file')
  async fileBundle(
    @Param('bid') bid: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'file bundle (m16)');
    return bundleView(
      await this.service.fileBundle(
        s.ctx,
        s.actor.identityId,
        bid,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.bundleManage,
    auditCode: M16_AUDIT_CODES.bundleCreated,
    description: 'Add a bundle item.',
  })
  @Post('bundles/:bid/items')
  async addBundleItem(
    @Param('bid') bid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add bundle item (m16)');
    return bundleItemView(
      await this.service.addBundleItem(s.ctx, s.actor.identityId, bid, {
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['tab'], 'tab'),
        ...optNum(b['pageFrom'], 'pageFrom'),
        ...optNum(b['pageTo'], 'pageTo'),
        ...optStr(b['description'], 'description'),
        ...optNum(b['sortOrder'], 'sortOrder'),
      }),
    );
  }
  @Get('proceedings/:id/bundles')
  async listBundles(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list bundles (m16)');
    return { bundles: (await this.service.listBundles(s.ctx, id)).map(bundleView) };
  }

  // --- orders -----------------------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.orderManage,
    auditCode: M16_AUDIT_CODES.orderRecorded,
    description: 'Record a court order.',
  })
  @Post('proceedings/:id/orders')
  async recordOrder(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record order (m16)');
    return orderView(
      await this.service.recordOrder(s.ctx, s.actor.identityId, id, {
        orderType: requireString(b['orderType'], 'orderType', s.correlationId),
        ...optStr(b['orderDate'], 'orderDate'),
        ...optStr(b['issuingForum'], 'issuingForum'),
        ...optStr(b['presidingRef'], 'presidingRef'),
        ...optStr(b['summary'], 'summary'),
        ...optStr(b['operativeTerms'], 'operativeTerms'),
        ...optStr(b['effectiveDate'], 'effectiveDate'),
        ...optStr(b['expiryDate'], 'expiryDate'),
        ...optStr(b['documentRef'], 'documentRef'),
        privileged: b['privileged'] === true,
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Get('proceedings/:id/orders')
  async listOrders(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list orders (m16)');
    return { orders: (await this.service.listOrders(s.ctx, id)).map(orderView) };
  }

  // --- compliance obligations -------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.complianceManage,
    auditCode: M16_AUDIT_CODES.complianceCreated,
    description: 'Add a compliance obligation.',
  })
  @Post('proceedings/:id/obligations')
  async addObligation(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add obligation (m16)');
    return complianceView(
      await this.service.addObligation(s.ctx, s.actor.identityId, id, {
        ...optStr(b['orderId'], 'orderId'),
        ...optStr(b['obligation'], 'obligation'),
        ...optStr(b['responsibleRef'], 'responsibleRef'),
        ...optStr(b['affectedParty'], 'affectedParty'),
        ...optStr(b['dueDate'], 'dueDate'),
      }),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.complianceManage,
    auditCode: M16_AUDIT_CODES.complianceCompleted,
    description: 'Complete a compliance obligation.',
  })
  @Post('obligations/:oid/complete')
  async completeObligation(
    @Param('oid') oid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'complete obligation (m16)');
    return complianceView(
      await this.service.completeObligation(s.ctx, s.actor.identityId, oid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['evidenceReference'], 'evidenceReference'),
      }),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.complianceManage,
    auditCode: M16_AUDIT_CODES.complianceBreached,
    description: 'Mark a compliance obligation breached.',
  })
  @Post('obligations/:oid/breach')
  async breachObligation(
    @Param('oid') oid: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'breach obligation (m16)');
    return complianceView(
      await this.service.breachObligation(
        s.ctx,
        s.actor.identityId,
        oid,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('proceedings/:id/obligations')
  async listObligations(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list obligations (m16)');
    return { obligations: (await this.service.listObligations(s.ctx, id)).map(complianceView) };
  }

  // --- outcomes ---------------------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.outcomeManage,
    auditCode: M16_AUDIT_CODES.rulingRecorded,
    description: 'Record a ruling/judgment/award.',
  })
  @Post('proceedings/:id/outcomes')
  async recordOutcome(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record outcome (m16)');
    return outcomeView(
      await this.service.recordOutcome(s.ctx, s.actor.identityId, id, {
        outcomeType: requireString(b['outcomeType'], 'outcomeType', s.correlationId),
        ...optStr(b['outcomeDate'], 'outcomeDate'),
        ...optStr(b['forum'], 'forum'),
        ...optStr(b['presidingRef'], 'presidingRef'),
        ...optStr(b['summary'], 'summary'),
        ...optStr(b['disposition'], 'disposition'),
        ...optNum(b['amountAwardedMinor'], 'amountAwardedMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optNum(b['costsAwardedMinor'], 'costsAwardedMinor'),
        appealable: b['appealable'] === true,
        ...optStr(b['appealDeadline'], 'appealDeadline'),
        ...optStr(b['documentRef'], 'documentRef'),
        privileged: b['privileged'] === true,
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Get('proceedings/:id/outcomes')
  async listOutcomes(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list outcomes (m16)');
    return { outcomes: (await this.service.listOutcomes(s.ctx, id)).map(outcomeView) };
  }

  // --- appeals ----------------------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.appealManage,
    auditCode: M16_AUDIT_CODES.appealInitiated,
    description: 'Initiate an appeal (one active per proceeding).',
  })
  @Post('proceedings/:id/appeals')
  async initiateAppeal(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'initiate appeal (m16)');
    return appealView(
      await this.service.initiateAppeal(s.ctx, s.actor.identityId, id, {
        ...optStr(b['appealType'], 'appealType'),
        ...optStr(b['forum'], 'forum'),
        ...optStr(b['deadline'], 'deadline'),
        ...optStr(b['groundsSummary'], 'groundsSummary'),
        ...optStr(b['counselRef'], 'counselRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.appealManage,
    auditCode: M16_AUDIT_CODES.appealInitiated,
    description: 'Update an appeal.',
  })
  @Post('appeals/:apid')
  async updateAppeal(
    @Param('apid') apid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update appeal (m16)');
    return appealView(
      await this.service.updateAppeal(s.ctx, s.actor.identityId, apid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['approvalStatus'], 'approvalStatus'),
        ...optStr(b['filingStatus'], 'filingStatus'),
        ...optStr(b['appealNumber'], 'appealNumber'),
        ...optStr(b['status'], 'status'),
        ...optStr(b['outcome'], 'outcome'),
      }),
    );
  }
  @Get('proceedings/:id/appeals')
  async listAppeals(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list appeals (m16)');
    return { appeals: (await this.service.listAppeals(s.ctx, id)).map(appealView) };
  }

  // --- deadlines --------------------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.deadlineManage,
    auditCode: M16_AUDIT_CODES.deadlineCreated,
    description: 'Add a deadline.',
  })
  @Post('proceedings/:id/deadlines')
  async addDeadline(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add deadline (m16)');
    const rule = b['rule'] as DeadlineRule;
    return deadlineView(
      await this.service.addDeadline(s.ctx, s.actor.identityId, id, {
        deadlineType: requireString(b['deadlineType'], 'deadlineType', s.correlationId),
        rule,
        ...optStr(b['startAt'], 'startAt'),
        ...optStr(b['source'], 'source'),
        ...optStr(b['authority'], 'authority'),
        ...optNum(b['warnWindowMs'], 'warnWindowMs'),
      }),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.deadlineManage,
    auditCode: M16_AUDIT_CODES.deadlineExtended,
    description: 'Extend a deadline.',
  })
  @Post('deadlines/:did/extend')
  async extendDeadline(
    @Param('did') did: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'extend deadline (m16)');
    return deadlineView(
      await this.service.extendDeadline(s.ctx, s.actor.identityId, did, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        extensionTo: requireString(b['extensionTo'], 'extensionTo', s.correlationId),
        ...optStr(b['reason'], 'reason'),
      }),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.deadlineManage,
    auditCode: M16_AUDIT_CODES.deadlineBreached,
    description: 'Evaluate a deadline.',
  })
  @Post('deadlines/:did/evaluate')
  async evaluateDeadline(@Param('did') did: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'evaluate deadline (m16)');
    return this.service.evaluateDeadline(s.ctx, s.actor.identityId, did);
  }
  @Get('proceedings/:id/deadlines')
  async listDeadlines(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list deadlines (m16)');
    return { deadlines: (await this.service.listDeadlines(s.ctx, id)).map(deadlineView) };
  }

  // --- costs ------------------------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.costManage,
    auditCode: M16_AUDIT_CODES.costRecorded,
    description: 'Record a cost reference.',
  })
  @Post('proceedings/:id/costs')
  async recordCost(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record cost (m16)');
    return costView(
      await this.service.recordCost(s.ctx, s.actor.identityId, id, {
        ...optStr(b['costType'], 'costType'),
        ...optStr(b['description'], 'description'),
        ...optNum(b['amountMinor'], 'amountMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optStr(b['counselReference'], 'counselReference'),
        ...optStr(b['invoiceReference'], 'invoiceReference'),
        recoverable: b['recoverable'] === true,
      }),
    );
  }
  @Get('proceedings/:id/costs')
  async listCosts(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list costs (m16)');
    return { costs: (await this.service.listCosts(s.ctx, id)).map(costView) };
  }

  // --- notes ------------------------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.proceedingUpdate,
    auditCode: M16_AUDIT_CODES.noteCreated,
    description: 'Add a note (privileged notes need litigation.privileged.create).',
  })
  @Post('proceedings/:id/notes')
  async addNote(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add note (m16)');
    return noteView(
      await this.service.addNote(s.ctx, s.actor.identityId, id, {
        content: requireString(b['content'], 'content', s.correlationId),
        ...optStr(b['noteType'], 'noteType'),
        ...optStr(b['headline'], 'headline'),
        ...optStr(b['relatedAppearance'], 'relatedAppearance'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
      true,
    );
  }
  @Get('proceedings/:id/notes')
  async listNotes(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list notes (m16)');
    const { notes, canReadPrivileged } = await this.service.listNotes(s.ctx, id);
    return { notes: notes.map((n) => noteView(n, canReadPrivileged)) };
  }

  // --- relationships ----------------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.proceedingUpdate,
    auditCode: M16_AUDIT_CODES.relationshipCreated,
    description: 'Link two proceedings.',
  })
  @Post('relationships')
  async link(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'link proceedings (m16)');
    return relationshipView(
      await this.service.link(s.ctx, s.actor.identityId, {
        fromProceedingId: requireString(b['fromProceedingId'], 'fromProceedingId', s.correlationId),
        toProceedingId: requireString(b['toProceedingId'], 'toProceedingId', s.correlationId),
        kind: requireString(b['kind'], 'kind', s.correlationId),
      }),
    );
  }
  @Get('proceedings/:id/relationships')
  async listRelationships(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list relationships (m16)');
    return { relationships: (await this.service.listRelationships(s.ctx, id)).map(relationshipView) };
  }

  // --- SLA + escalation + boundary signals ------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.deadlineManage,
    auditCode: M16_AUDIT_CODES.slaStarted,
    description: 'Start SLA (materializes deadlines).',
  })
  @Post('proceedings/:id/sla/start')
  async startSla(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'start sla (m16)');
    const rows = await this.service.startSla(
      s.ctx,
      s.actor.identityId,
      id,
      requireString(b['policyCode'], 'policyCode', s.correlationId),
    );
    return { deadlines: rows.length };
  }
  @Endpoint({
    permission: M16_PERMISSIONS.proceedingUpdate,
    auditCode: M16_AUDIT_CODES.escalationTriggered,
    description: 'Trigger escalation (reuses m08).',
  })
  @Post('proceedings/:id/escalate')
  async escalate(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'escalate proceeding (m16)');
    const ref = await this.service.triggerEscalation(s.ctx, s.actor.identityId, id, {
      reason: requireString(b['reason'], 'reason', s.correlationId),
    });
    return { escalationRef: ref };
  }
  @Endpoint({
    permission: M16_PERMISSIONS.proceedingUpdate,
    auditCode: M16_AUDIT_CODES.enforcementReferralReady,
    description: 'Signal enforcement referral readiness (m17 boundary).',
  })
  @Post('proceedings/:id/enforcement-referral')
  async enforcementReferral(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'enforcement referral (m16)');
    const ref = await this.service.enforcementReferral(s.ctx, s.actor.identityId, id);
    return { enforcementReferralRef: ref };
  }
  @Endpoint({
    permission: M16_PERMISSIONS.proceedingUpdate,
    auditCode: M16_AUDIT_CODES.knowledgeCandidateCreated,
    description: 'Signal a knowledge candidate (m18 boundary).',
  })
  @Post('proceedings/:id/knowledge-candidate')
  async knowledgeCandidate(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'knowledge candidate (m16)');
    await this.service.knowledgeCandidate(s.ctx, s.actor.identityId, id);
    return { ok: true };
  }

  // --- analytics --------------------------------------------------------------------------------
  @Get('analytics/summary')
  async analytics(@Headers() h: Record<string, string>, @Query('dimension') dimension?: string) {
    const s = await this.scoped(h, 'litigation analytics (m16)');
    const dims = [
      'proceeding_type',
      'source',
      'jurisdiction',
      'forum',
      'forum_type',
      'organization_role',
      'litigation_risk',
      'priority',
      'status',
      'confidentiality',
    ];
    const dim = typeof dimension === 'string' && dims.includes(dimension) ? dimension : 'status';
    return { dimension: dim, buckets: await this.service.analytics(s.ctx, dim) };
  }
}
