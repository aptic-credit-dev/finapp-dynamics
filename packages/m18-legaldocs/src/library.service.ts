/**
 * LibraryService — the drafting library: versioned, immutable-after-publish document TEMPLATES and the CLAUSE
 * library, both sharing the ONE PUBLISHABLE lifecycle (draft → under_review → approved → published, superseded via
 * a NEW version) through the `checkPublishableTransition` choke point, both maker-checker (approved_by <>
 * submitted_by, enforced here AND by the DB CHECK), plus the clause dependency/conflict graph. Document/clause
 * BYTES live in m09 (content_ref is an opaque id) — m18 stores references only. Every mutating method enforces its
 * permission (default deny), runs inside `db.withTenant`, writes append-only approval history, records audit + a
 * `legaldocs.lifecycle` event (where one exists) in the SAME transaction, and is optimistic-lock/CAS guarded.
 * content_hash is frozen at publish; a change to published content is a new version, never an in-place edit
 * (ADR-074). Clause/template body text and drafting guidance are sensitive and never placed in events/audit
 * (ADR-076).
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { LegalDocsLifecycleEventType, LegalDocsLifecyclePayload } from '@finapp/contracts';
import { M18_PERMISSIONS } from './permissions.ts';
import { M18_AUDIT_CODES } from './audit-codes.ts';
import { checkPublishableTransition } from './domain/lifecycles.ts';
import { isClauseKind, isConfidentiality, LEGALDOCS_LIMITS } from './domain/limits.ts';
import { isClauseRelationKind, isSelfRelation } from './domain/relationships.ts';
import { contentHashOf } from './hash.ts';
import {
  LegalDocsRepository,
  type TemplateRow,
  type ClauseRow,
  type ClauseRelationRow,
} from './repository.ts';
import type { M18Emitter } from './emit.ts';
import { badRequest } from './errors.ts';

function assertTitle(title: string, correlationId: string): void {
  if (title.trim() === '' || title.length > LEGALDOCS_LIMITS.maxTitleChars)
    throw badRequest('a title is required and must be bounded', correlationId);
}

/** Per-entity adapter so the shared publishable engine works over templates and clauses uniformly. */
interface PublishableAdapter<R extends TemplateRow | ClauseRow> {
  readonly entityType: 'template' | 'clause';
  readonly perms: { manage: string; approve: string; publish: string };
  readonly audit: {
    submitted: string;
    approved: string;
    published: string;
    superseded: string;
    withdrawn: string;
  };
  readonly events: {
    approved: LegalDocsLifecycleEventType;
    published: LegalDocsLifecycleEventType;
    superseded: LegalDocsLifecycleEventType;
    withdrawn: LegalDocsLifecycleEventType;
  };
  find(tx: Tx, id: string): Promise<R | null>;
  transition(
    tx: Tx,
    args: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      submittedBy?: string | null;
      approvedBy?: string | null;
      contentHash?: string | null;
      supersededById?: string | null;
      by: string | null;
    },
  ): Promise<R | null>;
  insertVersion(
    tx: Tx,
    args: {
      prior: R;
      tenantId: string;
      correlationId: string;
      overrides: { title?: string | null; contentRef?: string | null; guidance?: string | null };
      submittedBy: string | null;
      approvedBy: string | null;
      by: string | null;
    },
  ): Promise<R>;
  projection(row: R): unknown;
  status(row: R): string;
  submittedBy(row: R): string | null;
  versionNumber(row: R): number;
  version(row: R): number;
}

export class LibraryService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M18Emitter;
  private readonly repo: LegalDocsRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M18Emitter,
    repo: LegalDocsRepository = new LegalDocsRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  private async publish(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    type: LegalDocsLifecycleEventType,
    payload: LegalDocsLifecyclePayload,
  ): Promise<void> {
    await this.emitter.publish(tx, {
      type,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor !== null ? { actor } : {}),
      payload,
    });
  }

  private templateAdapter(): PublishableAdapter<TemplateRow> {
    const repo = this.repo;
    return {
      entityType: 'template',
      perms: {
        manage: M18_PERMISSIONS.templateManage,
        approve: M18_PERMISSIONS.templateApprove,
        publish: M18_PERMISSIONS.templatePublish,
      },
      audit: {
        submitted: M18_AUDIT_CODES.templateSubmitted,
        approved: M18_AUDIT_CODES.templateApproved,
        published: M18_AUDIT_CODES.templatePublished,
        superseded: M18_AUDIT_CODES.templateSuperseded,
        withdrawn: M18_AUDIT_CODES.templateWithdrawn,
      },
      events: {
        approved: 'TemplateApproved',
        published: 'TemplatePublished',
        superseded: 'TemplateSuperseded',
        withdrawn: 'TemplateWithdrawn',
      },
      find: (tx, id) => repo.findTemplate(tx, id),
      transition: (tx, args) => repo.transitionTemplate(tx, args),
      insertVersion: (tx, a) =>
        repo.insertTemplate(tx, {
          tenantId: a.tenantId,
          templateCode: a.prior.template_code,
          versionNumber: a.prior.version_number + 1,
          category: a.prior.category,
          title: a.overrides.title ?? a.prior.title,
          description: a.prior.description,
          jurisdiction: a.prior.jurisdiction,
          practiceArea: a.prior.practice_area,
          contentRef: a.overrides.contentRef ?? a.prior.content_ref,
          guidance: a.overrides.guidance ?? a.prior.guidance,
          status: 'published',
          contentHash: null,
          submittedBy: a.submittedBy,
          approvedBy: a.approvedBy,
          supersedesId: a.prior.id,
          confidentiality: a.prior.confidentiality,
          correlationId: a.correlationId,
          by: a.by,
        }),
      projection: (row) => ({
        templateCode: row.template_code,
        versionNumber: row.version_number,
        category: row.category,
        title: row.title,
        description: row.description,
        contentRef: row.content_ref,
        guidance: row.guidance,
      }),
      status: (row) => row.status,
      submittedBy: (row) => row.submitted_by,
      versionNumber: (row) => row.version_number,
      version: (row) => row.version,
    };
  }

  private clauseAdapter(): PublishableAdapter<ClauseRow> {
    const repo = this.repo;
    return {
      entityType: 'clause',
      perms: {
        manage: M18_PERMISSIONS.clauseManage,
        approve: M18_PERMISSIONS.clauseApprove,
        publish: M18_PERMISSIONS.clausePublish,
      },
      audit: {
        submitted: M18_AUDIT_CODES.clauseSubmitted,
        approved: M18_AUDIT_CODES.clauseApproved,
        published: M18_AUDIT_CODES.clausePublished,
        superseded: M18_AUDIT_CODES.clauseSuperseded,
        withdrawn: M18_AUDIT_CODES.clauseWithdrawn,
      },
      events: {
        approved: 'ClauseApproved',
        published: 'ClausePublished',
        superseded: 'ClauseSuperseded',
        withdrawn: 'ClauseWithdrawn',
      },
      find: (tx, id) => repo.findClause(tx, id),
      transition: (tx, args) => repo.transitionClause(tx, args),
      insertVersion: (tx, a) =>
        repo.insertClause(tx, {
          tenantId: a.tenantId,
          clauseCode: a.prior.clause_code,
          versionNumber: a.prior.version_number + 1,
          clauseKind: a.prior.clause_kind,
          title: a.overrides.title ?? a.prior.title,
          category: a.prior.category,
          jurisdiction: a.prior.jurisdiction,
          practiceArea: a.prior.practice_area,
          guidance: a.overrides.guidance ?? a.prior.guidance,
          contentRef: a.overrides.contentRef ?? a.prior.content_ref,
          status: 'published',
          contentHash: null,
          submittedBy: a.submittedBy,
          approvedBy: a.approvedBy,
          supersedesId: a.prior.id,
          confidentiality: a.prior.confidentiality,
          correlationId: a.correlationId,
          by: a.by,
        }),
      projection: (row) => ({
        clauseCode: row.clause_code,
        versionNumber: row.version_number,
        clauseKind: row.clause_kind,
        title: row.title,
        category: row.category,
        contentRef: row.content_ref,
        guidance: row.guidance,
      }),
      status: (row) => row.status,
      submittedBy: (row) => row.submitted_by,
      versionNumber: (row) => row.version_number,
      version: (row) => row.version,
    };
  }

  // --- shared publishable engine ----------------------------------------------------------------
  private async submitEntity<R extends TemplateRow | ClauseRow>(
    ad: PublishableAdapter<R>,
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<R> {
    await this.authz.require(ctx, ad.perms.manage);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await ad.find(tx, id);
      if (row === null) throw ProblemError.notFound(`${ad.entityType} not found.`, ctx.correlationId);
      const check = checkPublishableTransition(ad.status(row), 'under_review');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot submit from ${ad.status(row)}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await ad.transition(tx, {
        id,
        expectedVersion,
        toStatus: 'under_review',
        submittedBy: actor,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          `${ad.entityType} modified concurrently (stale version).`,
          ctx.correlationId,
        );
      await this.repo.insertApprovalHistory(tx, {
        tenantId: ctx.tenantId,
        entityType: ad.entityType,
        entityId: id,
        action: 'submitted',
        decision: null,
        by: actor,
        note: null,
        correlationId: ctx.correlationId,
      });
      // No *Submitted event exists in the family — submit records audit + approval history only.
      await this.emitter.recordAudit(tx, ctx, {
        code: ad.audit.submitted,
        entityType: `legaldoc_${ad.entityType}`,
        entityId: id,
        detail: {},
      });
      return upd;
    });
  }

  private async approveEntity<R extends TemplateRow | ClauseRow>(
    ad: PublishableAdapter<R>,
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<R> {
    await this.authz.require(ctx, ad.perms.approve);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await ad.find(tx, id);
      if (row === null) throw ProblemError.notFound(`${ad.entityType} not found.`, ctx.correlationId);
      const submittedBy = ad.submittedBy(row);
      if (submittedBy !== null && actor !== null && submittedBy === actor)
        throw ProblemError.conflict(
          'The submitter cannot approve it (segregation of duties).',
          ctx.correlationId,
        );
      const check = checkPublishableTransition(ad.status(row), 'approved');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot approve from ${ad.status(row)}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await ad.transition(tx, {
        id,
        expectedVersion,
        toStatus: 'approved',
        approvedBy: actor,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          `${ad.entityType} modified concurrently (stale version).`,
          ctx.correlationId,
        );
      await this.repo.insertApprovalHistory(tx, {
        tenantId: ctx.tenantId,
        entityType: ad.entityType,
        entityId: id,
        action: 'approved',
        decision: 'approved',
        by: actor,
        note: null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: ad.audit.approved,
        entityType: `legaldoc_${ad.entityType}`,
        entityId: id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, ad.events.approved, {
        recordId: id,
        recordType: ad.entityType,
        fromStatus: ad.status(row),
        toStatus: 'approved',
      });
      return upd;
    });
  }

  private async publishEntity<R extends TemplateRow | ClauseRow>(
    ad: PublishableAdapter<R>,
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<R> {
    await this.authz.require(ctx, ad.perms.publish);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await ad.find(tx, id);
      if (row === null) throw ProblemError.notFound(`${ad.entityType} not found.`, ctx.correlationId);
      const check = checkPublishableTransition(ad.status(row), 'published');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot publish from ${ad.status(row)}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await ad.transition(tx, {
        id,
        expectedVersion,
        toStatus: 'published',
        contentHash: contentHashOf(ad.projection(row)),
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          `${ad.entityType} modified concurrently (stale version).`,
          ctx.correlationId,
        );
      await this.repo.insertApprovalHistory(tx, {
        tenantId: ctx.tenantId,
        entityType: ad.entityType,
        entityId: id,
        action: 'published',
        decision: null,
        by: actor,
        note: null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: ad.audit.published,
        entityType: `legaldoc_${ad.entityType}`,
        entityId: id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, ad.events.published, {
        recordId: id,
        recordType: ad.entityType,
        fromStatus: ad.status(row),
        toStatus: 'published',
      });
      return upd;
    });
  }

  private async withdrawEntity<R extends TemplateRow | ClauseRow>(
    ad: PublishableAdapter<R>,
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { expectedVersion: number; reason?: string | null },
  ): Promise<R> {
    await this.authz.require(ctx, ad.perms.manage);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await ad.find(tx, id);
      if (row === null) throw ProblemError.notFound(`${ad.entityType} not found.`, ctx.correlationId);
      const check = checkPublishableTransition(ad.status(row), 'withdrawn');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot withdraw from ${ad.status(row)}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await ad.transition(tx, {
        id,
        expectedVersion: input.expectedVersion,
        toStatus: 'withdrawn',
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          `${ad.entityType} modified concurrently (stale version).`,
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: ad.audit.withdrawn,
        entityType: `legaldoc_${ad.entityType}`,
        entityId: id,
        ...(input.reason != null ? { reason: input.reason } : {}),
        detail: {},
      });
      await this.publish(tx, ctx, actor, ad.events.withdrawn, {
        recordId: id,
        recordType: ad.entityType,
        fromStatus: ad.status(row),
        toStatus: 'withdrawn',
        reasonCode: 'withdrawn',
      });
      return upd;
    });
  }

  private async supersedeEntity<R extends TemplateRow | ClauseRow>(
    ad: PublishableAdapter<R>,
    ctx: RequestContext,
    actor: string | null,
    priorId: string,
    input: {
      expectedVersion: number;
      title?: string | null;
      contentRef?: string | null;
      guidance?: string | null;
      submittedBy?: string | null;
    },
  ): Promise<{ prior: R; successor: R }> {
    await this.authz.require(ctx, ad.perms.publish);
    return this.db.withTenant(ctx, async (tx) => {
      const prior = await ad.find(tx, priorId);
      if (prior === null) throw ProblemError.notFound(`${ad.entityType} not found.`, ctx.correlationId);
      if (ad.status(prior) !== 'published')
        throw ProblemError.conflict(
          `Only a published ${ad.entityType} can be superseded.`,
          ctx.correlationId,
        );
      const submittedBy = input.submittedBy ?? ad.submittedBy(prior);
      if (submittedBy !== null && actor !== null && submittedBy === actor)
        throw ProblemError.conflict(
          'The successor submitter cannot also approve it (segregation of duties).',
          ctx.correlationId,
        );
      // 1) Move prior off `published` first so the successor becomes the sole published head (one-published index).
      const supersededPrior = await ad.transition(tx, {
        id: priorId,
        expectedVersion: input.expectedVersion,
        toStatus: 'superseded',
        by: actor,
      });
      if (supersededPrior === null)
        throw ProblemError.conflict(
          `${ad.entityType} modified concurrently (stale version).`,
          ctx.correlationId,
        );
      const successor = await ad.insertVersion(tx, {
        prior,
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        overrides: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.contentRef !== undefined ? { contentRef: input.contentRef } : {}),
          ...(input.guidance !== undefined ? { guidance: input.guidance } : {}),
        },
        submittedBy,
        approvedBy: actor,
        by: actor,
      });
      const hashed = await ad.transition(tx, {
        id: successor.id,
        expectedVersion: ad.version(successor),
        toStatus: 'published',
        contentHash: contentHashOf(ad.projection(successor)),
        by: actor,
      });
      const linkedPrior = await ad.transition(tx, {
        id: priorId,
        expectedVersion: ad.version(supersededPrior),
        toStatus: 'superseded',
        supersededById: successor.id,
        by: actor,
      });
      await this.repo.insertApprovalHistory(tx, {
        tenantId: ctx.tenantId,
        entityType: ad.entityType,
        entityId: successor.id,
        action: 'published',
        decision: null,
        by: actor,
        note: null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: ad.audit.superseded,
        entityType: `legaldoc_${ad.entityType}`,
        entityId: priorId,
        detail: { supersededById: successor.id, versionNumber: ad.versionNumber(successor) },
      });
      await this.publish(tx, ctx, actor, ad.events.superseded, {
        recordId: priorId,
        recordType: ad.entityType,
        fromStatus: 'published',
        toStatus: 'superseded',
        versionNumber: ad.versionNumber(successor),
        reasonCode: 'superseded',
      });
      return { prior: linkedPrior ?? supersededPrior, successor: hashed ?? successor };
    });
  }

  // --- templates --------------------------------------------------------------------------------
  async createTemplate(
    ctx: RequestContext,
    actor: string | null,
    input: {
      templateCode: string;
      title: string;
      category?: string | null;
      description?: string | null;
      jurisdiction?: string | null;
      practiceArea?: string | null;
      contentRef?: string | null;
      guidance?: string | null;
      confidentiality?: string;
    },
  ): Promise<TemplateRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.templateManage);
    if (input.templateCode.trim() === '') throw badRequest('a template code is required', ctx.correlationId);
    assertTitle(input.title, ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertTemplate(tx, {
        tenantId: ctx.tenantId,
        templateCode: input.templateCode,
        versionNumber: 1,
        category: input.category ?? null,
        title: input.title,
        description: input.description ?? null,
        jurisdiction: input.jurisdiction ?? null,
        practiceArea: input.practiceArea ?? null,
        contentRef: input.contentRef ?? null,
        guidance: input.guidance ?? null,
        status: 'draft',
        contentHash: null,
        submittedBy: null,
        approvedBy: null,
        supersedesId: null,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.templateCreated,
        entityType: 'legaldoc_template',
        entityId: row.id,
        detail: { templateCode: input.templateCode },
      });
      await this.publish(tx, ctx, actor, 'TemplateCreated', {
        recordId: row.id,
        recordType: 'template',
        toStatus: row.status,
      });
      return row;
    });
  }
  submitTemplate(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.submitEntity(this.templateAdapter(), ctx, actor, id, expectedVersion);
  }
  approveTemplate(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.approveEntity(this.templateAdapter(), ctx, actor, id, expectedVersion);
  }
  publishTemplate(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.publishEntity(this.templateAdapter(), ctx, actor, id, expectedVersion);
  }
  withdrawTemplate(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { expectedVersion: number; reason?: string | null },
  ) {
    return this.withdrawEntity(this.templateAdapter(), ctx, actor, id, input);
  }
  supersedeTemplate(
    ctx: RequestContext,
    actor: string | null,
    priorId: string,
    input: {
      expectedVersion: number;
      title?: string | null;
      contentRef?: string | null;
      guidance?: string | null;
      submittedBy?: string | null;
    },
  ) {
    return this.supersedeEntity(this.templateAdapter(), ctx, actor, priorId, input);
  }
  async listTemplates(ctx: RequestContext, category?: string): Promise<TemplateRow[]> {
    await this.authz.require(ctx, M18_PERMISSIONS.templateRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listTemplates(tx, category));
  }
  async getTemplate(ctx: RequestContext, id: string): Promise<TemplateRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.templateRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findTemplate(tx, id));
    if (r === null) throw ProblemError.notFound('Template not found.', ctx.correlationId);
    return r;
  }

  // --- clauses ----------------------------------------------------------------------------------
  async createClause(
    ctx: RequestContext,
    actor: string | null,
    input: {
      clauseCode: string;
      title: string;
      clauseKind?: string;
      category?: string | null;
      jurisdiction?: string | null;
      practiceArea?: string | null;
      guidance?: string | null;
      contentRef?: string | null;
      confidentiality?: string;
    },
  ): Promise<ClauseRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.clauseManage);
    if (input.clauseCode.trim() === '') throw badRequest('a clause code is required', ctx.correlationId);
    assertTitle(input.title, ctx.correlationId);
    const clauseKind = input.clauseKind ?? 'approved';
    if (!isClauseKind(clauseKind)) throw badRequest('invalid clause kind', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertClause(tx, {
        tenantId: ctx.tenantId,
        clauseCode: input.clauseCode,
        versionNumber: 1,
        clauseKind,
        title: input.title,
        category: input.category ?? null,
        jurisdiction: input.jurisdiction ?? null,
        practiceArea: input.practiceArea ?? null,
        guidance: input.guidance ?? null,
        contentRef: input.contentRef ?? null,
        status: 'draft',
        contentHash: null,
        submittedBy: null,
        approvedBy: null,
        supersedesId: null,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.clauseCreated,
        entityType: 'legaldoc_clause',
        entityId: row.id,
        detail: { clauseCode: input.clauseCode, clauseKind },
      });
      await this.publish(tx, ctx, actor, 'ClauseCreated', {
        recordId: row.id,
        recordType: 'clause',
        toStatus: row.status,
      });
      return row;
    });
  }
  submitClause(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.submitEntity(this.clauseAdapter(), ctx, actor, id, expectedVersion);
  }
  approveClause(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.approveEntity(this.clauseAdapter(), ctx, actor, id, expectedVersion);
  }
  publishClause(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.publishEntity(this.clauseAdapter(), ctx, actor, id, expectedVersion);
  }
  withdrawClause(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { expectedVersion: number; reason?: string | null },
  ) {
    return this.withdrawEntity(this.clauseAdapter(), ctx, actor, id, input);
  }
  supersedeClause(
    ctx: RequestContext,
    actor: string | null,
    priorId: string,
    input: {
      expectedVersion: number;
      title?: string | null;
      contentRef?: string | null;
      guidance?: string | null;
      submittedBy?: string | null;
    },
  ) {
    return this.supersedeEntity(this.clauseAdapter(), ctx, actor, priorId, input);
  }
  async listClauses(
    ctx: RequestContext,
    filters: { clauseKind?: string; category?: string },
  ): Promise<ClauseRow[]> {
    await this.authz.require(ctx, M18_PERMISSIONS.clauseRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listClauses(tx, filters));
  }
  async getClause(ctx: RequestContext, id: string): Promise<ClauseRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.clauseRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findClause(tx, id));
    if (r === null) throw ProblemError.notFound('Clause not found.', ctx.correlationId);
    return r;
  }

  // --- clause relations (dependency / conflict graph; audit-only, no event in the family) -------
  async addClauseRelation(
    ctx: RequestContext,
    actor: string | null,
    input: { fromClauseId: string; toClauseId: string; kind: string },
  ): Promise<ClauseRelationRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.clauseManage);
    if (!isClauseRelationKind(input.kind))
      throw badRequest('invalid clause relation kind', ctx.correlationId);
    if (isSelfRelation(input.fromClauseId, input.toClauseId))
      throw badRequest('a clause cannot relate to itself', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const from = await this.repo.findClause(tx, input.fromClauseId);
      const to = await this.repo.findClause(tx, input.toClauseId);
      if (from === null || to === null)
        throw ProblemError.notFound('Both clauses must exist in this tenant.', ctx.correlationId);
      const existing = await this.repo.findActiveClauseRelation(
        tx,
        input.fromClauseId,
        input.toClauseId,
        input.kind,
      );
      if (existing !== null)
        throw ProblemError.conflict('That active clause relation already exists.', ctx.correlationId);
      const row = await this.repo.insertClauseRelation(tx, {
        tenantId: ctx.tenantId,
        fromId: input.fromClauseId,
        toId: input.toClauseId,
        kind: input.kind,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.clauseRelationCreated,
        entityType: 'legaldoc_clause_relation',
        entityId: row.id,
        detail: { kind: input.kind },
      });
      return row;
    });
  }
  async listClauseRelations(ctx: RequestContext, clauseId: string): Promise<ClauseRelationRow[]> {
    await this.authz.require(ctx, M18_PERMISSIONS.clauseRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listClauseRelations(tx, clauseId));
  }
}
