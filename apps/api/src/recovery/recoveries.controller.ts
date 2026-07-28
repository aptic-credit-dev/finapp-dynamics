import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { RecoveryService, M17_AUDIT_CODES, M17_PERMISSIONS } from '@finapp/m17-recovery';
import { ActorContextFactory } from '@finapp/m02-identity';
import {
  optionalLimit,
  optionalOffset,
  requireString,
  requireTenantScope,
  requireVersion,
} from '../identity/http.ts';
import { recoveryView, partyView, strategyView } from './views.ts';

/**
 * Recovery intake + lifecycle + parties + strategy, under `/api/v1/recovery`. The M16 enforcement referral is
 * idempotent (one recovery per referral key). Confidential/privileged recoveries are redacted by the view unless
 * the caller holds `recovery.confidential.read`. Permission enforced in RecoveryService (default deny).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optNum<K extends string>(v: unknown, k: K): Partial<Record<K, number>> {
  return typeof v === 'number' ? ({ [k]: v } as Record<K, number>) : {};
}

@Controller('recovery')
export class RecoveriesController {
  private readonly service: RecoveryService;
  private readonly actors: ActorContextFactory;
  constructor(service: RecoveryService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M17_PERMISSIONS.recoveryCreate,
    auditCode: M17_AUDIT_CODES.recoveryCreated,
    description: 'Create a recovery case.',
  })
  @Post('recoveries')
  async create(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create recovery (m17)');
    const idem = h['idempotency-key'];
    const rec = await this.service.create(s.ctx, s.actor.identityId, {
      recoveryTypeCode: requireString(b['recoveryTypeCode'], 'recoveryTypeCode', s.correlationId),
      title: requireString(b['title'], 'title', s.correlationId),
      ...optStr(b['summary'], 'summary'),
      ...optStr(b['description'], 'description'),
      ...optStr(b['source'], 'source'),
      ...optStr(b['instrumentType'], 'instrumentType'),
      ...optStr(b['jurisdiction'], 'jurisdiction'),
      ...optStr(b['forum'], 'forum'),
      ...optStr(b['sourceProceedingId'], 'sourceProceedingId'),
      ...optStr(b['sourceMatterId'], 'sourceMatterId'),
      ...optStr(b['sourceReference'], 'sourceReference'),
      ...optStr(b['confidentiality'], 'confidentiality'),
      privileged: b['privileged'] === true,
      ...optStr(b['recoveryRisk'], 'recoveryRisk'),
      ...optStr(b['priority'], 'priority'),
      ...optNum(b['principalAmountMinor'], 'principalAmountMinor'),
      ...optNum(b['interestAmountMinor'], 'interestAmountMinor'),
      ...optNum(b['costAmountMinor'], 'costAmountMinor'),
      ...optNum(b['recoverableAmountMinor'], 'recoverableAmountMinor'),
      ...optStr(b['currency'], 'currency'),
      ...optStr(b['slaPolicyCode'], 'slaPolicyCode'),
      ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
    });
    return recoveryView(rec, true);
  }

  @Endpoint({
    permission: M17_PERMISSIONS.recoveryCreate,
    auditCode: M17_AUDIT_CODES.recoveryCreated,
    description: 'Intake a recovery from an external system.',
  })
  @Post('intake')
  async intake(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'intake recovery (m17)');
    const rec = await this.service.intakeExternal(s.ctx, s.actor.identityId, {
      source: requireString(b['source'], 'source', s.correlationId),
      externalReference: requireString(b['externalReference'], 'externalReference', s.correlationId),
      recoveryTypeCode: requireString(b['recoveryTypeCode'], 'recoveryTypeCode', s.correlationId),
      title: requireString(b['title'], 'title', s.correlationId),
      ...optStr(b['instrumentType'], 'instrumentType'),
      ...optStr(b['jurisdiction'], 'jurisdiction'),
    });
    return recoveryView(rec, true);
  }

  @Endpoint({
    permission: M17_PERMISSIONS.referralAccept,
    auditCode: M17_AUDIT_CODES.recoveryReferred,
    description: 'Accept an M16 enforcement referral (one recovery per referral key).',
  })
  @Post('from-proceeding')
  async fromProceeding(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'accept referral (m17)');
    const r = await this.service.acceptReferral(s.ctx, s.actor.identityId, {
      referralKey: requireString(b['referralKey'], 'referralKey', s.correlationId),
      sourceProceedingId: requireString(b['sourceProceedingId'], 'sourceProceedingId', s.correlationId),
      recoveryTypeCode: requireString(b['recoveryTypeCode'], 'recoveryTypeCode', s.correlationId),
      title: requireString(b['title'], 'title', s.correlationId),
      ...optStr(b['sourceMatterId'], 'sourceMatterId'),
      ...optStr(b['instrumentType'], 'instrumentType'),
      ...optStr(b['jurisdiction'], 'jurisdiction'),
      ...optStr(b['currency'], 'currency'),
      ...optNum(b['principalAmountMinor'], 'principalAmountMinor'),
      ...optStr(b['correlationId'], 'correlationId'),
      ...optStr(b['causationId'], 'causationId'),
    });
    return { recovery: recoveryView(r.recovery, true), created: r.created };
  }

  @Endpoint({
    permission: M17_PERMISSIONS.recoveryAssign,
    auditCode: M17_AUDIT_CODES.recoveryAssigned,
    description: 'Assign a recovery.',
  })
  @Post('recoveries/:id/assign')
  async assign(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'assign recovery (m17)');
    return recoveryView(
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
    permission: M17_PERMISSIONS.recoveryReassign,
    auditCode: M17_AUDIT_CODES.recoveryReassigned,
    description: 'Reassign a recovery.',
  })
  @Post('recoveries/:id/reassign')
  async reassign(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reassign recovery (m17)');
    return recoveryView(
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
    permission: M17_PERMISSIONS.recoveryUpdate,
    auditCode: M17_AUDIT_CODES.recoveryResolved,
    description: 'Advance a recovery to the next lifecycle status.',
  })
  @Post('recoveries/:id/advance')
  async advance(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'advance recovery (m17)');
    return recoveryView(
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
    permission: M17_PERMISSIONS.recoveryResolve,
    auditCode: M17_AUDIT_CODES.recoveryResolved,
    description: 'Resolve a recovery.',
  })
  @Post('recoveries/:id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'resolve recovery (m17)');
    return recoveryView(
      await this.service.resolve(
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
    permission: M17_PERMISSIONS.recoveryClose,
    auditCode: M17_AUDIT_CODES.recoveryClosed,
    description: 'Close a recovery (rule-gated).',
  })
  @Post('recoveries/:id/close')
  async close(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'close recovery (m17)');
    return recoveryView(
      await this.service.close(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['summary'], 'summary'),
        ...optStr(b['residualNote'], 'residualNote'),
        waive: b['waive'] === true,
      }),
      true,
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.recoveryReopen,
    auditCode: M17_AUDIT_CODES.recoveryReopened,
    description: 'Reopen a recovery.',
  })
  @Post('recoveries/:id/reopen')
  async reopen(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reopen recovery (m17)');
    return recoveryView(
      await this.service.reopen(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        reason: requireString(b['reason'], 'reason', s.correlationId),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.recoveryArchive,
    auditCode: M17_AUDIT_CODES.recoveryArchived,
    description: 'Archive a recovery.',
  })
  @Post('recoveries/:id/archive')
  async archive(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'archive recovery (m17)');
    return recoveryView(
      await this.service.archive(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
      ),
      true,
    );
  }

  // --- strategy ---------------------------------------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.strategyManage,
    auditCode: M17_AUDIT_CODES.strategySelected,
    description: 'Select a recovery strategy.',
  })
  @Post('recoveries/:id/strategy')
  async selectStrategy(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'select strategy (m17)');
    return strategyView(
      await this.service.selectStrategy(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        strategy: requireString(b['strategy'], 'strategy', s.correlationId),
        ...optStr(b['rationale'], 'rationale'),
        ...optStr(b['ruleEvaluationId'], 'ruleEvaluationId'),
        ...optStr(b['ruleVersion'], 'ruleVersion'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
      true,
    );
  }

  // --- parties ----------------------------------------------------------------------------------
  @Endpoint({
    permission: M17_PERMISSIONS.partyManage,
    auditCode: M17_AUDIT_CODES.partyAdded,
    description: 'Add a party.',
  })
  @Post('recoveries/:id/parties')
  async addParty(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add party (m17)');
    return partyView(
      await this.service.addParty(s.ctx, s.actor.identityId, id, {
        partyRole: requireString(b['partyRole'], 'partyRole', s.correlationId),
        ...optStr(b['entityRef'], 'entityRef'),
        ...optStr(b['displayLabel'], 'displayLabel'),
        ...optStr(b['liabilityBasis'], 'liabilityBasis'),
        ...optNum(b['liabilityAmountMinor'], 'liabilityAmountMinor'),
        ...optStr(b['contactRef'], 'contactRef'),
        ...optStr(b['addressRef'], 'addressRef'),
        ...optStr(b['authority'], 'authority'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M17_PERMISSIONS.partyManage,
    auditCode: M17_AUDIT_CODES.partyRemoved,
    description: 'Remove (deactivate) a party.',
  })
  @Post('parties/:pid/remove')
  async removeParty(
    @Param('pid') pid: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'remove party (m17)');
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
  @Get('recoveries/:id/parties')
  async listParties(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list parties (m17)');
    const { parties, canReadContact } = await this.service.listParties(s.ctx, id);
    return { parties: parties.map((p) => partyView(p, canReadContact)) };
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('recoveries/:id')
  async get(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get recovery (m17)');
    const { recovery, canReadConfidential } = await this.service.get(s.ctx, id);
    return recoveryView(recovery, canReadConfidential);
  }
  @Get('recoveries')
  async search(
    @Headers() h: Record<string, string>,
    @Query('recoveryType') recoveryType?: string,
    @Query('status') status?: string,
    @Query('recoveryRisk') recoveryRisk?: string,
    @Query('priority') priority?: string,
    @Query('jurisdiction') jurisdiction?: string,
    @Query('strategy') strategy?: string,
    @Query('owner') owner?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const s = await this.scoped(h, 'search recoveries (m17)');
    const rows = await this.service.search(s.ctx, {
      ...optStr(recoveryType, 'recoveryTypeCode'),
      ...optStr(status, 'status'),
      ...optStr(recoveryRisk, 'recoveryRisk'),
      ...optStr(priority, 'priority'),
      ...optStr(jurisdiction, 'jurisdiction'),
      ...optStr(strategy, 'strategy'),
      ...optStr(owner, 'owner'),
      limit: optionalLimit(limit, s.correlationId).limit ?? 50,
      offset: optionalOffset(offset, s.correlationId).offset ?? 0,
    });
    return { recoveries: rows.map((r) => recoveryView(r, false)) };
  }
}
