import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CaseService, M13_AUDIT_CODES, M13_PERMISSIONS } from '@finapp/m13-case';
import { ActorContextFactory } from '@finapp/m02-identity';
import {
  optionalLimit,
  optionalOffset,
  requireString,
  requireTenantScope,
  requireVersion,
} from '../identity/http.ts';
import { caseView } from './views.ts';

/**
 * Case intake + lifecycle, under `/api/v1/cases`. Idempotency by the `idempotency-key` header. The M12 handoff is
 * idempotent (one case per handoff). Confidential cases are redacted by the view unless the caller holds
 * `cases.confidential.read`. Permission enforced in CaseService (default deny).
 */
interface CreateBody {
  caseTypeCode?: unknown;
  title?: unknown;
  summary?: unknown;
  description?: unknown;
  source?: unknown;
  customerRef?: unknown;
  subjectRef?: unknown;
  productRef?: unknown;
  branch?: unknown;
  department?: unknown;
  confidentiality?: unknown;
  severity?: unknown;
  priority?: unknown;
  slaPolicyCode?: unknown;
}
interface IntakeBody {
  source?: unknown;
  externalReference?: unknown;
  caseTypeCode?: unknown;
  title?: unknown;
  customerRef?: unknown;
  product?: unknown;
  branch?: unknown;
  department?: unknown;
  payloadHash?: unknown;
}
interface HandoffBody {
  handoffId?: unknown;
  caseTypeCode?: unknown;
  title?: unknown;
  confidentiality?: unknown;
  priority?: unknown;
}
interface TriageBody {
  expectedVersion?: unknown;
  severity?: unknown;
  priority?: unknown;
  confidentiality?: unknown;
  riskRating?: unknown;
  recommendedTeam?: unknown;
  recommendedSlaPolicy?: unknown;
  legalStatus?: unknown;
  ruleEvaluationId?: unknown;
}
interface AssignBody {
  expectedVersion?: unknown;
  owner?: unknown;
  kind?: unknown;
  team?: unknown;
  reason?: unknown;
  delegation?: unknown;
}
interface ActionBody {
  expectedVersion?: unknown;
  reason?: unknown;
  summary?: unknown;
  residualRisk?: unknown;
  waive?: unknown;
  recommendedMatterType?: unknown;
}

function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('cases')
export class CasesController {
  private readonly service: CaseService;
  private readonly actors: ActorContextFactory;
  constructor(service: CaseService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M13_PERMISSIONS.caseCreate,
    auditCode: M13_AUDIT_CODES.caseCreated,
    description: 'Create a case.',
  })
  @Post()
  async create(@Body() b: CreateBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create case (m13)');
    const idem = h['idempotency-key'];
    const c = await this.service.create(s.ctx, s.actor.identityId, {
      caseTypeCode: requireString(b.caseTypeCode, 'caseTypeCode', s.correlationId),
      title: requireString(b.title, 'title', s.correlationId),
      ...optStr(b.summary, 'summary'),
      ...optStr(b.description, 'description'),
      ...optStr(b.source, 'source'),
      ...optStr(b.customerRef, 'customerRef'),
      ...optStr(b.subjectRef, 'subjectRef'),
      ...optStr(b.productRef, 'productRef'),
      ...optStr(b.branch, 'branch'),
      ...optStr(b.department, 'department'),
      ...optStr(b.confidentiality, 'confidentiality'),
      ...optStr(b.severity, 'severity'),
      ...optStr(b.priority, 'priority'),
      ...optStr(b.slaPolicyCode, 'slaPolicyCode'),
      ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
    });
    return caseView(c, true);
  }

  @Endpoint({
    permission: M13_PERMISSIONS.intakeCreate,
    auditCode: M13_AUDIT_CODES.caseCreated,
    description: 'Intake a case from an external system.',
  })
  @Post('intake')
  async intake(@Body() b: IntakeBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'intake case (m13)');
    const c = await this.service.intakeExternal(s.ctx, s.actor.identityId, {
      source: requireString(b.source, 'source', s.correlationId),
      externalReference: requireString(b.externalReference, 'externalReference', s.correlationId),
      caseTypeCode: requireString(b.caseTypeCode, 'caseTypeCode', s.correlationId),
      title: requireString(b.title, 'title', s.correlationId),
      ...optStr(b.customerRef, 'customerRef'),
      ...optStr(b.product, 'product'),
      ...optStr(b.branch, 'branch'),
      ...optStr(b.department, 'department'),
    });
    return caseView(c, true);
  }

  @Endpoint({
    permission: M13_PERMISSIONS.handoffAccept,
    auditCode: M13_AUDIT_CODES.handoffConsumed,
    description: 'Accept an M12 feedback handoff (one case per handoff).',
  })
  @Post('handoff')
  async handoff(@Body() b: HandoffBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'accept handoff (m13)');
    const r = await this.service.acceptHandoff(s.ctx, s.actor.identityId, {
      handoffId: requireString(b.handoffId, 'handoffId', s.correlationId),
      caseTypeCode: requireString(b.caseTypeCode, 'caseTypeCode', s.correlationId),
      title: requireString(b.title, 'title', s.correlationId),
      ...optStr(b.confidentiality, 'confidentiality'),
      ...optStr(b.priority, 'priority'),
    });
    return { case: caseView(r.case, true), created: r.created };
  }

  @Endpoint({
    permission: M13_PERMISSIONS.caseOpen,
    auditCode: M13_AUDIT_CODES.caseOpened,
    description: 'Open a case.',
  })
  @Post(':id/open')
  async open(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'open case (m13)');
    return caseView(
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
    permission: M13_PERMISSIONS.caseTriage,
    auditCode: M13_AUDIT_CODES.triageCompleted,
    description: 'Triage a case.',
  })
  @Post(':id/triage')
  async triage(@Param('id') id: string, @Body() b: TriageBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'triage case (m13)');
    return caseView(
      await this.service.triage(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
        ...optStr(b.severity, 'severity'),
        ...optStr(b.priority, 'priority'),
        ...optStr(b.confidentiality, 'confidentiality'),
        ...optStr(b.riskRating, 'riskRating'),
        ...optStr(b.recommendedTeam, 'recommendedTeam'),
        ...optStr(b.recommendedSlaPolicy, 'recommendedSlaPolicy'),
        ...optStr(b.legalStatus, 'legalStatus'),
        ...optStr(b.ruleEvaluationId, 'ruleEvaluationId'),
      }),
      true,
    );
  }

  @Endpoint({
    permission: M13_PERMISSIONS.caseAssign,
    auditCode: M13_AUDIT_CODES.caseAssigned,
    description: 'Assign a case.',
  })
  @Post(':id/assign')
  async assign(@Param('id') id: string, @Body() b: AssignBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'assign case (m13)');
    return caseView(
      await this.service.assign(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
        owner: requireString(b.owner, 'owner', s.correlationId),
        ...optStr(b.kind, 'kind'),
        ...optStr(b.team, 'team'),
        ...optStr(b.reason, 'reason'),
        delegation: b.delegation === true,
      }),
      true,
    );
  }

  @Endpoint({
    permission: M13_PERMISSIONS.caseReassign,
    auditCode: M13_AUDIT_CODES.caseReassigned,
    description: 'Reassign a case.',
  })
  @Post(':id/reassign')
  async reassign(@Param('id') id: string, @Body() b: AssignBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'reassign case (m13)');
    return caseView(
      await this.service.assign(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
        owner: requireString(b.owner, 'owner', s.correlationId),
        reassign: true,
        ...optStr(b.kind, 'kind'),
        ...optStr(b.team, 'team'),
        ...optStr(b.reason, 'reason'),
      }),
      true,
    );
  }

  @Endpoint({
    permission: M13_PERMISSIONS.caseResolve,
    auditCode: M13_AUDIT_CODES.caseResolved,
    description: 'Resolve a case.',
  })
  @Post(':id/resolve')
  async resolve(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'resolve case (m13)');
    return caseView(
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
    permission: M13_PERMISSIONS.caseClose,
    auditCode: M13_AUDIT_CODES.caseClosed,
    description: 'Close a case (rule-gated).',
  })
  @Post(':id/close')
  async close(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'close case (m13)');
    return caseView(
      await this.service.close(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
        ...optStr(b.summary, 'summary'),
        ...optStr(b.residualRisk, 'residualRisk'),
        waive: b.waive === true,
      }),
      true,
    );
  }

  @Endpoint({
    permission: M13_PERMISSIONS.caseReopen,
    auditCode: M13_AUDIT_CODES.caseReopened,
    description: 'Reopen a case.',
  })
  @Post(':id/reopen')
  async reopen(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'reopen case (m13)');
    return caseView(
      await this.service.reopen(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
        reason: requireString(b.reason, 'reason', s.correlationId),
      }),
      true,
    );
  }

  @Endpoint({
    permission: M13_PERMISSIONS.caseArchive,
    auditCode: M13_AUDIT_CODES.caseArchived,
    description: 'Archive a closed case.',
  })
  @Post(':id/archive')
  async archive(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'archive case (m13)');
    return caseView(
      await this.service.archive(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
      true,
    );
  }

  @Endpoint({
    permission: M13_PERMISSIONS.legalManage,
    auditCode: M13_AUDIT_CODES.convertedToMatter,
    description: 'Convert a case to an m14 legal matter.',
  })
  @Post(':id/convert-to-matter')
  async convert(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'convert to matter (m13)');
    return caseView(
      await this.service.convertToMatter(s.ctx, s.actor.identityId, id, {
        ...optStr(b.recommendedMatterType, 'recommendedMatterType'),
        ...optStr(b.reason, 'reason'),
      }),
      true,
    );
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get(':id')
  async get(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get case (m13)');
    const { case: c, canReadConfidential } = await this.service.get(s.ctx, id);
    return caseView(c, canReadConfidential);
  }

  @Get()
  async search(
    @Headers() h: Record<string, string>,
    @Query('caseType') caseType?: string,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('priority') priority?: string,
    @Query('branch') branch?: string,
    @Query('owner') owner?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const s = await this.scoped(h, 'search cases (m13)');
    const rows = await this.service.search(s.ctx, {
      ...optStr(caseType, 'caseTypeCode'),
      ...optStr(status, 'status'),
      ...optStr(severity, 'severity'),
      ...optStr(priority, 'priority'),
      ...optStr(branch, 'branch'),
      ...optStr(owner, 'owner'),
      limit: optionalLimit(limit, s.correlationId).limit ?? 50,
      offset: optionalOffset(offset, s.correlationId).offset ?? 0,
    });
    return { cases: rows.map((r) => caseView(r, false)) };
  }
}
