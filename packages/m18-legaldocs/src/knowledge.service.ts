/**
 * KnowledgeService — the core legal knowledge record and everything hung off it: creation (stable knowledge_code
 * across versions, human-readable knowledge_number, correlation id, idempotency), content edits (draft/
 * changes_requested only — published content is immutable), owner/reviewer/approver assignment, classification
 * changes, the full PUBLISHABLE lifecycle through the ONE choke point `checkPublishableTransition`
 * (submit/review/requestChanges/approve/publish/supersede/withdraw/archive/reopen), opaque cross-module references,
 * knowledge-to-knowledge relationships, tags, citations, notes (privileged redaction), review/expiry deadlines
 * (deterministic, clock-driven) and usage analytics. Every mutating method enforces its permission (default deny),
 * runs inside `db.withTenant`, appends the relevant append-only history, records audit + a `legaldocs.lifecycle`
 * event in the SAME transaction, and is optimistic-lock/CAS guarded. Maker-checker: approve requires
 * approved_by <> submitted_by (here AND the DB CHECK). The sensitive `abstract` and restricted note content are
 * RLS-stored, redacted on read unless the caller holds the confidential/privileged permission, and NEVER placed in
 * events/audit (ADR-076). m18 NEVER reads m09/m14/m16/m17 tables — cross-module targets are OPAQUE ids.
 */
import { randomUUID } from 'node:crypto';
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { LegalDocsLifecycleEventType, LegalDocsLifecyclePayload } from '@finapp/contracts';
import { M18_PERMISSIONS } from './permissions.ts';
import { M18_AUDIT_CODES } from './audit-codes.ts';
import { checkPublishableTransition, isPublishableFrozen } from './domain/lifecycles.ts';
import {
  isKnowledgeType,
  isConfidentiality,
  isPrivilegeLevel,
  isRiskLevel,
  isAuthorityLevel,
  isSourceType,
  isReferenceType,
  isTaxonomyKind,
  isReviewType,
  isNoteType,
  isRestrictedNote,
  LEGALDOCS_LIMITS,
} from './domain/limits.ts';
import { isRelationshipKind, isSelfRelation } from './domain/relationships.ts';
import { computeReviewDueMs, isExpirySafe, type ReviewRule } from './domain/deadlines.ts';
import { formatKnowledgeNumber } from './knowledge-number.ts';
import { contentHashOf } from './hash.ts';
import {
  LegalDocsRepository,
  type KnowledgeRow,
  type ReferenceRow,
  type RelationshipRow,
  type ReviewRow,
  type TagRow,
  type CitationRow,
  type NoteRow,
  type UsageRow,
} from './repository.ts';
import type { M18Emitter } from './emit.ts';
import type { CrossModuleRef } from './ports.ts';
import { SystemClock, type Clock } from './ports.ts';
import { badRequest } from './errors.ts';

const iso = (ms: number): string => new Date(ms).toISOString();
const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Redacts the sensitive `abstract` (legal analysis) unless the caller holds the confidential/privileged read
 * permission — the same fail-closed redaction m17 applies to sensitive case fields (ADR-076).
 */
export function redactKnowledge(row: KnowledgeRow, canReadConfidential: boolean): KnowledgeRow {
  if (canReadConfidential) return row;
  return { ...row, abstract: null };
}

export class KnowledgeService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M18Emitter;
  private readonly repo: LegalDocsRepository;
  private readonly clock: Clock;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M18Emitter,
    repo: LegalDocsRepository = new LegalDocsRepository(),
    clock: Clock = new SystemClock(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.clock = clock;
  }

  private async requireKnowledge(
    tx: Parameters<Parameters<Db['withTenant']>[1]>[0],
    id: string,
    correlationId: string,
  ): Promise<KnowledgeRow> {
    const kn = await this.repo.findKnowledge(tx, id);
    if (kn === null) throw ProblemError.notFound('Knowledge record not found.', correlationId);
    return kn;
  }
  private async emitEvent(
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
  /** The immutable content projection frozen into content_hash at publish. */
  private projection(kn: KnowledgeRow): unknown {
    return {
      knowledgeCode: kn.knowledge_code,
      versionNumber: kn.version_number,
      knowledgeType: kn.knowledge_type,
      title: kn.title,
      summary: kn.summary,
      abstract: kn.abstract,
      practiceArea: kn.practice_area,
      jurisdiction: kn.jurisdiction,
      authorityLevel: kn.authority_level,
    };
  }

  // --- create -----------------------------------------------------------------------------------
  async create(
    ctx: RequestContext,
    actor: string | null,
    input: {
      knowledgeType: string;
      title: string;
      summary?: string | null;
      abstract?: string | null;
      practiceArea?: string | null;
      jurisdiction?: string | null;
      authorityLevel?: string | null;
      confidentiality?: string | null;
      privileged?: boolean;
      privilegeLevel?: string | null;
      riskLevel?: string | null;
      source?: string | null;
      sourceReference?: string | null;
      owner?: string | null;
      effectiveDate?: string | null;
      reviewDate?: string | null;
      expiryDate?: string | null;
      knowledgeCode?: string | null;
      idempotencyKey?: string | null;
      causationId?: string | null;
    },
  ): Promise<KnowledgeRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.knowledgeCreate);
    if (!isKnowledgeType(input.knowledgeType)) throw badRequest('invalid knowledge type', ctx.correlationId);
    if (input.title.trim() === '' || input.title.length > LEGALDOCS_LIMITS.maxTitleChars)
      throw badRequest('a title is required and must be bounded', ctx.correlationId);
    if (input.summary != null && input.summary.length > LEGALDOCS_LIMITS.maxSummaryChars)
      throw badRequest('summary too long', ctx.correlationId);
    if (input.abstract != null && input.abstract.length > LEGALDOCS_LIMITS.maxAbstractChars)
      throw badRequest('abstract too long', ctx.correlationId);
    const confidentiality = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(confidentiality)) throw badRequest('invalid confidentiality', ctx.correlationId);
    const privilegeLevel = input.privilegeLevel ?? 'none';
    if (!isPrivilegeLevel(privilegeLevel)) throw badRequest('invalid privilege level', ctx.correlationId);
    if (input.riskLevel != null && !isRiskLevel(input.riskLevel))
      throw badRequest('invalid risk level', ctx.correlationId);
    if (input.authorityLevel != null && !isAuthorityLevel(input.authorityLevel))
      throw badRequest('invalid authority level', ctx.correlationId);
    if (input.source != null && !isSourceType(input.source))
      throw badRequest('invalid source', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findKnowledgeByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const kn = await this.repo.insertKnowledge(tx, {
        tenantId: ctx.tenantId,
        knowledgeNumber: formatKnowledgeNumber(randomUUID()),
        knowledgeCode:
          input.knowledgeCode != null && input.knowledgeCode.trim() !== ''
            ? input.knowledgeCode
            : randomUUID(),
        versionNumber: 1,
        knowledgeType: input.knowledgeType,
        title: input.title,
        summary: input.summary ?? null,
        abstract: input.abstract ?? null,
        practiceArea: input.practiceArea ?? null,
        jurisdiction: input.jurisdiction ?? null,
        authorityLevel: input.authorityLevel ?? null,
        confidentiality,
        privileged: input.privileged === true,
        privilegeLevel,
        riskLevel: input.riskLevel ?? null,
        source: input.source ?? null,
        sourceReference: input.sourceReference ?? null,
        owner: input.owner ?? actor,
        effectiveDate: input.effectiveDate ?? null,
        reviewDate: input.reviewDate ?? null,
        expiryDate: input.expiryDate ?? null,
        status: 'draft',
        supersedesId: null,
        contentHash: null,
        publicationDate: null,
        submittedBy: null,
        approvedBy: null,
        correlationId: ctx.correlationId,
        causationId: input.causationId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        by: actor,
      });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        knowledgeId: kn.id,
        fromStatus: null,
        toStatus: kn.status,
        reason: null,
        reasonCode: 'created',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.knowledgeCreated,
        entityType: 'legaldoc_knowledge',
        entityId: kn.id,
        detail: { knowledgeNumber: kn.knowledge_number, knowledgeType: kn.knowledge_type },
      });
      await this.emitEvent(tx, ctx, actor, 'KnowledgeCreated', {
        recordId: kn.id,
        recordType: 'knowledge',
        knowledgeType: kn.knowledge_type,
        ...(kn.practice_area != null ? { practiceArea: kn.practice_area } : {}),
        ...(kn.jurisdiction != null ? { jurisdiction: kn.jurisdiction } : {}),
        confidentiality: kn.confidentiality,
        privileged: kn.privileged,
        toStatus: kn.status,
      });
      return kn;
    });
  }

  // --- content edit (draft / changes_requested only) --------------------------------------------
  async update(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      title?: string | null;
      summary?: string | null;
      abstract?: string | null;
      knowledgeType?: string | null;
      practiceArea?: string | null;
      jurisdiction?: string | null;
      authorityLevel?: string | null;
      riskLevel?: string | null;
      source?: string | null;
      sourceReference?: string | null;
      effectiveDate?: string | null;
      reviewDate?: string | null;
      expiryDate?: string | null;
    },
  ): Promise<KnowledgeRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.knowledgeUpdate);
    if (input.knowledgeType != null && !isKnowledgeType(input.knowledgeType))
      throw badRequest('invalid knowledge type', ctx.correlationId);
    if (input.summary != null && input.summary.length > LEGALDOCS_LIMITS.maxSummaryChars)
      throw badRequest('summary too long', ctx.correlationId);
    if (input.abstract != null && input.abstract.length > LEGALDOCS_LIMITS.maxAbstractChars)
      throw badRequest('abstract too long', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const kn = await this.requireKnowledge(tx, id, ctx.correlationId);
      if (isPublishableFrozen(kn.status))
        throw ProblemError.conflict(
          `Published content is immutable — supersede to create a new version (status ${kn.status}).`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateKnowledge(tx, {
        id,
        expectedVersion: input.expectedVersion,
        title: input.title ?? null,
        summary: input.summary ?? null,
        abstract: input.abstract ?? null,
        knowledgeType: input.knowledgeType ?? null,
        practiceArea: input.practiceArea ?? null,
        jurisdiction: input.jurisdiction ?? null,
        authorityLevel: input.authorityLevel ?? null,
        riskLevel: input.riskLevel ?? null,
        source: input.source ?? null,
        sourceReference: input.sourceReference ?? null,
        effectiveDate: input.effectiveDate ?? null,
        reviewDate: input.reviewDate ?? null,
        expiryDate: input.expiryDate ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Knowledge record not editable in this status or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.knowledgeUpdated,
        entityType: 'legaldoc_knowledge',
        entityId: id,
        detail: {},
      });
      return upd;
    });
  }

  // --- assignment -------------------------------------------------------------------------------
  async assign(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      owner?: string | null;
      reviewer?: string | null;
      approver?: string | null;
      reason?: string | null;
    },
  ): Promise<KnowledgeRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.knowledgeAssign);
    if (input.owner == null && input.reviewer == null && input.approver == null)
      throw badRequest('at least one of owner/reviewer/approver is required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireKnowledge(tx, id, ctx.correlationId);
      const upd = await this.repo.assignKnowledge(tx, {
        id,
        expectedVersion: input.expectedVersion,
        owner: input.owner ?? null,
        reviewer: input.reviewer ?? null,
        approver: input.approver ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Knowledge record modified concurrently (stale version).',
          ctx.correlationId,
        );
      for (const [kind, ref] of [
        ['owner', input.owner],
        ['reviewer', input.reviewer],
        ['approver', input.approver],
      ] as const) {
        if (ref != null)
          await this.repo.insertAssignmentHistory(tx, {
            tenantId: ctx.tenantId,
            knowledgeId: id,
            kind,
            ref,
            reason: input.reason ?? null,
            by: actor,
            correlationId: ctx.correlationId,
          });
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.knowledgeAssigned,
        entityType: 'legaldoc_knowledge',
        entityId: id,
        detail: {},
      });
      await this.emitEvent(tx, ctx, actor, 'KnowledgeAssigned', {
        recordId: id,
        recordType: 'knowledge',
      });
      return upd;
    });
  }

  // --- classification change --------------------------------------------------------------------
  async changeClassification(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      confidentiality?: string | null;
      privileged?: boolean | null;
      privilegeLevel?: string | null;
    },
  ): Promise<KnowledgeRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.knowledgeUpdate);
    if (input.confidentiality != null && !isConfidentiality(input.confidentiality))
      throw badRequest('invalid confidentiality', ctx.correlationId);
    if (input.privilegeLevel != null && !isPrivilegeLevel(input.privilegeLevel))
      throw badRequest('invalid privilege level', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireKnowledge(tx, id, ctx.correlationId);
      const upd = await this.repo.patchKnowledgeClassification(tx, {
        id,
        expectedVersion: input.expectedVersion,
        confidentiality: input.confidentiality ?? null,
        privileged: input.privileged ?? null,
        privilegeLevel: input.privilegeLevel ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Knowledge record modified concurrently (stale version).',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.classificationChanged,
        entityType: 'legaldoc_knowledge',
        entityId: id,
        detail: { confidentiality: upd.confidentiality, privileged: upd.privileged },
      });
      await this.emitEvent(tx, ctx, actor, 'ClassificationChanged', {
        recordId: id,
        recordType: 'knowledge',
        confidentiality: upd.confidentiality,
        privileged: upd.privileged,
      });
      return upd;
    });
  }

  // --- lifecycle (single choke point) -----------------------------------------------------------
  private async move(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    to: string,
    opts: {
      permission: string;
      auditCode: string;
      eventType: LegalDocsLifecycleEventType;
      expectedVersion: number;
      reasonCode?: string;
      reason?: string | null;
      stampSubmitted?: boolean;
      stampApproved?: boolean;
      freezeContent?: boolean;
      approvalAction?: string;
    },
  ): Promise<KnowledgeRow> {
    await this.authz.require(ctx, opts.permission);
    return this.db.withTenant(ctx, async (tx) => {
      const kn = await this.requireKnowledge(tx, id, ctx.correlationId);
      const check = checkPublishableTransition(kn.status, to);
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot move ${kn.status} -> ${to}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      if (
        opts.stampApproved === true &&
        actor !== null &&
        kn.submitted_by !== null &&
        kn.submitted_by === actor
      )
        throw ProblemError.conflict(
          'The submitter cannot approve it (segregation of duties).',
          ctx.correlationId,
        );
      const contentHash = opts.freezeContent === true ? contentHashOf(this.projection(kn)) : null;
      const publicationDate = opts.freezeContent === true ? isoDate(this.clock.now()) : null;
      const upd = await this.repo.transitionKnowledge(tx, {
        id,
        expectedVersion: opts.expectedVersion,
        toStatus: to,
        submittedBy: opts.stampSubmitted === true ? actor : null,
        approvedBy: opts.stampApproved === true ? actor : null,
        contentHash,
        publicationDate,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Knowledge record modified concurrently (stale version).',
          ctx.correlationId,
        );
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        knowledgeId: id,
        fromStatus: kn.status,
        toStatus: to,
        reason: opts.reason ?? null,
        reasonCode: opts.reasonCode ?? null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      if (opts.approvalAction !== undefined)
        await this.repo.insertApprovalHistory(tx, {
          tenantId: ctx.tenantId,
          entityType: 'knowledge',
          entityId: id,
          action: opts.approvalAction,
          decision: null,
          by: actor,
          note: opts.reason ?? null,
          correlationId: ctx.correlationId,
        });
      await this.emitter.recordAudit(tx, ctx, {
        code: opts.auditCode,
        entityType: 'legaldoc_knowledge',
        entityId: id,
        ...(opts.reason != null ? { reason: opts.reason } : {}),
        detail: { fromStatus: kn.status, toStatus: to },
      });
      await this.emitEvent(tx, ctx, actor, opts.eventType, {
        recordId: id,
        recordType: 'knowledge',
        fromStatus: kn.status,
        toStatus: to,
        ...(opts.reasonCode !== undefined ? { reasonCode: opts.reasonCode } : {}),
      });
      return upd;
    });
  }

  submit(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<KnowledgeRow> {
    return this.move(ctx, actor, id, 'under_review', {
      permission: M18_PERMISSIONS.knowledgeSubmit,
      auditCode: M18_AUDIT_CODES.knowledgeSubmitted,
      eventType: 'KnowledgeSubmitted',
      reasonCode: 'submitted',
      stampSubmitted: true,
      approvalAction: 'submitted',
      expectedVersion,
    });
  }
  /** Reviewer returns the record to the author after review (under_review -> draft). */
  review(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<KnowledgeRow> {
    return this.move(ctx, actor, id, 'draft', {
      permission: M18_PERMISSIONS.knowledgeReview,
      auditCode: M18_AUDIT_CODES.knowledgeReviewed,
      eventType: 'KnowledgeReviewed',
      reasonCode: 'reviewed',
      expectedVersion,
    });
  }
  requestChanges(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<KnowledgeRow> {
    if (input.reason.trim() === '')
      throw badRequest('a reason is required to request changes', ctx.correlationId);
    return this.move(ctx, actor, id, 'changes_requested', {
      permission: M18_PERMISSIONS.knowledgeReview,
      auditCode: M18_AUDIT_CODES.knowledgeChangesRequested,
      eventType: 'KnowledgeChangesRequested',
      reasonCode: 'changes_requested',
      reason: input.reason,
      expectedVersion: input.expectedVersion,
    });
  }
  approve(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<KnowledgeRow> {
    return this.move(ctx, actor, id, 'approved', {
      permission: M18_PERMISSIONS.knowledgeApprove,
      auditCode: M18_AUDIT_CODES.knowledgeApproved,
      eventType: 'KnowledgeApproved',
      reasonCode: 'approved',
      stampApproved: true,
      approvalAction: 'approved',
      expectedVersion,
    });
  }
  publish(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<KnowledgeRow> {
    return this.move(ctx, actor, id, 'published', {
      permission: M18_PERMISSIONS.knowledgePublish,
      auditCode: M18_AUDIT_CODES.knowledgePublished,
      eventType: 'KnowledgePublished',
      reasonCode: 'published',
      freezeContent: true,
      approvalAction: 'published',
      expectedVersion,
    });
  }
  withdraw(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { expectedVersion: number; reason?: string | null },
  ): Promise<KnowledgeRow> {
    return this.move(ctx, actor, id, 'withdrawn', {
      permission: M18_PERMISSIONS.knowledgeWithdraw,
      auditCode: M18_AUDIT_CODES.knowledgeWithdrawn,
      eventType: 'KnowledgeWithdrawn',
      reasonCode: 'withdrawn',
      reason: input.reason ?? null,
      approvalAction: 'withdrawn',
      expectedVersion: input.expectedVersion,
    });
  }
  archive(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<KnowledgeRow> {
    return this.move(ctx, actor, id, 'archived', {
      permission: M18_PERMISSIONS.knowledgeArchive,
      auditCode: M18_AUDIT_CODES.knowledgeArchived,
      eventType: 'KnowledgeArchived',
      reasonCode: 'archived',
      expectedVersion,
    });
  }
  reopen(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<KnowledgeRow> {
    if (input.reason.trim() === '') throw badRequest('a reason is required to reopen', ctx.correlationId);
    return this.move(ctx, actor, id, 'reopened', {
      permission: M18_PERMISSIONS.knowledgeReopen,
      auditCode: M18_AUDIT_CODES.knowledgeReopened,
      eventType: 'KnowledgeReopened',
      reasonCode: 'reopened',
      reason: input.reason,
      expectedVersion: input.expectedVersion,
    });
  }

  /**
   * Supersession — the only way to change published content. Creates a NEW published version (version_number+1,
   * same knowledge_code), links supersedes_id/superseded_by_id both ways, and moves the prior version to
   * `superseded` so the one-published index (per knowledge_code) always holds exactly one live head. Maker-checker
   * applies to the successor: its approver (the actor) must differ from its submitter.
   */
  async supersede(
    ctx: RequestContext,
    actor: string | null,
    priorId: string,
    input: {
      expectedVersion: number;
      title?: string | null;
      summary?: string | null;
      abstract?: string | null;
      submittedBy?: string | null;
    },
  ): Promise<{ prior: KnowledgeRow; successor: KnowledgeRow }> {
    await this.authz.require(ctx, M18_PERMISSIONS.knowledgeSupersede);
    return this.db.withTenant(ctx, async (tx) => {
      const prior = await this.requireKnowledge(tx, priorId, ctx.correlationId);
      if (prior.status !== 'published')
        throw ProblemError.conflict('Only a published record can be superseded.', ctx.correlationId);
      const submittedBy = input.submittedBy ?? prior.submitted_by ?? prior.owner;
      if (submittedBy !== null && actor !== null && submittedBy === actor)
        throw ProblemError.conflict(
          'The successor submitter cannot also approve it (segregation of duties).',
          ctx.correlationId,
        );
      // 1) Move prior off `published` first so the successor can be inserted as the new published head.
      const supersededPrior = await this.repo.transitionKnowledge(tx, {
        id: priorId,
        expectedVersion: input.expectedVersion,
        toStatus: 'superseded',
        by: actor,
      });
      if (supersededPrior === null)
        throw ProblemError.conflict('Prior record modified concurrently (stale version).', ctx.correlationId);
      const nextVersion = prior.version_number + 1;
      const successor = await this.repo.insertKnowledge(tx, {
        tenantId: ctx.tenantId,
        knowledgeNumber: formatKnowledgeNumber(randomUUID()),
        knowledgeCode: prior.knowledge_code,
        versionNumber: nextVersion,
        knowledgeType: prior.knowledge_type,
        title: input.title ?? prior.title,
        summary: input.summary ?? prior.summary,
        abstract: input.abstract ?? prior.abstract,
        practiceArea: prior.practice_area,
        jurisdiction: prior.jurisdiction,
        authorityLevel: prior.authority_level,
        confidentiality: prior.confidentiality,
        privileged: prior.privileged,
        privilegeLevel: prior.privilege_level,
        riskLevel: prior.risk_level,
        source: prior.source,
        sourceReference: prior.source_reference,
        owner: prior.owner,
        effectiveDate: prior.effective_date,
        reviewDate: prior.review_date,
        expiryDate: prior.expiry_date,
        status: 'published',
        supersedesId: prior.id,
        contentHash: null,
        publicationDate: isoDate(this.clock.now()),
        submittedBy,
        approvedBy: actor,
        correlationId: ctx.correlationId,
        causationId: null,
        idempotencyKey: null,
        by: actor,
      });
      // Freeze the successor's content_hash against its own projection now that it exists.
      const hashed = await this.repo.transitionKnowledge(tx, {
        id: successor.id,
        expectedVersion: successor.version,
        toStatus: 'published',
        contentHash: contentHashOf(this.projection(successor)),
        by: actor,
      });
      // Link the prior version to its successor.
      const linkedPrior = await this.repo.transitionKnowledge(tx, {
        id: priorId,
        expectedVersion: supersededPrior.version,
        toStatus: 'superseded',
        supersededById: successor.id,
        by: actor,
      });
      const finalSuccessor = hashed ?? successor;
      const finalPrior = linkedPrior ?? supersededPrior;
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        knowledgeId: priorId,
        fromStatus: 'published',
        toStatus: 'superseded',
        reason: null,
        reasonCode: 'superseded',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        knowledgeId: successor.id,
        fromStatus: null,
        toStatus: 'published',
        reason: null,
        reasonCode: 'versioned',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertApprovalHistory(tx, {
        tenantId: ctx.tenantId,
        entityType: 'knowledge',
        entityId: successor.id,
        action: 'published',
        decision: null,
        by: actor,
        note: null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.knowledgeSuperseded,
        entityType: 'legaldoc_knowledge',
        entityId: priorId,
        detail: { supersededById: successor.id },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.knowledgeVersioned,
        entityType: 'legaldoc_knowledge',
        entityId: successor.id,
        detail: { supersedesId: priorId, versionNumber: nextVersion },
      });
      await this.emitEvent(tx, ctx, actor, 'KnowledgeSuperseded', {
        recordId: priorId,
        recordType: 'knowledge',
        fromStatus: 'published',
        toStatus: 'superseded',
        reasonCode: 'superseded',
      });
      await this.emitEvent(tx, ctx, actor, 'KnowledgeVersionCreated', {
        recordId: successor.id,
        recordType: 'knowledge',
        versionNumber: nextVersion,
        toStatus: 'published',
      });
      return { prior: finalPrior, successor: finalSuccessor };
    });
  }

  // --- references (opaque cross-module ids) -----------------------------------------------------
  async addReference(
    ctx: RequestContext,
    actor: string | null,
    knowledgeId: string,
    ref: CrossModuleRef,
  ): Promise<ReferenceRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.referenceManage);
    if (!isReferenceType(ref.refType)) throw badRequest('invalid reference type', ctx.correlationId);
    if (ref.targetId.trim() === '') throw badRequest('a target id is required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireKnowledge(tx, knowledgeId, ctx.correlationId);
      const row = await this.repo.insertReference(tx, {
        tenantId: ctx.tenantId,
        knowledgeId,
        refType: ref.refType,
        targetId: ref.targetId,
        label: ref.label ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      const isDocument = ref.refType === 'document';
      await this.emitter.recordAudit(tx, ctx, {
        code: isDocument ? M18_AUDIT_CODES.documentLinked : M18_AUDIT_CODES.referenceLinked,
        entityType: 'legaldoc_reference',
        entityId: row.id,
        detail: { refType: ref.refType },
      });
      await this.emitEvent(tx, ctx, actor, isDocument ? 'DocumentLinked' : 'ReferenceLinked', {
        recordId: knowledgeId,
        recordType: 'knowledge',
        refType: ref.refType,
      });
      return row;
    });
  }
  async listReferences(ctx: RequestContext, knowledgeId: string): Promise<ReferenceRow[]> {
    await this.authz.require(ctx, M18_PERMISSIONS.referenceRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listReferences(tx, knowledgeId));
  }

  // --- relationships (knowledge <-> knowledge) --------------------------------------------------
  async relate(
    ctx: RequestContext,
    actor: string | null,
    input: { fromKnowledgeId: string; toKnowledgeId: string; kind: string },
  ): Promise<RelationshipRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.relationshipManage);
    if (!isRelationshipKind(input.kind)) throw badRequest('invalid relationship kind', ctx.correlationId);
    if (isSelfRelation(input.fromKnowledgeId, input.toKnowledgeId))
      throw badRequest('a knowledge record cannot relate to itself', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const from = await this.repo.findKnowledge(tx, input.fromKnowledgeId);
      const to = await this.repo.findKnowledge(tx, input.toKnowledgeId);
      if (from === null || to === null)
        throw ProblemError.notFound('Both knowledge records must exist in this tenant.', ctx.correlationId);
      const existing = await this.repo.findActiveRelationship(
        tx,
        input.fromKnowledgeId,
        input.toKnowledgeId,
        input.kind,
      );
      if (existing !== null)
        throw ProblemError.conflict('That active relationship already exists.', ctx.correlationId);
      const row = await this.repo.insertRelationship(tx, {
        tenantId: ctx.tenantId,
        fromId: input.fromKnowledgeId,
        toId: input.toKnowledgeId,
        kind: input.kind,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.relationshipCreated,
        entityType: 'legaldoc_relationship',
        entityId: row.id,
        detail: { kind: input.kind },
      });
      await this.emitEvent(tx, ctx, actor, 'RelationshipCreated', {
        recordId: input.fromKnowledgeId,
        recordType: 'knowledge',
        entityType: 'relationship',
        entityId: row.id,
        reasonCode: input.kind,
      });
      return row;
    });
  }
  async retireRelationship(
    ctx: RequestContext,
    actor: string | null,
    relationshipId: string,
    expectedVersion: number,
  ): Promise<RelationshipRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.relationshipManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.retireRelationship(tx, { id: relationshipId, expectedVersion, by: actor });
      if (upd === null)
        throw ProblemError.conflict(
          'Relationship already retired or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.relationshipRetired,
        entityType: 'legaldoc_relationship',
        entityId: relationshipId,
        detail: {},
      });
      return upd;
    });
  }
  async listRelationships(ctx: RequestContext, knowledgeId: string): Promise<RelationshipRow[]> {
    await this.authz.require(ctx, M18_PERMISSIONS.relationshipRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRelationships(tx, knowledgeId));
  }

  // --- tags -------------------------------------------------------------------------------------
  async addTag(
    ctx: RequestContext,
    actor: string | null,
    knowledgeId: string,
    input: { taxonomyKind: string; taxonomyCode: string; label?: string | null },
  ): Promise<TagRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.tagManage);
    if (!isTaxonomyKind(input.taxonomyKind)) throw badRequest('invalid taxonomy kind', ctx.correlationId);
    if (input.taxonomyCode.trim() === '') throw badRequest('a taxonomy code is required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireKnowledge(tx, knowledgeId, ctx.correlationId);
      const existing = await this.repo.findTag(tx, knowledgeId, input.taxonomyKind, input.taxonomyCode);
      if (existing !== null) throw ProblemError.conflict('That tag is already assigned.', ctx.correlationId);
      const row = await this.repo.insertTag(tx, {
        tenantId: ctx.tenantId,
        knowledgeId,
        taxonomyKind: input.taxonomyKind,
        taxonomyCode: input.taxonomyCode,
        label: input.label ?? null,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.tagAdded,
        entityType: 'legaldoc_tag',
        entityId: row.id,
        detail: { taxonomyKind: input.taxonomyKind, taxonomyCode: input.taxonomyCode },
      });
      return row;
    });
  }
  async removeTag(
    ctx: RequestContext,
    _actor: string | null,
    knowledgeId: string,
    input: { taxonomyKind: string; taxonomyCode: string },
  ): Promise<void> {
    await this.authz.require(ctx, M18_PERMISSIONS.tagManage);
    await this.db.withTenant(ctx, async (tx) => {
      const removed = await this.repo.deleteTag(tx, knowledgeId, input.taxonomyKind, input.taxonomyCode);
      if (!removed) throw ProblemError.notFound('Tag not found.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.tagRemoved,
        entityType: 'legaldoc_tag',
        entityId: knowledgeId,
        detail: { taxonomyKind: input.taxonomyKind, taxonomyCode: input.taxonomyCode },
      });
    });
  }
  async listTags(ctx: RequestContext, knowledgeId: string): Promise<TagRow[]> {
    await this.authz.require(ctx, M18_PERMISSIONS.knowledgeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listTags(tx, knowledgeId));
  }

  // --- citations --------------------------------------------------------------------------------
  async addCitation(
    ctx: RequestContext,
    actor: string | null,
    knowledgeId: string,
    input: {
      authorityRef?: string | null;
      externalCitation?: string | null;
      pinpoint?: string | null;
      note?: string | null;
    },
  ): Promise<CitationRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.citationManage);
    if (
      input.authorityRef == null &&
      (input.externalCitation == null || input.externalCitation.trim() === '')
    )
      throw badRequest('an authority reference or external citation is required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireKnowledge(tx, knowledgeId, ctx.correlationId);
      const row = await this.repo.insertCitation(tx, {
        tenantId: ctx.tenantId,
        knowledgeId,
        authorityRef: input.authorityRef ?? null,
        externalCitation: input.externalCitation ?? null,
        pinpoint: input.pinpoint ?? null,
        note: input.note ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.citationAdded,
        entityType: 'legaldoc_citation',
        entityId: row.id,
        detail: {},
      });
      await this.emitEvent(tx, ctx, actor, 'CitationAdded', {
        recordId: knowledgeId,
        recordType: 'knowledge',
      });
      return row;
    });
  }
  async listCitations(ctx: RequestContext, knowledgeId: string): Promise<CitationRow[]> {
    await this.authz.require(ctx, M18_PERMISSIONS.knowledgeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listCitations(tx, knowledgeId));
  }

  // --- notes (privileged; content redaction) ----------------------------------------------------
  async addNote(
    ctx: RequestContext,
    actor: string | null,
    knowledgeId: string,
    input: { noteType?: string; headline?: string | null; content: string; confidentiality?: string },
  ): Promise<NoteRow> {
    const noteType = input.noteType ?? 'general';
    if (!isNoteType(noteType)) throw badRequest('invalid note type', ctx.correlationId);
    const restricted = isRestrictedNote(noteType);
    // A restricted note (confidential/privileged/strategy) requires the privileged-create permission.
    await this.authz.require(
      ctx,
      restricted ? M18_PERMISSIONS.privilegedCreate : M18_PERMISSIONS.knowledgeUpdate,
    );
    if (input.content.trim() === '' || input.content.length > LEGALDOCS_LIMITS.maxNoteChars)
      throw badRequest('note content is required and must be bounded', ctx.correlationId);
    const conf = input.confidentiality ?? (restricted ? 'privileged' : 'confidential');
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireKnowledge(tx, knowledgeId, ctx.correlationId);
      const row = await this.repo.insertNote(tx, {
        tenantId: ctx.tenantId,
        knowledgeId,
        noteType,
        headline: input.headline ?? null,
        content: input.content,
        confidentiality: conf,
        privileged: restricted,
        correlationId: ctx.correlationId,
        by: actor,
      });
      // Audit the FACT that a note was added (who/what/type/confidentiality) — the note headline/content
      // NEVER enters the audit payload (ADR-076). No event is published for note bodies.
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.noteAdded,
        entityType: 'legaldoc_note',
        entityId: row.id,
        detail: { knowledgeId, noteType, confidentiality: conf, privileged: restricted },
      });
      return row;
    });
  }
  async listNotes(
    ctx: RequestContext,
    knowledgeId: string,
  ): Promise<{ notes: NoteRow[]; canReadPrivileged: boolean }> {
    await this.authz.require(ctx, M18_PERMISSIONS.knowledgeRead);
    const canReadPrivileged = await this.authz.can(ctx, M18_PERMISSIONS.privilegedRead);
    const all = await this.db.withTenant(ctx, (tx) => this.repo.listNotes(tx, knowledgeId));
    const notes = canReadPrivileged ? all : all.filter((n) => !n.privileged);
    if (canReadPrivileged && all.some((n) => n.privileged))
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M18_AUDIT_CODES.privilegedAccessed,
          entityType: 'legaldoc_note',
          entityId: knowledgeId,
          detail: {},
        }),
      );
    return { notes, canReadPrivileged };
  }

  // --- reviews / expiry deadlines (deterministic, clock-driven) ---------------------------------
  async scheduleReview(
    ctx: RequestContext,
    actor: string | null,
    knowledgeId: string,
    input: { reviewType: string; rule: ReviewRule; startAt?: string | null; warnWindowMs?: number | null },
  ): Promise<ReviewRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.reviewManage);
    if (!isReviewType(input.reviewType)) throw badRequest('invalid review type', ctx.correlationId);
    const startMs = input.startAt != null ? Date.parse(input.startAt) : this.clock.now();
    const dueMs = computeReviewDueMs({ type: input.reviewType, startMs, rule: input.rule });
    if (!isExpirySafe(input.reviewType, dueMs, this.clock.now()))
      throw badRequest('an expiry review cannot be in the past', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireKnowledge(tx, knowledgeId, ctx.correlationId);
      const row = await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        knowledgeId,
        reviewType: input.reviewType,
        startAt: iso(startMs),
        dueAt: iso(dueMs),
        rule: input.rule,
        warnWindowMs: input.warnWindowMs ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.reviewScheduled,
        entityType: 'legaldoc_review',
        entityId: row.id,
        detail: { reviewType: input.reviewType },
      });
      await this.emitEvent(tx, ctx, actor, 'ReviewScheduled', {
        recordId: knowledgeId,
        recordType: 'knowledge',
        reasonCode: input.reviewType,
        dueAt: iso(dueMs),
      });
      return row;
    });
  }
  async completeReview(
    ctx: RequestContext,
    actor: string | null,
    reviewId: string,
    input: { expectedVersion: number; outcome?: string | null },
  ): Promise<ReviewRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.reviewManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.completeReview(tx, {
        id: reviewId,
        expectedVersion: input.expectedVersion,
        outcome: input.outcome ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Review not completable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.reviewCompleted,
        entityType: 'legaldoc_review',
        entityId: reviewId,
        detail: {},
      });
      await this.emitEvent(tx, ctx, actor, 'ReviewCompleted', {
        recordId: upd.knowledge_id,
        recordType: 'knowledge',
      });
      return upd;
    });
  }
  async listReviews(ctx: RequestContext, knowledgeId: string): Promise<ReviewRow[]> {
    await this.authz.require(ctx, M18_PERMISSIONS.reviewRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listReviews(tx, knowledgeId));
  }

  // --- usage analytics (append-only, safe dimensions) -------------------------------------------
  async recordUsage(
    ctx: RequestContext,
    knowledgeId: string,
    input: { usageType: string; actorRef?: string | null; contextRef?: string | null; note?: string | null },
  ): Promise<UsageRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.knowledgeRead);
    if (input.usageType.trim() === '') throw badRequest('a usage type is required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireKnowledge(tx, knowledgeId, ctx.correlationId);
      const row = await this.repo.insertUsage(tx, {
        tenantId: ctx.tenantId,
        knowledgeId,
        usageType: input.usageType,
        actorRef: input.actorRef ?? null,
        contextRef: input.contextRef ?? null,
        note: input.note ?? null,
        correlationId: ctx.correlationId,
      });
      // Audit the usage fact with safe dimensions only (knowledge id + usage type).
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.usageRecorded,
        entityType: 'legaldoc_usage',
        entityId: row.id,
        detail: { knowledgeId, usageType: input.usageType },
      });
      return row;
    });
  }
  async listUsage(ctx: RequestContext, knowledgeId: string): Promise<UsageRow[]> {
    await this.authz.require(ctx, M18_PERMISSIONS.analyticsRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listUsage(tx, knowledgeId));
  }

  // --- reads (with redaction) -------------------------------------------------------------------
  async get(
    ctx: RequestContext,
    id: string,
  ): Promise<{ knowledge: KnowledgeRow; canReadConfidential: boolean }> {
    await this.authz.require(ctx, M18_PERMISSIONS.knowledgeRead);
    const canReadConfidential = await this.authz.can(ctx, M18_PERMISSIONS.confidentialRead);
    const found = await this.db.withTenant(ctx, async (tx) => {
      const kn = await this.repo.findKnowledge(tx, id);
      if (kn !== null && canReadConfidential && (kn.confidentiality !== 'standard' || kn.privileged))
        await this.emitter.recordAudit(tx, ctx, {
          code: M18_AUDIT_CODES.confidentialAccessed,
          entityType: 'legaldoc_knowledge',
          entityId: id,
          detail: {},
        });
      return kn;
    });
    if (found === null) throw ProblemError.notFound('Knowledge record not found.', ctx.correlationId);
    return { knowledge: redactKnowledge(found, canReadConfidential), canReadConfidential };
  }
  async search(
    ctx: RequestContext,
    filters: {
      knowledgeType?: string;
      status?: string;
      practiceArea?: string;
      jurisdiction?: string;
      owner?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<{ results: KnowledgeRow[]; canReadConfidential: boolean }> {
    await this.authz.require(ctx, M18_PERMISSIONS.knowledgeRead);
    const canReadConfidential = await this.authz.can(ctx, M18_PERMISSIONS.confidentialRead);
    const rows = await this.db.withTenant(ctx, (tx) =>
      this.repo.searchKnowledge(tx, {
        ...filters,
        limit: Math.min(filters.limit ?? 50, LEGALDOCS_LIMITS.maxSearchLimit),
        offset: filters.offset ?? 0,
      }),
    );
    return { results: rows.map((r) => redactKnowledge(r, canReadConfidential)), canReadConfidential };
  }
  async analytics(ctx: RequestContext, dimension: string): Promise<{ dim: string | null; count: string }[]> {
    await this.authz.require(ctx, M18_PERMISSIONS.analyticsRead);
    return this.db.withTenant(ctx, (tx) => this.repo.analyticsByDimension(tx, dimension));
  }
}
