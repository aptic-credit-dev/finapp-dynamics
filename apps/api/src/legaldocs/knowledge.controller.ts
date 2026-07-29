import { Body, Controller, Delete, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { KnowledgeService, M18_AUDIT_CODES, M18_PERMISSIONS, type ReviewRule } from '@finapp/m18-legaldocs';
import { ActorContextFactory } from '@finapp/m02-identity';
import {
  optionalLimit,
  optionalOffset,
  requireString,
  requireTenantScope,
  requireVersion,
} from '../identity/http.ts';
import {
  knowledgeView,
  referenceView,
  relationshipView,
  reviewView,
  tagView,
  citationView,
  noteView,
  usageView,
} from './views.ts';

/**
 * The core legal knowledge record and everything hung off it — creation, content edits, owner/reviewer/approver
 * assignment, classification changes, the full PUBLISHABLE lifecycle (submit → review → request-changes → approve →
 * publish, supersede for a new version, withdraw/archive/reopen), opaque cross-module references, knowledge-to-
 * knowledge relationships, tags, citations, notes (privileged redaction), review/expiry deadlines, usage analytics,
 * keyword search and dimension analytics — under `/api/v1/legaldocs`. The sensitive `abstract` is redacted by the
 * view unless the caller holds `legaldocs.confidential.read`; restricted note bodies unless `legaldocs.privileged.read`;
 * a list view never returns privileged content. Permission enforced in KnowledgeService (default deny).
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

@Controller('legaldocs')
export class KnowledgeController {
  private readonly service: KnowledgeService;
  private readonly actors: ActorContextFactory;
  constructor(service: KnowledgeService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- create / edit ----------------------------------------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.knowledgeCreate,
    auditCode: M18_AUDIT_CODES.knowledgeCreated,
    description: 'Create a legal knowledge record.',
  })
  @Post('knowledge')
  async create(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create knowledge (m18)');
    const idem = h['idempotency-key'];
    return knowledgeView(
      await this.service.create(s.ctx, s.actor.identityId, {
        knowledgeType: requireString(b['knowledgeType'], 'knowledgeType', s.correlationId),
        title: requireString(b['title'], 'title', s.correlationId),
        ...optStr(b['summary'], 'summary'),
        ...optStr(b['abstract'], 'abstract'),
        ...optStr(b['practiceArea'], 'practiceArea'),
        ...optStr(b['jurisdiction'], 'jurisdiction'),
        ...optStr(b['authorityLevel'], 'authorityLevel'),
        ...optStr(b['confidentiality'], 'confidentiality'),
        privileged: b['privileged'] === true,
        ...optStr(b['privilegeLevel'], 'privilegeLevel'),
        ...optStr(b['riskLevel'], 'riskLevel'),
        ...optStr(b['source'], 'source'),
        ...optStr(b['sourceReference'], 'sourceReference'),
        ...optStr(b['owner'], 'owner'),
        ...optStr(b['effectiveDate'], 'effectiveDate'),
        ...optStr(b['reviewDate'], 'reviewDate'),
        ...optStr(b['expiryDate'], 'expiryDate'),
        ...optStr(b['knowledgeCode'], 'knowledgeCode'),
        ...optStr(b['causationId'], 'causationId'),
        ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.knowledgeUpdate,
    auditCode: M18_AUDIT_CODES.knowledgeUpdated,
    description: 'Edit a draft/changes-requested knowledge record.',
  })
  @Post('knowledge/:id')
  async update(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update knowledge (m18)');
    return knowledgeView(
      await this.service.update(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['title'], 'title'),
        ...optStr(b['summary'], 'summary'),
        ...optStr(b['abstract'], 'abstract'),
        ...optStr(b['knowledgeType'], 'knowledgeType'),
        ...optStr(b['practiceArea'], 'practiceArea'),
        ...optStr(b['jurisdiction'], 'jurisdiction'),
        ...optStr(b['authorityLevel'], 'authorityLevel'),
        ...optStr(b['riskLevel'], 'riskLevel'),
        ...optStr(b['source'], 'source'),
        ...optStr(b['sourceReference'], 'sourceReference'),
        ...optStr(b['effectiveDate'], 'effectiveDate'),
        ...optStr(b['reviewDate'], 'reviewDate'),
        ...optStr(b['expiryDate'], 'expiryDate'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.knowledgeAssign,
    auditCode: M18_AUDIT_CODES.knowledgeAssigned,
    description: 'Assign owner/reviewer/approver.',
  })
  @Post('knowledge/:id/assign')
  async assign(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'assign knowledge (m18)');
    return knowledgeView(
      await this.service.assign(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['owner'], 'owner'),
        ...optStr(b['reviewer'], 'reviewer'),
        ...optStr(b['approver'], 'approver'),
        ...optStr(b['reason'], 'reason'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.knowledgeUpdate,
    auditCode: M18_AUDIT_CODES.classificationChanged,
    description: 'Change confidentiality/privilege classification.',
  })
  @Post('knowledge/:id/classification')
  async changeClassification(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'change classification (m18)');
    return knowledgeView(
      await this.service.changeClassification(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['confidentiality'], 'confidentiality'),
        ...optBool(b['privileged'], 'privileged'),
        ...optStr(b['privilegeLevel'], 'privilegeLevel'),
      }),
      true,
    );
  }

  // --- lifecycle --------------------------------------------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.knowledgeSubmit,
    auditCode: M18_AUDIT_CODES.knowledgeSubmitted,
    description: 'Submit a knowledge record for review.',
  })
  @Post('knowledge/:id/submit')
  async submit(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'submit knowledge (m18)');
    return knowledgeView(
      await this.service.submit(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.knowledgeReview,
    auditCode: M18_AUDIT_CODES.knowledgeReviewed,
    description: 'Return a record to the author after review.',
  })
  @Post('knowledge/:id/review')
  async review(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'review knowledge (m18)');
    return knowledgeView(
      await this.service.review(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.knowledgeReview,
    auditCode: M18_AUDIT_CODES.knowledgeChangesRequested,
    description: 'Request changes on a submitted record.',
  })
  @Post('knowledge/:id/request-changes')
  async requestChanges(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'request changes (m18)');
    return knowledgeView(
      await this.service.requestChanges(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        reason: requireString(b['reason'], 'reason', s.correlationId),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.knowledgeApprove,
    auditCode: M18_AUDIT_CODES.knowledgeApproved,
    description: 'Approve a knowledge record (not the submitter).',
  })
  @Post('knowledge/:id/approve')
  async approve(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'approve knowledge (m18)');
    return knowledgeView(
      await this.service.approve(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.knowledgePublish,
    auditCode: M18_AUDIT_CODES.knowledgePublished,
    description: 'Publish an approved knowledge record.',
  })
  @Post('knowledge/:id/publish')
  async publish(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish knowledge (m18)');
    return knowledgeView(
      await this.service.publish(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.knowledgeSupersede,
    auditCode: M18_AUDIT_CODES.knowledgeSuperseded,
    description: 'Supersede a published record with a new version.',
  })
  @Post('knowledge/:id/supersede')
  async supersede(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'supersede knowledge (m18)');
    const r = await this.service.supersede(s.ctx, s.actor.identityId, id, {
      expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
      ...optStr(b['title'], 'title'),
      ...optStr(b['summary'], 'summary'),
      ...optStr(b['abstract'], 'abstract'),
      ...optStr(b['submittedBy'], 'submittedBy'),
    });
    return { prior: knowledgeView(r.prior, true), successor: knowledgeView(r.successor, true) };
  }
  @Endpoint({
    permission: M18_PERMISSIONS.knowledgeWithdraw,
    auditCode: M18_AUDIT_CODES.knowledgeWithdrawn,
    description: 'Withdraw a knowledge record.',
  })
  @Post('knowledge/:id/withdraw')
  async withdraw(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'withdraw knowledge (m18)');
    return knowledgeView(
      await this.service.withdraw(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['reason'], 'reason'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.knowledgeArchive,
    auditCode: M18_AUDIT_CODES.knowledgeArchived,
    description: 'Archive a knowledge record.',
  })
  @Post('knowledge/:id/archive')
  async archive(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'archive knowledge (m18)');
    return knowledgeView(
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
    permission: M18_PERMISSIONS.knowledgeReopen,
    auditCode: M18_AUDIT_CODES.knowledgeReopened,
    description: 'Reopen a terminal knowledge record.',
  })
  @Post('knowledge/:id/reopen')
  async reopen(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reopen knowledge (m18)');
    return knowledgeView(
      await this.service.reopen(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        reason: requireString(b['reason'], 'reason', s.correlationId),
      }),
      true,
    );
  }

  // --- references (opaque cross-module ids) -----------------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.referenceManage,
    auditCode: M18_AUDIT_CODES.referenceLinked,
    description: 'Link an opaque cross-module reference (m09/m14/m16/m17).',
  })
  @Post('knowledge/:id/references')
  async addReference(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add reference (m18)');
    return referenceView(
      await this.service.addReference(s.ctx, s.actor.identityId, id, {
        refType: requireString(b['refType'], 'refType', s.correlationId),
        targetId: requireString(b['targetId'], 'targetId', s.correlationId),
        ...optStr(b['label'], 'label'),
      }),
    );
  }
  @Get('knowledge/:id/references')
  async listReferences(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list references (m18)');
    return { references: (await this.service.listReferences(s.ctx, id)).map(referenceView) };
  }

  // --- relationships (knowledge <-> knowledge) --------------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.relationshipManage,
    auditCode: M18_AUDIT_CODES.relationshipCreated,
    description: 'Relate two knowledge records.',
  })
  @Post('relationships')
  async relate(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'relate knowledge (m18)');
    return relationshipView(
      await this.service.relate(s.ctx, s.actor.identityId, {
        fromKnowledgeId: requireString(b['fromKnowledgeId'], 'fromKnowledgeId', s.correlationId),
        toKnowledgeId: requireString(b['toKnowledgeId'], 'toKnowledgeId', s.correlationId),
        kind: requireString(b['kind'], 'kind', s.correlationId),
      }),
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.relationshipManage,
    auditCode: M18_AUDIT_CODES.relationshipRetired,
    description: 'Retire a knowledge relationship.',
  })
  @Post('relationships/:rid/retire')
  async retireRelationship(
    @Param('rid') rid: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'retire relationship (m18)');
    return relationshipView(
      await this.service.retireRelationship(
        s.ctx,
        s.actor.identityId,
        rid,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('knowledge/:id/relationships')
  async listRelationships(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list relationships (m18)');
    return { relationships: (await this.service.listRelationships(s.ctx, id)).map(relationshipView) };
  }

  // --- tags -------------------------------------------------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.tagManage,
    auditCode: M18_AUDIT_CODES.tagAdded,
    description: 'Add a taxonomy tag.',
  })
  @Post('knowledge/:id/tags')
  async addTag(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add tag (m18)');
    return tagView(
      await this.service.addTag(s.ctx, s.actor.identityId, id, {
        taxonomyKind: requireString(b['taxonomyKind'], 'taxonomyKind', s.correlationId),
        taxonomyCode: requireString(b['taxonomyCode'], 'taxonomyCode', s.correlationId),
        ...optStr(b['label'], 'label'),
      }),
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.tagManage,
    auditCode: M18_AUDIT_CODES.tagRemoved,
    description: 'Remove (soft-delete) a taxonomy tag.',
  })
  @Delete('knowledge/:id/tags')
  async removeTag(
    @Param('id') id: string,
    @Headers() h: Record<string, string>,
    @Query('taxonomyKind') taxonomyKind?: string,
    @Query('taxonomyCode') taxonomyCode?: string,
  ) {
    const s = await this.scoped(h, 'remove tag (m18)');
    await this.service.removeTag(s.ctx, s.actor.identityId, id, {
      taxonomyKind: requireString(taxonomyKind, 'taxonomyKind', s.correlationId),
      taxonomyCode: requireString(taxonomyCode, 'taxonomyCode', s.correlationId),
    });
    return { removed: true };
  }
  @Get('knowledge/:id/tags')
  async listTags(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list tags (m18)');
    return { tags: (await this.service.listTags(s.ctx, id)).map(tagView) };
  }

  // --- citations --------------------------------------------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.citationManage,
    auditCode: M18_AUDIT_CODES.citationAdded,
    description: 'Add a citation to an authority or external reference.',
  })
  @Post('knowledge/:id/citations')
  async addCitation(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add citation (m18)');
    return citationView(
      await this.service.addCitation(s.ctx, s.actor.identityId, id, {
        ...optStr(b['authorityRef'], 'authorityRef'),
        ...optStr(b['externalCitation'], 'externalCitation'),
        ...optStr(b['pinpoint'], 'pinpoint'),
        ...optStr(b['note'], 'note'),
      }),
    );
  }
  @Get('knowledge/:id/citations')
  async listCitations(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list citations (m18)');
    return { citations: (await this.service.listCitations(s.ctx, id)).map(citationView) };
  }

  // --- notes (privileged; content redaction) ----------------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.knowledgeUpdate,
    auditCode: M18_AUDIT_CODES.noteAdded,
    description: 'Add a note (restricted notes require legaldocs.privileged.create).',
  })
  @Post('knowledge/:id/notes')
  async addNote(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add note (m18)');
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
  @Get('knowledge/:id/notes')
  async listNotes(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list notes (m18)');
    const { notes, canReadPrivileged } = await this.service.listNotes(s.ctx, id);
    return { notes: notes.map((n) => noteView(n, canReadPrivileged)) };
  }

  // --- reviews / expiry deadlines ---------------------------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.reviewManage,
    auditCode: M18_AUDIT_CODES.reviewScheduled,
    description: 'Schedule a review/expiry deadline.',
  })
  @Post('knowledge/:id/reviews')
  async scheduleReview(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'schedule review (m18)');
    return reviewView(
      await this.service.scheduleReview(s.ctx, s.actor.identityId, id, {
        reviewType: requireString(b['reviewType'], 'reviewType', s.correlationId),
        rule: b['rule'] as ReviewRule,
        ...optStr(b['startAt'], 'startAt'),
        ...optNum(b['warnWindowMs'], 'warnWindowMs'),
      }),
    );
  }
  @Endpoint({
    permission: M18_PERMISSIONS.reviewManage,
    auditCode: M18_AUDIT_CODES.reviewCompleted,
    description: 'Complete a scheduled review.',
  })
  @Post('reviews/:rid/complete')
  async completeReview(
    @Param('rid') rid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'complete review (m18)');
    return reviewView(
      await this.service.completeReview(s.ctx, s.actor.identityId, rid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['outcome'], 'outcome'),
      }),
    );
  }
  @Get('knowledge/:id/reviews')
  async listReviews(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list reviews (m18)');
    return { reviews: (await this.service.listReviews(s.ctx, id)).map(reviewView) };
  }

  // --- usage analytics (append-only, safe dimensions) -------------------------------------------
  @Endpoint({
    permission: M18_PERMISSIONS.knowledgeRead,
    auditCode: M18_AUDIT_CODES.usageRecorded,
    description: 'Record a usage event against a knowledge record.',
  })
  @Post('knowledge/:id/usage')
  async recordUsage(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record usage (m18)');
    return usageView(
      await this.service.recordUsage(s.ctx, id, {
        usageType: requireString(b['usageType'], 'usageType', s.correlationId),
        ...optStr(b['actorRef'], 'actorRef'),
        ...optStr(b['contextRef'], 'contextRef'),
        ...optStr(b['note'], 'note'),
      }),
    );
  }
  @Get('knowledge/:id/usage')
  async listUsage(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list usage (m18)');
    return { usage: (await this.service.listUsage(s.ctx, id)).map(usageView) };
  }

  // --- reads (with redaction) -------------------------------------------------------------------
  @Get('knowledge/analytics/summary')
  async analytics(@Headers() h: Record<string, string>, @Query('dimension') dimension?: string) {
    const s = await this.scoped(h, 'knowledge analytics (m18)');
    const dims = [
      'knowledge_type',
      'practice_area',
      'jurisdiction',
      'authority_level',
      'status',
      'confidentiality',
      'source',
      'risk_level',
    ];
    const dim = typeof dimension === 'string' && dims.includes(dimension) ? dimension : 'status';
    return { dimension: dim, buckets: await this.service.analytics(s.ctx, dim) };
  }
  @Get('knowledge/:id')
  async get(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get knowledge (m18)');
    const { knowledge, canReadConfidential } = await this.service.get(s.ctx, id);
    return knowledgeView(knowledge, canReadConfidential);
  }
  @Get('knowledge')
  async search(
    @Headers() h: Record<string, string>,
    @Query('knowledgeType') knowledgeType?: string,
    @Query('status') status?: string,
    @Query('practiceArea') practiceArea?: string,
    @Query('jurisdiction') jurisdiction?: string,
    @Query('owner') owner?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const s = await this.scoped(h, 'search knowledge (m18)');
    const { results } = await this.service.search(s.ctx, {
      ...optStr(knowledgeType, 'knowledgeType'),
      ...optStr(status, 'status'),
      ...optStr(practiceArea, 'practiceArea'),
      ...optStr(jurisdiction, 'jurisdiction'),
      ...optStr(owner, 'owner'),
      limit: optionalLimit(limit, s.correlationId).limit ?? 50,
      offset: optionalOffset(offset, s.correlationId).offset ?? 0,
    });
    // A list view never returns privileged content (ADR-076) — redact regardless of the caller's grants.
    return { results: results.map((r) => knowledgeView(r, false)) };
  }
}
