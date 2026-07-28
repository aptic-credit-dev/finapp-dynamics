import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { ProceedingService, M16_AUDIT_CODES, M16_PERMISSIONS } from '@finapp/m16-litigation';
import { ActorContextFactory } from '@finapp/m02-identity';
import {
  optionalLimit,
  optionalOffset,
  requireString,
  requireTenantScope,
  requireVersion,
} from '../identity/http.ts';
import { proceedingView, partyView, claimView } from './views.ts';

/**
 * Litigation proceeding intake + lifecycle + parties + claims, under `/api/v1/litigation`. The M14 matter referral
 * is idempotent (one proceeding per referral key). Confidential/privileged proceedings are redacted by the view
 * unless the caller holds `litigation.confidential.read`. Permission enforced in ProceedingService (default deny).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optNum<K extends string>(v: unknown, k: K): Partial<Record<K, number>> {
  return typeof v === 'number' ? ({ [k]: v } as Record<K, number>) : {};
}

@Controller('litigation')
export class ProceedingsController {
  private readonly service: ProceedingService;
  private readonly actors: ActorContextFactory;
  constructor(service: ProceedingService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M16_PERMISSIONS.proceedingCreate,
    auditCode: M16_AUDIT_CODES.proceedingCreated,
    description: 'Create a litigation proceeding.',
  })
  @Post('proceedings')
  async create(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create proceeding (m16)');
    const idem = h['idempotency-key'];
    const p = await this.service.create(s.ctx, s.actor.identityId, {
      proceedingTypeCode: requireString(b['proceedingTypeCode'], 'proceedingTypeCode', s.correlationId),
      title: requireString(b['title'], 'title', s.correlationId),
      ...optStr(b['summary'], 'summary'),
      ...optStr(b['description'], 'description'),
      ...optStr(b['source'], 'source'),
      ...optStr(b['jurisdiction'], 'jurisdiction'),
      ...optStr(b['forum'], 'forum'),
      ...optStr(b['forumType'], 'forumType'),
      ...optStr(b['court'], 'court'),
      ...optStr(b['station'], 'station'),
      ...optStr(b['division'], 'division'),
      ...optStr(b['externalCaseNumber'], 'externalCaseNumber'),
      ...optStr(b['organizationRole'], 'organizationRole'),
      ...optStr(b['confidentiality'], 'confidentiality'),
      privileged: b['privileged'] === true,
      ...optStr(b['litigationRisk'], 'litigationRisk'),
      ...optStr(b['priority'], 'priority'),
      ...optNum(b['claimAmountMinor'], 'claimAmountMinor'),
      ...optStr(b['currency'], 'currency'),
      ...optStr(b['slaPolicyCode'], 'slaPolicyCode'),
      ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
    });
    return proceedingView(p, true);
  }

  @Endpoint({
    permission: M16_PERMISSIONS.proceedingCreate,
    auditCode: M16_AUDIT_CODES.proceedingCreated,
    description: 'Intake a proceeding from an external system.',
  })
  @Post('intake')
  async intake(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'intake proceeding (m16)');
    const p = await this.service.intakeExternal(s.ctx, s.actor.identityId, {
      source: requireString(b['source'], 'source', s.correlationId),
      externalReference: requireString(b['externalReference'], 'externalReference', s.correlationId),
      proceedingTypeCode: requireString(b['proceedingTypeCode'], 'proceedingTypeCode', s.correlationId),
      title: requireString(b['title'], 'title', s.correlationId),
      ...optStr(b['jurisdiction'], 'jurisdiction'),
      ...optStr(b['forum'], 'forum'),
    });
    return proceedingView(p, true);
  }

  @Endpoint({
    permission: M16_PERMISSIONS.referralAccept,
    auditCode: M16_AUDIT_CODES.proceedingReferred,
    description: 'Accept an M14 matter referral (one proceeding per referral key).',
  })
  @Post('from-matter')
  async fromMatter(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'accept referral (m16)');
    const r = await this.service.acceptReferral(s.ctx, s.actor.identityId, {
      referralKey: requireString(b['referralKey'], 'referralKey', s.correlationId),
      sourceMatterId: requireString(b['sourceMatterId'], 'sourceMatterId', s.correlationId),
      proceedingTypeCode: requireString(b['proceedingTypeCode'], 'proceedingTypeCode', s.correlationId),
      title: requireString(b['title'], 'title', s.correlationId),
      ...optStr(b['forum'], 'forum'),
      ...optStr(b['jurisdiction'], 'jurisdiction'),
      ...optStr(b['organizationRole'], 'organizationRole'),
      ...optStr(b['externalCaseNumber'], 'externalCaseNumber'),
      ...optStr(b['correlationId'], 'correlationId'),
      ...optStr(b['causationId'], 'causationId'),
    });
    return { proceeding: proceedingView(r.proceeding, true), created: r.created };
  }

  @Endpoint({
    permission: M16_PERMISSIONS.proceedingAssign,
    auditCode: M16_AUDIT_CODES.proceedingAssigned,
    description: 'Assign a proceeding.',
  })
  @Post('proceedings/:id/assign')
  async assign(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'assign proceeding (m16)');
    return proceedingView(
      await this.service.assign(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        owner: requireString(b['owner'], 'owner', s.correlationId),
        ...optStr(b['kind'], 'kind'),
        ...optStr(b['team'], 'team'),
        ...optStr(b['reason'], 'reason'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.proceedingReassign,
    auditCode: M16_AUDIT_CODES.proceedingReassigned,
    description: 'Reassign a proceeding.',
  })
  @Post('proceedings/:id/reassign')
  async reassign(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reassign proceeding (m16)');
    return proceedingView(
      await this.service.assign(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        owner: requireString(b['owner'], 'owner', s.correlationId),
        reassign: true,
        ...optStr(b['team'], 'team'),
        ...optStr(b['reason'], 'reason'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.proceedingUpdate,
    auditCode: M16_AUDIT_CODES.proceedingConcluded,
    description: 'Advance a proceeding to the next lifecycle status.',
  })
  @Post('proceedings/:id/advance')
  async advance(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'advance proceeding (m16)');
    return proceedingView(
      await this.service.advance(
        s.ctx,
        s.actor.identityId,
        id,
        requireString(b['toStatus'], 'toStatus', s.correlationId),
        requireVersion(b['expectedVersion'], s.correlationId),
        typeof b['reasonCode'] === 'string' ? b['reasonCode'] : undefined,
      ),
      true,
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.proceedingConclude,
    auditCode: M16_AUDIT_CODES.proceedingConcluded,
    description: 'Conclude a proceeding.',
  })
  @Post('proceedings/:id/conclude')
  async conclude(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'conclude proceeding (m16)');
    return proceedingView(
      await this.service.conclude(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        typeof b['reasonCode'] === 'string' ? b['reasonCode'] : undefined,
      ),
      true,
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.proceedingClose,
    auditCode: M16_AUDIT_CODES.proceedingClosed,
    description: 'Close a proceeding (rule-gated).',
  })
  @Post('proceedings/:id/close')
  async close(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'close proceeding (m16)');
    return proceedingView(
      await this.service.close(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['summary'], 'summary'),
        ...optStr(b['residualObligations'], 'residualObligations'),
        waive: b['waive'] === true,
      }),
      true,
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.proceedingReopen,
    auditCode: M16_AUDIT_CODES.proceedingReopened,
    description: 'Reopen a proceeding.',
  })
  @Post('proceedings/:id/reopen')
  async reopen(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reopen proceeding (m16)');
    return proceedingView(
      await this.service.reopen(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        reason: requireString(b['reason'], 'reason', s.correlationId),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.proceedingArchive,
    auditCode: M16_AUDIT_CODES.proceedingArchived,
    description: 'Archive a proceeding.',
  })
  @Post('proceedings/:id/archive')
  async archive(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'archive proceeding (m16)');
    return proceedingView(
      await this.service.archive(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
      ),
      true,
    );
  }

  // --- parties ----------------------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.partyManage,
    auditCode: M16_AUDIT_CODES.partyAdded,
    description: 'Add a party.',
  })
  @Post('proceedings/:id/parties')
  async addParty(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add party (m16)');
    return partyView(
      await this.service.addParty(s.ctx, s.actor.identityId, id, {
        partyRole: requireString(b['partyRole'], 'partyRole', s.correlationId),
        ...optStr(b['entityRef'], 'entityRef'),
        ...optStr(b['displayLabel'], 'displayLabel'),
        ...optStr(b['representationRef'], 'representationRef'),
        ...optStr(b['advocateRef'], 'advocateRef'),
        ...optStr(b['lawFirmRef'], 'lawFirmRef'),
        ...optStr(b['leadCounselRef'], 'leadCounselRef'),
        ...optStr(b['serviceAddressRef'], 'serviceAddressRef'),
        ...optStr(b['authority'], 'authority'),
        ...optStr(b['contactRef'], 'contactRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.partyManage,
    auditCode: M16_AUDIT_CODES.partyRemoved,
    description: 'Remove (deactivate) a party.',
  })
  @Post('parties/:pid/remove')
  async removeParty(
    @Param('pid') pid: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'remove party (m16)');
    return partyView(
      await this.service.removeParty(
        s.ctx,
        s.actor.identityId,
        pid,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
      true,
    );
  }
  @Get('proceedings/:id/parties')
  async listParties(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list parties (m16)');
    const { parties, canReadContact } = await this.service.listParties(s.ctx, id);
    return { parties: parties.map((p) => partyView(p, canReadContact)) };
  }

  // --- claims -----------------------------------------------------------------------------------
  @Endpoint({
    permission: M16_PERMISSIONS.claimManage,
    auditCode: M16_AUDIT_CODES.claimAdded,
    description: 'Add a claim.',
  })
  @Post('proceedings/:id/claims')
  async addClaim(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add claim (m16)');
    return claimView(
      await this.service.addClaim(s.ctx, s.actor.identityId, id, {
        claimType: requireString(b['claimType'], 'claimType', s.correlationId),
        ...optStr(b['statement'], 'statement'),
        ...optStr(b['causeReference'], 'causeReference'),
        ...optStr(b['reliefSought'], 'reliefSought'),
        ...optNum(b['amountMinor'], 'amountMinor'),
        ...optStr(b['currency'], 'currency'),
        ...optStr(b['nonMonetaryRelief'], 'nonMonetaryRelief'),
        counterclaim: b['counterclaim'] === true,
        ...optStr(b['defence'], 'defence'),
        ...optStr(b['risk'], 'risk'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
    );
  }
  @Endpoint({
    permission: M16_PERMISSIONS.claimManage,
    auditCode: M16_AUDIT_CODES.claimUpdated,
    description: 'Update a claim.',
  })
  @Post('claims/:cid')
  async patchClaim(
    @Param('cid') cid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'patch claim (m16)');
    return claimView(
      await this.service.patchClaim(s.ctx, s.actor.identityId, cid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['admissionStatus'], 'admissionStatus'),
        ...optStr(b['outcome'], 'outcome'),
        ...optStr(b['status'], 'status'),
        ...optStr(b['defence'], 'defence'),
      }),
    );
  }
  @Get('proceedings/:id/claims')
  async listClaims(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list claims (m16)');
    return { claims: (await this.service.listClaims(s.ctx, id)).map(claimView) };
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('proceedings/:id')
  async get(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get proceeding (m16)');
    const { proceeding, canReadConfidential } = await this.service.get(s.ctx, id);
    return proceedingView(proceeding, canReadConfidential);
  }
  @Get('proceedings')
  async search(
    @Headers() h: Record<string, string>,
    @Query('proceedingType') proceedingType?: string,
    @Query('status') status?: string,
    @Query('litigationRisk') litigationRisk?: string,
    @Query('priority') priority?: string,
    @Query('jurisdiction') jurisdiction?: string,
    @Query('forum') forum?: string,
    @Query('owner') owner?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const s = await this.scoped(h, 'search proceedings (m16)');
    const rows = await this.service.search(s.ctx, {
      ...optStr(proceedingType, 'proceedingTypeCode'),
      ...optStr(status, 'status'),
      ...optStr(litigationRisk, 'litigationRisk'),
      ...optStr(priority, 'priority'),
      ...optStr(jurisdiction, 'jurisdiction'),
      ...optStr(forum, 'forum'),
      ...optStr(owner, 'owner'),
      limit: optionalLimit(limit, s.correlationId).limit ?? 50,
      offset: optionalOffset(offset, s.correlationId).offset ?? 0,
    });
    return { proceedings: rows.map((r) => proceedingView(r, false)) };
  }
}
