import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { LibraryService, M18_AUDIT_CODES, M18_PERMISSIONS } from '@finapp/m18-legaldocs';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { templateView, clauseView, clauseRelationView } from './views.ts';

/**
 * The drafting library — versioned, immutable-after-publish document TEMPLATES and the CLAUSE library (both on the
 * shared PUBLISHABLE lifecycle: create → submit → approve → publish, supersede for a new version, withdraw), both
 * maker-checker (approved_by <> submitted_by), plus the clause dependency/conflict graph — under `/api/v1/legaldocs`.
 * Document/clause BYTES live in m09 (content_ref is opaque); body/guidance text is redacted by the views unless the
 * caller holds `legaldocs.confidential.read`, and a list view never returns it. Permission enforced in LibraryService.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('legaldocs')
export class LibraryController {
  private readonly service: LibraryService;
  private readonly actors: ActorContextFactory;
  constructor(service: LibraryService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }
  private canReadConfidential(perms: readonly string[]): boolean {
    return perms.includes(M18_PERMISSIONS.confidentialRead);
  }

  // --- templates --------------------------------------------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.templateManage,
    auditCode: M18_AUDIT_CODES.templateCreated,
    description: 'Create a document template.',
  })
  @Post('templates')
  async createTemplate(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create template (m18)');
    return templateView(
      await this.service.createTemplate(s.ctx, s.actor.identityId, {
        templateCode: requireString(b['templateCode'], 'templateCode', s.correlationId),
        title: requireString(b['title'], 'title', s.correlationId),
        ...optStr(b['category'], 'category'),
        ...optStr(b['description'], 'description'),
        ...optStr(b['jurisdiction'], 'jurisdiction'),
        ...optStr(b['practiceArea'], 'practiceArea'),
        ...optStr(b['contentRef'], 'contentRef'),
        ...optStr(b['guidance'], 'guidance'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.templateManage,
    auditCode: M18_AUDIT_CODES.templateSubmitted,
    description: 'Submit a template for review.',
  })
  @Post('templates/:id/submit')
  async submitTemplate(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'submit template (m18)');
    return templateView(
      await this.service.submitTemplate(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.templateApprove,
    auditCode: M18_AUDIT_CODES.templateApproved,
    description: 'Approve a template (not the submitter).',
  })
  @Post('templates/:id/approve')
  async approveTemplate(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'approve template (m18)');
    return templateView(
      await this.service.approveTemplate(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.templatePublish,
    auditCode: M18_AUDIT_CODES.templatePublished,
    description: 'Publish an approved template.',
  })
  @Post('templates/:id/publish')
  async publishTemplate(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish template (m18)');
    return templateView(
      await this.service.publishTemplate(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.templateManage,
    auditCode: M18_AUDIT_CODES.templateWithdrawn,
    description: 'Withdraw a template.',
  })
  @Post('templates/:id/withdraw')
  async withdrawTemplate(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'withdraw template (m18)');
    return templateView(
      await this.service.withdrawTemplate(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['reason'], 'reason'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.templatePublish,
    auditCode: M18_AUDIT_CODES.templateSuperseded,
    description: 'Supersede a published template with a new version.',
  })
  @Post('templates/:id/supersede')
  async supersedeTemplate(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'supersede template (m18)');
    const r = await this.service.supersedeTemplate(s.ctx, s.actor.identityId, id, {
      expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
      ...optStr(b['title'], 'title'),
      ...optStr(b['contentRef'], 'contentRef'),
      ...optStr(b['guidance'], 'guidance'),
      ...optStr(b['submittedBy'], 'submittedBy'),
    });
    return { prior: templateView(r.prior, true), successor: templateView(r.successor, true) };
  }
  @Get('templates')
  async listTemplates(@Headers() h: Record<string, string>, @Query('category') category?: string) {
    const s = await this.scoped(h, 'list templates (m18)');
    const rows = await this.service.listTemplates(s.ctx, category);
    return { templates: rows.map((r) => templateView(r, false)) };
  }
  @Get('templates/:id')
  async getTemplate(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get template (m18)');
    const row = await this.service.getTemplate(s.ctx, id);
    return templateView(row, this.canReadConfidential(s.ctx.permissions));
  }

  // --- clauses ----------------------------------------------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.clauseManage,
    auditCode: M18_AUDIT_CODES.clauseCreated,
    description: 'Create a library clause.',
  })
  @Post('clauses')
  async createClause(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create clause (m18)');
    return clauseView(
      await this.service.createClause(s.ctx, s.actor.identityId, {
        clauseCode: requireString(b['clauseCode'], 'clauseCode', s.correlationId),
        title: requireString(b['title'], 'title', s.correlationId),
        ...optStr(b['clauseKind'], 'clauseKind'),
        ...optStr(b['category'], 'category'),
        ...optStr(b['jurisdiction'], 'jurisdiction'),
        ...optStr(b['practiceArea'], 'practiceArea'),
        ...optStr(b['guidance'], 'guidance'),
        ...optStr(b['contentRef'], 'contentRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.clauseManage,
    auditCode: M18_AUDIT_CODES.clauseSubmitted,
    description: 'Submit a clause for review.',
  })
  @Post('clauses/:id/submit')
  async submitClause(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'submit clause (m18)');
    return clauseView(
      await this.service.submitClause(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.clauseApprove,
    auditCode: M18_AUDIT_CODES.clauseApproved,
    description: 'Approve a clause (not the submitter).',
  })
  @Post('clauses/:id/approve')
  async approveClause(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'approve clause (m18)');
    return clauseView(
      await this.service.approveClause(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.clausePublish,
    auditCode: M18_AUDIT_CODES.clausePublished,
    description: 'Publish an approved clause.',
  })
  @Post('clauses/:id/publish')
  async publishClause(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish clause (m18)');
    return clauseView(
      await this.service.publishClause(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.clauseManage,
    auditCode: M18_AUDIT_CODES.clauseWithdrawn,
    description: 'Withdraw a clause.',
  })
  @Post('clauses/:id/withdraw')
  async withdrawClause(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'withdraw clause (m18)');
    return clauseView(
      await this.service.withdrawClause(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['reason'], 'reason'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.clausePublish,
    auditCode: M18_AUDIT_CODES.clauseSuperseded,
    description: 'Supersede a published clause with a new version.',
  })
  @Post('clauses/:id/supersede')
  async supersedeClause(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'supersede clause (m18)');
    const r = await this.service.supersedeClause(s.ctx, s.actor.identityId, id, {
      expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
      ...optStr(b['title'], 'title'),
      ...optStr(b['contentRef'], 'contentRef'),
      ...optStr(b['guidance'], 'guidance'),
      ...optStr(b['submittedBy'], 'submittedBy'),
    });
    return { prior: clauseView(r.prior, true), successor: clauseView(r.successor, true) };
  }
  @Get('clauses')
  async listClauses(
    @Headers() h: Record<string, string>,
    @Query('clauseKind') clauseKind?: string,
    @Query('category') category?: string,
  ) {
    const s = await this.scoped(h, 'list clauses (m18)');
    const rows = await this.service.listClauses(s.ctx, {
      ...optStr(clauseKind, 'clauseKind'),
      ...optStr(category, 'category'),
    });
    return { clauses: rows.map((r) => clauseView(r, false)) };
  }
  @Get('clauses/:id')
  async getClause(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get clause (m18)');
    const row = await this.service.getClause(s.ctx, id);
    return clauseView(row, this.canReadConfidential(s.ctx.permissions));
  }

  // --- clause relations (dependency / conflict graph) -------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.clauseManage,
    auditCode: M18_AUDIT_CODES.clauseRelationCreated,
    description: 'Relate two clauses (dependency/conflict).',
  })
  @Post('clause-relations')
  async addClauseRelation(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'add clause relation (m18)');
    return clauseRelationView(
      await this.service.addClauseRelation(s.ctx, s.actor.identityId, {
        fromClauseId: requireString(b['fromClauseId'], 'fromClauseId', s.correlationId),
        toClauseId: requireString(b['toClauseId'], 'toClauseId', s.correlationId),
        kind: requireString(b['kind'], 'kind', s.correlationId),
      }),
    );
  }
  @Get('clauses/:id/relations')
  async listClauseRelations(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list clause relations (m18)');
    return { relations: (await this.service.listClauseRelations(s.ctx, id)).map(clauseRelationView) };
  }
}
