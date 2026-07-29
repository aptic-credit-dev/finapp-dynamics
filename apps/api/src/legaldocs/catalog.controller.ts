import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CatalogService, M18_AUDIT_CODES, M18_PERMISSIONS } from '@finapp/m18-legaldocs';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import {
  authorityView,
  treatmentView,
  precedentView,
  opinionView,
  researchView,
  taxonomyView,
} from './views.ts';

/**
 * Legal reference-data catalog — configurable taxonomy, authorities + append-only treatments, precedents, legal
 * opinions (register + maker-checker approval) and research, under `/api/v1/legaldocs`. Privileged/confidential
 * legal analysis (opinion question/conclusion/recommendation, precedent holding/principle, research findings,
 * authority notes) is redacted by the views — always in a list, and only surfaced on a mutation return to the
 * acting author. Permission enforced in CatalogService (default deny).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('legaldocs')
export class LegalDocsCatalogController {
  private readonly service: CatalogService;
  private readonly actors: ActorContextFactory;
  constructor(service: CatalogService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- taxonomy (configurable classification) ---------------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.taxonomyManage,
    auditCode: M18_AUDIT_CODES.taxonomyCreated,
    description: 'Create a taxonomy entry.',
  })
  @Post('taxonomy')
  async createTaxonomy(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create taxonomy (m18)');
    return taxonomyView(
      await this.service.createTaxonomy(s.ctx, s.actor.identityId, {
        kind: requireString(b['kind'], 'kind', s.correlationId),
        code: requireString(b['code'], 'code', s.correlationId),
        label: requireString(b['label'], 'label', s.correlationId),
        ...optStr(b['parentCode'], 'parentCode'),
        ...optStr(b['jurisdiction'], 'jurisdiction'),
        ...optStr(b['description'], 'description'),
      }),
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.taxonomyManage,
    auditCode: M18_AUDIT_CODES.taxonomyUpdated,
    description: 'Update a taxonomy entry.',
  })
  @Post('taxonomy/:id')
  async updateTaxonomy(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update taxonomy (m18)');
    return taxonomyView(
      await this.service.updateTaxonomy(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['label'], 'label'),
        ...optStr(b['parentCode'], 'parentCode'),
        ...optStr(b['jurisdiction'], 'jurisdiction'),
        ...optStr(b['description'], 'description'),
      }),
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.taxonomyManage,
    auditCode: M18_AUDIT_CODES.taxonomyRetired,
    description: 'Retire a taxonomy entry.',
  })
  @Post('taxonomy/:id/retire')
  async retireTaxonomy(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'retire taxonomy (m18)');
    return taxonomyView(
      await this.service.retireTaxonomy(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('taxonomy')
  async listTaxonomy(@Headers() h: Record<string, string>, @Query('kind') kind?: string) {
    const s = await this.scoped(h, 'list taxonomy (m18)');
    const rows = await this.service.listTaxonomy(s.ctx, requireString(kind, 'kind', s.correlationId));
    return { taxonomy: rows.map(taxonomyView) };
  }

  // --- authorities + treatments -----------------------------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.authorityManage,
    auditCode: M18_AUDIT_CODES.authorityRegistered,
    description: 'Register a legal authority.',
  })
  @Post('authorities')
  async registerAuthority(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register authority (m18)');
    return authorityView(
      await this.service.registerAuthority(s.ctx, s.actor.identityId, {
        authorityType: requireString(b['authorityType'], 'authorityType', s.correlationId),
        title: requireString(b['title'], 'title', s.correlationId),
        ...optStr(b['citation'], 'citation'),
        ...optStr(b['jurisdiction'], 'jurisdiction'),
        ...optStr(b['issuingBody'], 'issuingBody'),
        ...optStr(b['court'], 'court'),
        ...optStr(b['decisionDate'], 'decisionDate'),
        ...optStr(b['effectiveDate'], 'effectiveDate'),
        ...optStr(b['authorityLevel'], 'authorityLevel'),
        ...optStr(b['treatment'], 'treatment'),
        ...optStr(b['relevance'], 'relevance'),
        ...optStr(b['sourceReference'], 'sourceReference'),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['notes'], 'notes'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.authorityManage,
    auditCode: M18_AUDIT_CODES.authorityUpdated,
    description: 'Update a legal authority.',
  })
  @Post('authorities/:id')
  async updateAuthority(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update authority (m18)');
    return authorityView(
      await this.service.updateAuthority(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['title'], 'title'),
        ...optStr(b['citation'], 'citation'),
        ...optStr(b['jurisdiction'], 'jurisdiction'),
        ...optStr(b['authorityLevel'], 'authorityLevel'),
        ...optStr(b['status'], 'status'),
        ...optStr(b['treatment'], 'treatment'),
        ...optStr(b['relevance'], 'relevance'),
        ...optStr(b['notes'], 'notes'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.authorityTreat,
    auditCode: M18_AUDIT_CODES.authorityTreated,
    description: 'Record an append-only treatment against an authority.',
  })
  @Post('authorities/:id/treatments')
  async recordTreatment(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record treatment (m18)');
    return treatmentView(
      await this.service.recordTreatment(s.ctx, s.actor.identityId, id, {
        treatment: requireString(b['treatment'], 'treatment', s.correlationId),
        ...optStr(b['byAuthorityRef'], 'byAuthorityRef'),
        ...optStr(b['note'], 'note'),
      }),
    );
  }
  @Get('authorities')
  async listAuthorities(
    @Headers() h: Record<string, string>,
    @Query('authorityType') authorityType?: string,
    @Query('jurisdiction') jurisdiction?: string,
  ) {
    const s = await this.scoped(h, 'list authorities (m18)');
    const rows = await this.service.listAuthorities(s.ctx, {
      ...optStr(authorityType, 'authorityType'),
      ...optStr(jurisdiction, 'jurisdiction'),
    });
    return { authorities: rows.map((r) => authorityView(r, false)) };
  }
  @Get('authorities/:id/treatments')
  async listTreatments(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list treatments (m18)');
    return { treatments: (await this.service.listTreatments(s.ctx, id)).map(treatmentView) };
  }

  // --- precedents (holding/principle are SENSITIVE) ---------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.precedentManage,
    auditCode: M18_AUDIT_CODES.precedentRegistered,
    description: 'Register a precedent.',
  })
  @Post('precedents')
  async registerPrecedent(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register precedent (m18)');
    return precedentView(
      await this.service.registerPrecedent(s.ctx, s.actor.identityId, {
        title: requireString(b['title'], 'title', s.correlationId),
        ...optStr(b['summary'], 'summary'),
        ...optStr(b['court'], 'court'),
        ...optStr(b['decisionDate'], 'decisionDate'),
        ...optStr(b['holding'], 'holding'),
        ...optStr(b['principle'], 'principle'),
        ...optStr(b['jurisdiction'], 'jurisdiction'),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['relatedAuthority'], 'relatedAuthority'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.precedentManage,
    auditCode: M18_AUDIT_CODES.precedentUpdated,
    description: 'Update a precedent.',
  })
  @Post('precedents/:id')
  async updatePrecedent(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update precedent (m18)');
    return precedentView(
      await this.service.updatePrecedent(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['title'], 'title'),
        ...optStr(b['summary'], 'summary'),
        ...optStr(b['holding'], 'holding'),
        ...optStr(b['principle'], 'principle'),
        ...optStr(b['status'], 'status'),
      }),
      true,
    );
  }
  @Get('precedents')
  async listPrecedents(@Headers() h: Record<string, string>, @Query('jurisdiction') jurisdiction?: string) {
    const s = await this.scoped(h, 'list precedents (m18)');
    const rows = await this.service.listPrecedents(s.ctx, jurisdiction);
    return { precedents: rows.map((r) => precedentView(r, false)) };
  }

  // --- opinions (PRIVILEGED; maker-checker approval) --------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.opinionManage,
    auditCode: M18_AUDIT_CODES.opinionRegistered,
    description: 'Register a legal opinion.',
  })
  @Post('opinions')
  async registerOpinion(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register opinion (m18)');
    return opinionView(
      await this.service.registerOpinion(s.ctx, s.actor.identityId, {
        title: requireString(b['title'], 'title', s.correlationId),
        ...optStr(b['question'], 'question'),
        ...optStr(b['conclusion'], 'conclusion'),
        ...optStr(b['riskRating'], 'riskRating'),
        ...optStr(b['recommendation'], 'recommendation'),
        ...optStr(b['jurisdiction'], 'jurisdiction'),
        ...optStr(b['author'], 'author'),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['relatedMatter'], 'relatedMatter'),
        ...optStr(b['confidentiality'], 'confidentiality'),
        ...optStr(b['privilegeLevel'], 'privilegeLevel'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.opinionApprove,
    auditCode: M18_AUDIT_CODES.opinionApproved,
    description: 'Approve a legal opinion (not the author).',
  })
  @Post('opinions/:id/approve')
  async approveOpinion(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'approve opinion (m18)');
    const decision = b['decision'] === 'rejected' ? 'rejected' : 'approved';
    return opinionView(
      await this.service.approveOpinion(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        decision,
        ...optStr(b['note'], 'note'),
      }),
      true,
    );
  }
  @Get('opinions')
  async listOpinions(@Headers() h: Record<string, string>, @Query('relatedMatter') relatedMatter?: string) {
    const s = await this.scoped(h, 'list opinions (m18)');
    const rows = await this.service.listOpinions(s.ctx, relatedMatter);
    return { opinions: rows.map((r) => opinionView(r, false)) };
  }

  // --- research (findings are SENSITIVE) --------------------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.researchManage,
    auditCode: M18_AUDIT_CODES.researchRegistered,
    description: 'Register a research note.',
  })
  @Post('research')
  async registerResearch(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register research (m18)');
    return researchView(
      await this.service.registerResearch(s.ctx, s.actor.identityId, {
        title: requireString(b['title'], 'title', s.correlationId),
        ...optStr(b['question'], 'question'),
        ...optStr(b['findings'], 'findings'),
        ...optStr(b['author'], 'author'),
        ...optStr(b['jurisdiction'], 'jurisdiction'),
        ...optStr(b['practiceArea'], 'practiceArea'),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.researchManage,
    auditCode: M18_AUDIT_CODES.researchUpdated,
    description: 'Update a research note.',
  })
  @Post('research/:id')
  async updateResearch(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update research (m18)');
    return researchView(
      await this.service.updateResearch(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['title'], 'title'),
        ...optStr(b['question'], 'question'),
        ...optStr(b['findings'], 'findings'),
        ...optStr(b['status'], 'status'),
      }),
      true,
    );
  }
  @Get('research')
  async listResearch(@Headers() h: Record<string, string>, @Query('practiceArea') practiceArea?: string) {
    const s = await this.scoped(h, 'list research (m18)');
    const rows = await this.service.listResearch(s.ctx, practiceArea);
    return { research: rows.map((r) => researchView(r, false)) };
  }
}
