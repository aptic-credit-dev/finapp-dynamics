/**
 * CatalogService — the legal reference-data catalog: the configurable taxonomy (practice areas, jurisdictions,
 * legal topics, document types, tags), legal authorities + their append-only treatment history, precedents, legal
 * opinions (maker-checker approval, approved_by <> author) and research notes. Every mutating method enforces its
 * permission (default deny), runs inside `db.withTenant`, and records audit + a `legaldocs.lifecycle` event (where
 * one exists) in the SAME transaction. Nothing is hardcoded: taxonomy VALUES are tenant data retired via `active`.
 * Privileged/confidential text — opinion conclusion/recommendation, research findings, precedent holdings — is
 * RLS-stored and NEVER placed in events/audit (ADR-076).
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M18_PERMISSIONS } from './permissions.ts';
import { M18_AUDIT_CODES } from './audit-codes.ts';
import {
  isTaxonomyKind,
  isAuthorityType,
  isAuthorityTreatment,
  isAuthorityLevel,
  isConfidentiality,
  isPrivilegeLevel,
  isRiskLevel,
  LEGALDOCS_LIMITS,
} from './domain/limits.ts';
import {
  LegalDocsRepository,
  type TaxonomyRow,
  type AuthorityRow,
  type AuthorityTreatmentRow,
  type PrecedentRow,
  type OpinionRow,
  type ResearchRow,
} from './repository.ts';
import type { M18Emitter } from './emit.ts';
import { badRequest } from './errors.ts';

function assertTitle(title: string, correlationId: string): void {
  if (title.trim() === '' || title.length > LEGALDOCS_LIMITS.maxTitleChars)
    throw badRequest('a title is required and must be bounded', correlationId);
}

export class CatalogService {
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

  // --- taxonomy (configurable classification) ---------------------------------------------------
  async createTaxonomy(
    ctx: RequestContext,
    actor: string | null,
    input: {
      kind: string;
      code: string;
      label: string;
      parentCode?: string | null;
      jurisdiction?: string | null;
      description?: string | null;
    },
  ): Promise<TaxonomyRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.taxonomyManage);
    if (!isTaxonomyKind(input.kind)) throw badRequest('invalid taxonomy kind', ctx.correlationId);
    if (input.code.trim() === '' || input.label.trim() === '')
      throw badRequest('a code and label are required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.repo.findActiveTaxonomy(tx, input.kind, input.code);
      if (existing !== null)
        throw ProblemError.conflict(
          'An active taxonomy entry with that code already exists.',
          ctx.correlationId,
        );
      const row = await this.repo.insertTaxonomy(tx, {
        tenantId: ctx.tenantId,
        kind: input.kind,
        code: input.code,
        label: input.label,
        parentCode: input.parentCode ?? null,
        jurisdiction: input.jurisdiction ?? null,
        description: input.description ?? null,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.taxonomyCreated,
        entityType: 'legaldoc_taxonomy',
        entityId: row.id,
        detail: { kind: input.kind, code: input.code },
      });
      return row;
    });
  }
  async updateTaxonomy(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      label?: string | null;
      parentCode?: string | null;
      jurisdiction?: string | null;
      description?: string | null;
    },
  ): Promise<TaxonomyRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.taxonomyManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateTaxonomy(tx, {
        id,
        expectedVersion: input.expectedVersion,
        label: input.label ?? null,
        parentCode: input.parentCode ?? null,
        jurisdiction: input.jurisdiction ?? null,
        description: input.description ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Taxonomy entry retired or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.taxonomyUpdated,
        entityType: 'legaldoc_taxonomy',
        entityId: id,
        detail: {},
      });
      return upd;
    });
  }
  async retireTaxonomy(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<TaxonomyRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.taxonomyManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.retireTaxonomy(tx, { id, expectedVersion, by: actor });
      if (upd === null)
        throw ProblemError.conflict(
          'Taxonomy entry already retired or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.taxonomyRetired,
        entityType: 'legaldoc_taxonomy',
        entityId: id,
        detail: {},
      });
      return upd;
    });
  }
  async listTaxonomy(ctx: RequestContext, kind: string): Promise<TaxonomyRow[]> {
    await this.authz.require(ctx, M18_PERMISSIONS.taxonomyRead);
    if (!isTaxonomyKind(kind)) throw badRequest('invalid taxonomy kind', ctx.correlationId);
    return this.db.withTenant(ctx, (tx) => this.repo.listTaxonomy(tx, kind));
  }

  // --- authorities + treatments -----------------------------------------------------------------
  async registerAuthority(
    ctx: RequestContext,
    actor: string | null,
    input: {
      authorityType: string;
      title: string;
      citation?: string | null;
      jurisdiction?: string | null;
      issuingBody?: string | null;
      court?: string | null;
      decisionDate?: string | null;
      effectiveDate?: string | null;
      authorityLevel?: string | null;
      treatment?: string | null;
      relevance?: string | null;
      sourceReference?: string | null;
      documentRef?: string | null;
      notes?: string | null;
      confidentiality?: string;
    },
  ): Promise<AuthorityRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.authorityManage);
    if (!isAuthorityType(input.authorityType)) throw badRequest('invalid authority type', ctx.correlationId);
    assertTitle(input.title, ctx.correlationId);
    if (input.authorityLevel != null && !isAuthorityLevel(input.authorityLevel))
      throw badRequest('invalid authority level', ctx.correlationId);
    if (input.treatment != null && !isAuthorityTreatment(input.treatment))
      throw badRequest('invalid treatment', ctx.correlationId);
    const conf = input.confidentiality ?? 'standard';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertAuthority(tx, {
        tenantId: ctx.tenantId,
        authorityType: input.authorityType,
        title: input.title,
        citation: input.citation ?? null,
        jurisdiction: input.jurisdiction ?? null,
        issuingBody: input.issuingBody ?? null,
        court: input.court ?? null,
        decisionDate: input.decisionDate ?? null,
        effectiveDate: input.effectiveDate ?? null,
        authorityLevel: input.authorityLevel ?? null,
        treatment: input.treatment ?? null,
        relevance: input.relevance ?? null,
        sourceReference: input.sourceReference ?? null,
        documentRef: input.documentRef ?? null,
        notes: input.notes ?? null,
        confidentiality: conf,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.authorityRegistered,
        entityType: 'legaldoc_authority',
        entityId: row.id,
        detail: { authorityType: input.authorityType },
      });
      await this.publish(tx, ctx, actor, 'AuthorityRegistered', {
        recordId: row.id,
        recordType: 'authority',
        ...(input.jurisdiction != null ? { jurisdiction: input.jurisdiction } : {}),
        ...(input.authorityLevel != null ? { authorityLevel: input.authorityLevel } : {}),
      });
      return row;
    });
  }
  async updateAuthority(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      title?: string | null;
      citation?: string | null;
      jurisdiction?: string | null;
      authorityLevel?: string | null;
      status?: string | null;
      treatment?: string | null;
      relevance?: string | null;
      notes?: string | null;
    },
  ): Promise<AuthorityRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.authorityManage);
    if (input.authorityLevel != null && !isAuthorityLevel(input.authorityLevel))
      throw badRequest('invalid authority level', ctx.correlationId);
    if (input.treatment != null && !isAuthorityTreatment(input.treatment))
      throw badRequest('invalid treatment', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateAuthority(tx, {
        id,
        expectedVersion: input.expectedVersion,
        title: input.title ?? null,
        citation: input.citation ?? null,
        jurisdiction: input.jurisdiction ?? null,
        authorityLevel: input.authorityLevel ?? null,
        status: input.status ?? null,
        treatment: input.treatment ?? null,
        relevance: input.relevance ?? null,
        notes: input.notes ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Authority modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.authorityUpdated,
        entityType: 'legaldoc_authority',
        entityId: id,
        detail: {},
      });
      return upd;
    });
  }
  /** Records an append-only treatment (followed / distinguished / overruled / ...) against an authority. */
  async recordTreatment(
    ctx: RequestContext,
    actor: string | null,
    authorityId: string,
    input: { treatment: string; byAuthorityRef?: string | null; note?: string | null },
  ): Promise<AuthorityTreatmentRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.authorityTreat);
    if (!isAuthorityTreatment(input.treatment)) throw badRequest('invalid treatment', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const auth = await this.repo.findAuthority(tx, authorityId);
      if (auth === null) throw ProblemError.notFound('Authority not found.', ctx.correlationId);
      const row = await this.repo.insertAuthorityTreatment(tx, {
        tenantId: ctx.tenantId,
        authorityId,
        treatment: input.treatment,
        byAuthorityRef: input.byAuthorityRef ?? null,
        treatedBy: actor,
        note: input.note ?? null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.authorityTreated,
        entityType: 'legaldoc_authority',
        entityId: authorityId,
        detail: { treatment: input.treatment },
      });
      await this.publish(tx, ctx, actor, 'AuthorityTreated', {
        recordId: authorityId,
        recordType: 'authority',
        reasonCode: input.treatment,
      });
      return row;
    });
  }
  async listAuthorities(
    ctx: RequestContext,
    filters: { authorityType?: string; jurisdiction?: string },
  ): Promise<AuthorityRow[]> {
    await this.authz.require(ctx, M18_PERMISSIONS.authorityRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listAuthorities(tx, filters));
  }
  async listTreatments(ctx: RequestContext, authorityId: string): Promise<AuthorityTreatmentRow[]> {
    await this.authz.require(ctx, M18_PERMISSIONS.authorityRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listTreatments(tx, authorityId));
  }

  // --- precedents (holding is SENSITIVE) --------------------------------------------------------
  async registerPrecedent(
    ctx: RequestContext,
    actor: string | null,
    input: {
      title: string;
      summary?: string | null;
      court?: string | null;
      decisionDate?: string | null;
      holding?: string | null;
      principle?: string | null;
      jurisdiction?: string | null;
      documentRef?: string | null;
      relatedAuthority?: string | null;
      confidentiality?: string;
    },
  ): Promise<PrecedentRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.precedentManage);
    assertTitle(input.title, ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertPrecedent(tx, {
        tenantId: ctx.tenantId,
        title: input.title,
        summary: input.summary ?? null,
        court: input.court ?? null,
        decisionDate: input.decisionDate ?? null,
        holding: input.holding ?? null,
        principle: input.principle ?? null,
        jurisdiction: input.jurisdiction ?? null,
        documentRef: input.documentRef ?? null,
        relatedAuthority: input.relatedAuthority ?? null,
        confidentiality: conf,
        by: actor,
      });
      // The holding / principle are SENSITIVE legal analysis — only safe identifiers reach audit/event (ADR-076).
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.precedentRegistered,
        entityType: 'legaldoc_precedent',
        entityId: row.id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'PrecedentRegistered', {
        recordId: row.id,
        recordType: 'precedent',
        ...(input.jurisdiction != null ? { jurisdiction: input.jurisdiction } : {}),
      });
      return row;
    });
  }
  async updatePrecedent(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      title?: string | null;
      summary?: string | null;
      holding?: string | null;
      principle?: string | null;
      status?: string | null;
    },
  ): Promise<PrecedentRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.precedentManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updatePrecedent(tx, {
        id,
        expectedVersion: input.expectedVersion,
        title: input.title ?? null,
        summary: input.summary ?? null,
        holding: input.holding ?? null,
        principle: input.principle ?? null,
        status: input.status ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Precedent modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.precedentUpdated,
        entityType: 'legaldoc_precedent',
        entityId: id,
        detail: {},
      });
      return upd;
    });
  }
  async listPrecedents(ctx: RequestContext, jurisdiction?: string): Promise<PrecedentRow[]> {
    await this.authz.require(ctx, M18_PERMISSIONS.precedentRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listPrecedents(tx, jurisdiction));
  }

  // --- opinions (PRIVILEGED; maker-checker approval) --------------------------------------------
  async registerOpinion(
    ctx: RequestContext,
    actor: string | null,
    input: {
      title: string;
      question?: string | null;
      conclusion?: string | null;
      riskRating?: string | null;
      recommendation?: string | null;
      jurisdiction?: string | null;
      author?: string | null;
      documentRef?: string | null;
      relatedMatter?: string | null;
      confidentiality?: string;
      privilegeLevel?: string;
    },
  ): Promise<OpinionRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.opinionManage);
    assertTitle(input.title, ctx.correlationId);
    if (input.riskRating != null && !isRiskLevel(input.riskRating))
      throw badRequest('invalid risk rating', ctx.correlationId);
    const conf = input.confidentiality ?? 'privileged';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    const priv = input.privilegeLevel ?? 'attorney_client';
    if (!isPrivilegeLevel(priv)) throw badRequest('invalid privilege level', ctx.correlationId);
    // The author defaults to the acting identity so maker-checker can enforce approver <> author at approval time.
    const author = input.author ?? actor;
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertOpinion(tx, {
        tenantId: ctx.tenantId,
        title: input.title,
        question: input.question ?? null,
        conclusion: input.conclusion ?? null,
        riskRating: input.riskRating ?? null,
        recommendation: input.recommendation ?? null,
        jurisdiction: input.jurisdiction ?? null,
        author,
        documentRef: input.documentRef ?? null,
        relatedMatter: input.relatedMatter ?? null,
        confidentiality: conf,
        privilegeLevel: priv,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertApprovalHistory(tx, {
        tenantId: ctx.tenantId,
        entityType: 'opinion',
        entityId: row.id,
        action: 'registered',
        decision: null,
        by: actor,
        note: null,
        correlationId: ctx.correlationId,
      });
      // Conclusion / recommendation are PRIVILEGED — never in audit/event (ADR-076).
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.opinionRegistered,
        entityType: 'legaldoc_opinion',
        entityId: row.id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'OpinionRegistered', {
        recordId: row.id,
        recordType: 'opinion',
        confidentiality: conf,
        privileged: true,
      });
      return row;
    });
  }
  /** Maker-checker approval: the approver must not be the opinion author (enforced here AND by the DB CHECK). */
  async approveOpinion(
    ctx: RequestContext,
    actor: string | null,
    opinionId: string,
    input: { expectedVersion: number; decision?: 'approved' | 'rejected'; note?: string | null },
  ): Promise<OpinionRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.opinionApprove);
    const decision = input.decision ?? 'approved';
    return this.db.withTenant(ctx, async (tx) => {
      const op = await this.repo.findOpinion(tx, opinionId);
      if (op === null) throw ProblemError.notFound('Opinion not found.', ctx.correlationId);
      if (op.author !== null && actor !== null && op.author === actor)
        throw ProblemError.conflict(
          'The opinion author cannot approve it (segregation of duties).',
          ctx.correlationId,
        );
      const upd = await this.repo.approveOpinion(tx, {
        id: opinionId,
        expectedVersion: input.expectedVersion,
        decision,
        approvedBy: actor,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Opinion not approvable or modified concurrently.', ctx.correlationId);
      await this.repo.insertApprovalHistory(tx, {
        tenantId: ctx.tenantId,
        entityType: 'opinion',
        entityId: opinionId,
        action: 'approved',
        decision,
        by: actor,
        note: input.note ?? null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.opinionApproved,
        entityType: 'legaldoc_opinion',
        entityId: opinionId,
        detail: { decision },
      });
      await this.publish(tx, ctx, actor, 'OpinionApproved', {
        recordId: opinionId,
        recordType: 'opinion',
        reasonCode: decision,
      });
      return upd;
    });
  }
  async listOpinions(ctx: RequestContext, relatedMatter?: string): Promise<OpinionRow[]> {
    await this.authz.require(ctx, M18_PERMISSIONS.opinionRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listOpinions(tx, relatedMatter));
  }

  // --- research (findings are SENSITIVE) --------------------------------------------------------
  async registerResearch(
    ctx: RequestContext,
    actor: string | null,
    input: {
      title: string;
      question?: string | null;
      findings?: string | null;
      author?: string | null;
      jurisdiction?: string | null;
      practiceArea?: string | null;
      documentRef?: string | null;
      confidentiality?: string;
    },
  ): Promise<ResearchRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.researchManage);
    assertTitle(input.title, ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertResearch(tx, {
        tenantId: ctx.tenantId,
        title: input.title,
        question: input.question ?? null,
        findings: input.findings ?? null,
        author: input.author ?? actor,
        jurisdiction: input.jurisdiction ?? null,
        practiceArea: input.practiceArea ?? null,
        documentRef: input.documentRef ?? null,
        confidentiality: conf,
        by: actor,
      });
      // Findings are SENSITIVE — only safe identifiers reach audit/event (ADR-076).
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.researchRegistered,
        entityType: 'legaldoc_research',
        entityId: row.id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'ResearchRegistered', {
        recordId: row.id,
        recordType: 'research',
        ...(input.practiceArea != null ? { practiceArea: input.practiceArea } : {}),
      });
      return row;
    });
  }
  async updateResearch(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      title?: string | null;
      question?: string | null;
      findings?: string | null;
      status?: string | null;
    },
  ): Promise<ResearchRow> {
    await this.authz.require(ctx, M18_PERMISSIONS.researchManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateResearch(tx, {
        id,
        expectedVersion: input.expectedVersion,
        title: input.title ?? null,
        question: input.question ?? null,
        findings: input.findings ?? null,
        status: input.status ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Research modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M18_AUDIT_CODES.researchUpdated,
        entityType: 'legaldoc_research',
        entityId: id,
        detail: {},
      });
      return upd;
    });
  }
  async listResearch(ctx: RequestContext, practiceArea?: string): Promise<ResearchRow[]> {
    await this.authz.require(ctx, M18_PERMISSIONS.researchRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listResearch(tx, practiceArea));
  }

  // --- shared publish helper --------------------------------------------------------------------
  private async publish(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    type: Parameters<M18Emitter['publish']>[1]['type'],
    payload: Parameters<M18Emitter['publish']>[1]['payload'],
  ): Promise<void> {
    await this.emitter.publish(tx, {
      type,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor !== null ? { actor } : {}),
      payload,
    });
  }
}
