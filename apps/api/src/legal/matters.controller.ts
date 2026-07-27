import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { MatterService, M14_AUDIT_CODES, M14_PERMISSIONS } from '@finapp/m14-legal';
import { ActorContextFactory } from '@finapp/m02-identity';
import {
  optionalLimit,
  optionalOffset,
  requireString,
  requireTenantScope,
  requireVersion,
} from '../identity/http.ts';
import { matterView, instructionView } from './views.ts';

/**
 * Legal matter intake + lifecycle + instructions, under `/api/v1/legal`. The M13 conversion is idempotent (one
 * matter per source case). Confidential/privileged matters are redacted by the view unless the caller holds
 * `legal.confidential.read`. Permission enforced in MatterService (default deny).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('legal')
export class MattersController {
  private readonly service: MatterService;
  private readonly actors: ActorContextFactory;
  constructor(service: MatterService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M14_PERMISSIONS.matterCreate,
    auditCode: M14_AUDIT_CODES.matterCreated,
    description: 'Create a legal matter.',
  })
  @Post('matters')
  async create(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create matter (m14)');
    const idem = h['idempotency-key'];
    const m = await this.service.create(s.ctx, s.actor.identityId, {
      matterTypeCode: requireString(b['matterTypeCode'], 'matterTypeCode', s.correlationId),
      title: requireString(b['title'], 'title', s.correlationId),
      ...optStr(b['summary'], 'summary'),
      ...optStr(b['legalDescription'], 'legalDescription'),
      ...optStr(b['source'], 'source'),
      ...optStr(b['jurisdiction'], 'jurisdiction'),
      ...optStr(b['forum'], 'forum'),
      ...optStr(b['confidentiality'], 'confidentiality'),
      privileged: b['privileged'] === true,
      ...optStr(b['legalRisk'], 'legalRisk'),
      ...optStr(b['priority'], 'priority'),
      ...optStr(b['branch'], 'branch'),
      ...optStr(b['department'], 'department'),
      ...optStr(b['slaPolicyCode'], 'slaPolicyCode'),
      ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
    });
    return matterView(m, true);
  }

  @Endpoint({
    permission: M14_PERMISSIONS.matterCreate,
    auditCode: M14_AUDIT_CODES.matterCreated,
    description: 'Intake a matter from an external system.',
  })
  @Post('intake')
  async intake(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'intake matter (m14)');
    const m = await this.service.intakeExternal(s.ctx, s.actor.identityId, {
      source: requireString(b['source'], 'source', s.correlationId),
      externalReference: requireString(b['externalReference'], 'externalReference', s.correlationId),
      matterTypeCode: requireString(b['matterTypeCode'], 'matterTypeCode', s.correlationId),
      title: requireString(b['title'], 'title', s.correlationId),
      ...optStr(b['jurisdiction'], 'jurisdiction'),
      ...optStr(b['branch'], 'branch'),
      ...optStr(b['department'], 'department'),
    });
    return matterView(m, true);
  }

  @Endpoint({
    permission: M14_PERMISSIONS.conversionAccept,
    auditCode: M14_AUDIT_CODES.matterConverted,
    description: 'Accept an M13 case conversion (one matter per case).',
  })
  @Post('from-case')
  async fromCase(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'accept conversion (m14)');
    const r = await this.service.acceptConversion(s.ctx, s.actor.identityId, {
      sourceCaseId: requireString(b['sourceCaseId'], 'sourceCaseId', s.correlationId),
      matterTypeCode: requireString(b['matterTypeCode'], 'matterTypeCode', s.correlationId),
      title: requireString(b['title'], 'title', s.correlationId),
      ...optStr(b['recommendedMatterType'], 'recommendedMatterType'),
      ...optStr(b['legalStatus'], 'legalStatus'),
      ...optStr(b['courtReference'], 'courtReference'),
    });
    return { matter: matterView(r.matter, true), created: r.created };
  }

  @Endpoint({
    permission: M14_PERMISSIONS.instructionCreate,
    auditCode: M14_AUDIT_CODES.instructionReceived,
    description: 'Add a legal instruction.',
  })
  @Post('matters/:id/instructions')
  async addInstruction(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add instruction (m14)');
    return instructionView(
      await this.service.addInstruction(s.ctx, s.actor.identityId, id, {
        ...optStr(b['instructionType'], 'instructionType'),
        ...optStr(b['instructingDepartment'], 'instructingDepartment'),
        ...optStr(b['summary'], 'summary'),
        ...optStr(b['scope'], 'scope'),
        ...optStr(b['desiredOutcome'], 'desiredOutcome'),
        ...optStr(b['urgency'], 'urgency'),
        ...optStr(b['requiredAction'], 'requiredAction'),
        ...optStr(b['confidentiality'], 'confidentiality'),
        privileged: b['privileged'] === true,
      }),
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.instructionAccept,
    auditCode: M14_AUDIT_CODES.instructionAccepted,
    description: 'Accept a legal instruction.',
  })
  @Post('instructions/:iid/accept')
  async acceptInstruction(
    @Param('iid') iid: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'accept instruction (m14)');
    return instructionView(
      await this.service.decideInstruction(s.ctx, s.actor.identityId, iid, {
        expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
        accept: true,
      }),
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.instructionReject,
    auditCode: M14_AUDIT_CODES.instructionRejected,
    description: 'Reject a legal instruction.',
  })
  @Post('instructions/:iid/reject')
  async rejectInstruction(
    @Param('iid') iid: string,
    @Body() b: { expectedVersion?: unknown; reason?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reject instruction (m14)');
    return instructionView(
      await this.service.decideInstruction(s.ctx, s.actor.identityId, iid, {
        expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
        accept: false,
        rejectionReason: requireString(b.reason, 'reason', s.correlationId),
      }),
    );
  }
  @Get('matters/:id/instructions')
  async listInstructions(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list instructions (m14)');
    return { instructions: (await this.service.listInstructions(s.ctx, id)).map(instructionView) };
  }

  @Endpoint({
    permission: M14_PERMISSIONS.matterOpen,
    auditCode: M14_AUDIT_CODES.matterOpened,
    description: 'Open a matter.',
  })
  @Post('matters/:id/open')
  async open(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'open matter (m14)');
    return matterView(
      await this.service.open(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
      true,
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.matterAssign,
    auditCode: M14_AUDIT_CODES.matterAssigned,
    description: 'Assign a matter.',
  })
  @Post('matters/:id/assign')
  async assign(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'assign matter (m14)');
    return matterView(
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
    permission: M14_PERMISSIONS.matterReassign,
    auditCode: M14_AUDIT_CODES.matterReassigned,
    description: 'Reassign a matter.',
  })
  @Post('matters/:id/reassign')
  async reassign(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reassign matter (m14)');
    return matterView(
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
    permission: M14_PERMISSIONS.matterResolve,
    auditCode: M14_AUDIT_CODES.matterResolved,
    description: 'Resolve a matter.',
  })
  @Post('matters/:id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown; summary?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'resolve matter (m14)');
    return matterView(
      await this.service.resolve(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
        typeof b.summary === 'string' ? b.summary : null,
      ),
      true,
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.matterClose,
    auditCode: M14_AUDIT_CODES.matterClosed,
    description: 'Close a matter (rule-gated).',
  })
  @Post('matters/:id/close')
  async close(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'close matter (m14)');
    return matterView(
      await this.service.close(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['summary'], 'summary'),
        ...optStr(b['residualRisk'], 'residualRisk'),
        waive: b['waive'] === true,
      }),
      true,
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.matterReopen,
    auditCode: M14_AUDIT_CODES.matterReopened,
    description: 'Reopen a matter.',
  })
  @Post('matters/:id/reopen')
  async reopen(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown; reason?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reopen matter (m14)');
    return matterView(
      await this.service.reopen(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
        reason: requireString(b.reason, 'reason', s.correlationId),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.matterArchive,
    auditCode: M14_AUDIT_CODES.matterArchived,
    description: 'Archive a matter.',
  })
  @Post('matters/:id/archive')
  async archive(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'archive matter (m14)');
    return matterView(
      await this.service.archive(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
      true,
    );
  }

  @Get('matters/:id')
  async get(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get matter (m14)');
    const { matter, canReadConfidential } = await this.service.get(s.ctx, id);
    return matterView(matter, canReadConfidential);
  }
  @Get('matters')
  async search(
    @Headers() h: Record<string, string>,
    @Query('matterType') matterType?: string,
    @Query('status') status?: string,
    @Query('legalRisk') legalRisk?: string,
    @Query('jurisdiction') jurisdiction?: string,
    @Query('owner') owner?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const s = await this.scoped(h, 'search matters (m14)');
    const rows = await this.service.search(s.ctx, {
      ...optStr(matterType, 'matterTypeCode'),
      ...optStr(status, 'status'),
      ...optStr(legalRisk, 'legalRisk'),
      ...optStr(jurisdiction, 'jurisdiction'),
      ...optStr(owner, 'owner'),
      limit: optionalLimit(limit, s.correlationId).limit ?? 50,
      offset: optionalOffset(offset, s.correlationId).offset ?? 0,
    });
    return { matters: rows.map((r) => matterView(r, false)) };
  }
}
