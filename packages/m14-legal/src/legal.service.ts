/**
 * MatterLegalService — the legal-analysis + outcome layer: PRIVILEGED legal positions/strategy, legal opinions,
 * external counsel + counsel reports, cost + exposure references (finance references only), settlement
 * (maker-checker), judgment/outcome, appeal + enforcement references, escalation (reuses m08 via an event),
 * deterministic SLA start, matter relationships, and safe aggregate analytics (G10-G12/G23-G30/G33/G37/G38).
 * Every mutating method enforces its permission (default deny), runs inside `db.withTenant`, records audit + a
 * legal.lifecycle event in the same tx, and is optimistic-lock guarded. A settlement proposer can NEVER approve
 * their own (segregation of duties, enforced in the service AND a DB CHECK). Legal positions/strategy, opinions,
 * counsel bank details and confidential settlement terms are never placed in events/audit (ADR-064). Costs +
 * exposure + enforcement store finance/court references only — no ledger, posting, payment, tax or reconciliation
 * (ADR-063). SLA + escalation timer dispatch is delegated to m06/m08.
 */
import { randomUUID } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M14_PERMISSIONS } from './permissions.ts';
import { M14_AUDIT_CODES } from './audit-codes.ts';
import { isConfidentiality, isOutcomeType, isEnforcementStage } from './domain/limits.ts';
import { isRelationshipKind, isSelfRelation } from './domain/closure.ts';
import { computeDueDates, type LegalSlaPolicySpec } from './domain/sla.ts';
import {
  LegalRepository,
  type MatterRow,
  type PositionRow,
  type OpinionRow,
  type ResearchRow,
  type CounselRow,
  type CounselReportRow,
  type CostRow,
  type SettlementRow,
  type OutcomeRow,
  type DeadlineRow,
  type RelationshipRow,
} from './repository.ts';
import type { M14Emitter } from './emit.ts';
import type { Clock } from './ports.ts';
import { SystemClock } from './ports.ts';
import { badRequest } from './errors.ts';

export class MatterLegalService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M14Emitter;
  private readonly repo: LegalRepository;
  private readonly clock: Clock;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M14Emitter,
    repo: LegalRepository = new LegalRepository(),
    clock: Clock = new SystemClock(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.clock = clock;
  }

  // --- legal positions (privileged) -------------------------------------------------------------
  async recordPosition(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      position?: string | null;
      strategy?: string | null;
      strengths?: string | null;
      weaknesses?: string | null;
      exposureSummary?: string | null;
      recommendedApproach?: string | null;
      settlementPosture?: string | null;
      limitationRisks?: string | null;
      reviewer?: string | null;
      confidentiality?: string;
    },
  ): Promise<PositionRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.positionManage);
    const conf = input.confidentiality ?? 'privileged';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, matterId);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      const p = await this.repo.insertPosition(tx, {
        tenantId: ctx.tenantId,
        matterId,
        position: input.position ?? null,
        strategy: input.strategy ?? null,
        strengths: input.strengths ?? null,
        weaknesses: input.weaknesses ?? null,
        exposureSummary: input.exposureSummary ?? null,
        recommendedApproach: input.recommendedApproach ?? null,
        settlementPosture: input.settlementPosture ?? null,
        limitationRisks: input.limitationRisks ?? null,
        reviewer: input.reviewer ?? null,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      // Legal strategy/position CONTENT never enters events/audit (ADR-064).
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.positionRecorded,
        entityType: 'legal_position',
        entityId: p.id,
        detail: {},
      });
      return p;
    });
  }
  async listPositions(
    ctx: RequestContext,
    matterId: string,
  ): Promise<{ positions: PositionRow[]; canRead: boolean }> {
    const canRead = await this.authz.can(ctx, M14_PERMISSIONS.positionRead);
    if (!canRead)
      throw ProblemError.forbidden(
        'Legal positions require the position-read permission.',
        ctx.correlationId,
      );
    const positions = await this.db.withTenant(ctx, (tx) => this.repo.listPositions(tx, matterId));
    await this.db.withTenant(ctx, (tx) =>
      this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.privilegedAccessed,
        entityType: 'legal_position',
        entityId: matterId,
        detail: {},
      }),
    );
    return { positions, canRead };
  }

  // --- opinions ---------------------------------------------------------------------------------
  async registerOpinion(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      opinionType?: string | null;
      questionPresented?: string | null;
      summaryConclusion?: string | null;
      riskRating?: string | null;
      recommendation?: string | null;
      documentRef?: string | null;
      confidentiality?: string;
      relatedIssue?: string | null;
    },
  ): Promise<OpinionRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.opinionManage);
    const conf = input.confidentiality ?? 'privileged';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, matterId);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      const o = await this.repo.insertOpinion(tx, {
        tenantId: ctx.tenantId,
        matterId,
        opinionType: input.opinionType ?? null,
        questionPresented: input.questionPresented ?? null,
        summaryConclusion: input.summaryConclusion ?? null,
        riskRating: input.riskRating ?? null,
        recommendation: input.recommendation ?? null,
        author: actor,
        documentRef: input.documentRef ?? null,
        confidentiality: conf,
        relatedIssue: input.relatedIssue ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.opinionRegistered,
        entityType: 'legal_opinion',
        entityId: o.id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'OpinionRegistered',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId },
      });
      return o;
    });
  }
  async listOpinions(
    ctx: RequestContext,
    matterId: string,
  ): Promise<{ opinions: OpinionRow[]; canReadConfidential: boolean }> {
    await this.authz.require(ctx, M14_PERMISSIONS.opinionRead);
    const canReadConfidential = await this.authz.can(ctx, M14_PERMISSIONS.confidentialRead);
    const opinions = await this.db.withTenant(ctx, (tx) => this.repo.listOpinions(tx, matterId));
    return { opinions, canReadConfidential };
  }

  // --- external counsel + reports ---------------------------------------------------------------
  async instructCounsel(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      lawFirmRef?: string | null;
      advocateRef?: string | null;
      instructionScope?: string | null;
      engagementReference?: string | null;
      reportingFrequency?: string | null;
    },
  ): Promise<CounselRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.externalCounselManage);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, matterId);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      const c = await this.repo.insertCounsel(tx, {
        tenantId: ctx.tenantId,
        matterId,
        lawFirmRef: input.lawFirmRef ?? null,
        advocateRef: input.advocateRef ?? null,
        instructionScope: input.instructionScope ?? null,
        engagementReference: input.engagementReference ?? null,
        reportingFrequency: input.reportingFrequency ?? null,
        internalOwner: actor,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.counselInstructed,
        entityType: 'legal_external_counsel',
        entityId: c.id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'ExternalCounselInstructed',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId },
      });
      return c;
    });
  }
  async updateCounsel(
    ctx: RequestContext,
    actor: string | null,
    counselId: string,
    input: {
      expectedVersion: number;
      status?: string | null;
      lastUpdateSummary?: string | null;
      nextReportDue?: string | null;
    },
  ): Promise<CounselRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.externalCounselManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateCounsel(tx, {
        id: counselId,
        expectedVersion: input.expectedVersion,
        status: input.status ?? null,
        lastUpdateSummary: input.lastUpdateSummary ?? null,
        nextReportDue: input.nextReportDue ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Counsel modified concurrently (stale version).', ctx.correlationId);
      return upd;
    });
  }
  async listCounsel(ctx: RequestContext, matterId: string): Promise<CounselRow[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.externalCounselRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listCounsel(tx, matterId));
  }
  async addCounselReport(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      counselId?: string | null;
      reportingPeriod?: string | null;
      statusSummary?: string | null;
      actionTaken?: string | null;
      nextAction?: string | null;
      risks?: string | null;
      documentRef?: string | null;
      confidentiality?: string;
    },
  ): Promise<CounselReportRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.counselReportManage);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, matterId);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      const r = await this.repo.insertCounselReport(tx, {
        tenantId: ctx.tenantId,
        matterId,
        counselId: input.counselId ?? null,
        reportingPeriod: input.reportingPeriod ?? null,
        statusSummary: input.statusSummary ?? null,
        actionTaken: input.actionTaken ?? null,
        nextAction: input.nextAction ?? null,
        risks: input.risks ?? null,
        documentRef: input.documentRef ?? null,
        author: actor,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.counselReportReceived,
        entityType: 'legal_counsel_report',
        entityId: r.id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'CounselReportReceived',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId },
      });
      return r;
    });
  }
  async listCounselReports(ctx: RequestContext, matterId: string): Promise<CounselReportRow[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.counselReportRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listCounselReports(tx, matterId));
  }

  // --- costs + exposure (references only) --------------------------------------------------------
  async recordCost(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      costType?: string | null;
      description?: string | null;
      amountMinor?: number | null;
      currency?: string | null;
      externalCounselRef?: string | null;
      invoiceReference?: string | null;
      recoverable?: boolean;
    },
  ): Promise<CostRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.costManage);
    if (input.amountMinor != null && (!Number.isInteger(input.amountMinor) || input.amountMinor < 0))
      throw badRequest('amountMinor must be a non-negative integer (minor units)', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, matterId);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      const c = await this.repo.insertCost(tx, {
        tenantId: ctx.tenantId,
        matterId,
        costType: input.costType ?? null,
        description: input.description ?? null,
        amountMinor: input.amountMinor ?? null,
        currency: input.currency ?? null,
        externalCounselRef: input.externalCounselRef ?? null,
        invoiceReference: input.invoiceReference ?? null,
        recoverable: input.recoverable === true,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.costRecorded,
        entityType: 'legal_cost_reference',
        entityId: c.id,
        detail: {},
      });
      return c;
    });
  }
  async listCosts(ctx: RequestContext, matterId: string): Promise<CostRow[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.costRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listCosts(tx, matterId));
  }
  async updateExposure(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      expectedVersion: number;
      claimAmountMinor?: number | null;
      exposureAmountMinor?: number | null;
      currency?: string | null;
    },
  ): Promise<MatterRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.exposureManage);
    for (const v of [input.claimAmountMinor, input.exposureAmountMinor])
      if (v != null && (!Number.isInteger(v) || v < 0))
        throw badRequest('exposure amounts are non-negative integer minor units', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, matterId);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      const upd = await this.repo.patchMatter(tx, {
        id: matterId,
        expectedVersion: input.expectedVersion,
        claimAmountMinor: input.claimAmountMinor ?? null,
        exposureAmountMinor: input.exposureAmountMinor ?? null,
        currency: input.currency ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Matter modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.exposureUpdated,
        entityType: 'legal_matter',
        entityId: matterId,
        detail: {},
      });
      return upd;
    });
  }

  // --- settlement (maker-checker; confidential terms redacted) -----------------------------------
  async proposeSettlement(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      proposal?: string | null;
      monetaryTerms?: string | null;
      confidentialTerms?: string | null;
      amountMinor?: number | null;
      currency?: string | null;
      nonMonetaryTerms?: string | null;
      settlementAuthority?: string | null;
      effectiveDate?: string | null;
      documentRef?: string | null;
      confidentiality?: string;
    },
  ): Promise<SettlementRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.settlementSubmit);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    if (input.amountMinor != null && (!Number.isInteger(input.amountMinor) || input.amountMinor < 0))
      throw badRequest('amountMinor must be a non-negative integer (minor units)', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, matterId);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      const s = await this.repo.insertSettlement(tx, {
        tenantId: ctx.tenantId,
        matterId,
        proposal: input.proposal ?? null,
        monetaryTerms: input.monetaryTerms ?? null,
        confidentialTerms: input.confidentialTerms ?? null,
        amountMinor: input.amountMinor ?? null,
        currency: input.currency ?? null,
        nonMonetaryTerms: input.nonMonetaryTerms ?? null,
        settlementAuthority: input.settlementAuthority ?? null,
        proposedBy: actor,
        effectiveDate: input.effectiveDate ?? null,
        documentRef: input.documentRef ?? null,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.settlementProposed,
        entityType: 'legal_settlement',
        entityId: s.id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'SettlementProposed',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId },
      });
      return s;
    });
  }
  async approveSettlement(
    ctx: RequestContext,
    actor: string | null,
    settlementId: string,
  ): Promise<SettlementRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.settlementApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const s = await this.repo.findSettlement(tx, settlementId);
      if (s === null) throw ProblemError.notFound('Settlement not found.', ctx.correlationId);
      if (s.proposed_by !== null && actor !== null && s.proposed_by === actor)
        throw ProblemError.conflict(
          'The settlement proposer cannot approve it (segregation of duties).',
          ctx.correlationId,
        );
      const upd = await this.repo.approveSettlement(tx, {
        id: settlementId,
        expectedVersion: s.version,
        approval: 'approved',
        approvedBy: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Settlement already decided or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.settlementApproved,
        entityType: 'legal_settlement',
        entityId: settlementId,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'SettlementApproved',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId: upd.matter_id },
      });
      return upd;
    });
  }
  async listSettlements(
    ctx: RequestContext,
    matterId: string,
  ): Promise<{ settlements: SettlementRow[]; canReadConfidential: boolean }> {
    await this.authz.require(ctx, M14_PERMISSIONS.settlementRead);
    const canReadConfidential = await this.authz.can(ctx, M14_PERMISSIONS.confidentialRead);
    const settlements = await this.db.withTenant(ctx, (tx) => this.repo.listSettlements(tx, matterId));
    return { settlements, canReadConfidential };
  }

  // --- judgment / outcome (append-only) ---------------------------------------------------------
  async recordOutcome(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      outcomeType: string;
      outcomeDate?: string | null;
      summary?: string | null;
      amountAwardedMinor?: number | null;
      currency?: string | null;
      costsAwardedMinor?: number | null;
      orders?: string | null;
      documentRef?: string | null;
      appealable?: boolean;
      appealDeadline?: string | null;
    },
  ): Promise<OutcomeRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.judgmentManage);
    if (!isOutcomeType(input.outcomeType)) throw badRequest('invalid outcome type', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, matterId);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      const o = await this.repo.insertOutcome(tx, {
        tenantId: ctx.tenantId,
        matterId,
        outcomeType: input.outcomeType,
        outcomeDate: input.outcomeDate ?? null,
        summary: input.summary ?? null,
        amountAwardedMinor: input.amountAwardedMinor ?? null,
        currency: input.currency ?? null,
        costsAwardedMinor: input.costsAwardedMinor ?? null,
        orders: input.orders ?? null,
        documentRef: input.documentRef ?? null,
        appealable: input.appealable === true,
        appealDeadline: input.appealDeadline ?? null,
        responsibleOfficer: actor,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.patchMatter(tx, {
        id: matterId,
        expectedVersion: m.version,
        finalOutcome: input.outcomeType,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.judgmentRecorded,
        entityType: 'legal_outcome',
        entityId: o.id,
        detail: { outcomeType: input.outcomeType },
      });
      await this.emitter.publish(tx, {
        type: 'JudgmentRecorded',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          matterId,
          ...(input.amountAwardedMinor != null ? { amountMinor: input.amountAwardedMinor } : {}),
        },
      });
      return o;
    });
  }
  async listOutcomes(ctx: RequestContext, matterId: string): Promise<OutcomeRow[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.judgmentRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listOutcomes(tx, matterId));
  }

  // --- appeal + enforcement (inline references) --------------------------------------------------
  async updateAppeal(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      expectedVersion: number;
      appealStatus?: string | null;
      appealForum?: string | null;
      appealDeadline?: string | null;
    },
  ): Promise<MatterRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.appealManage);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, matterId);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      const upd = await this.repo.patchMatter(tx, {
        id: matterId,
        expectedVersion: input.expectedVersion,
        appealStatus: input.appealStatus ?? null,
        appealForum: input.appealForum ?? null,
        appealDeadline: input.appealDeadline ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Matter modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.appealInitiated,
        entityType: 'legal_matter',
        entityId: matterId,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'AppealInitiated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId },
      });
      return upd;
    });
  }
  async updateEnforcement(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: { expectedVersion: number; enforcementStage?: string | null; recoveredMinor?: number | null },
  ): Promise<MatterRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.enforcementManage);
    if (input.enforcementStage != null && !isEnforcementStage(input.enforcementStage))
      throw badRequest('invalid enforcement stage', ctx.correlationId);
    if (input.recoveredMinor != null && (!Number.isInteger(input.recoveredMinor) || input.recoveredMinor < 0))
      throw badRequest('recovered amount is a non-negative integer minor unit', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, matterId);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      const upd = await this.repo.patchMatter(tx, {
        id: matterId,
        expectedVersion: input.expectedVersion,
        enforcementStage: input.enforcementStage ?? null,
        enforcementRecoveredMinor: input.recoveredMinor ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Matter modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.enforcementUpdated,
        entityType: 'legal_matter',
        entityId: matterId,
        detail: { enforcementStage: input.enforcementStage },
      });
      await this.emitter.publish(tx, {
        type: 'EnforcementUpdated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId },
      });
      return upd;
    });
  }

  // --- escalation (reuses m08 via an event; m14 builds no second escalation engine) --------------
  async triggerEscalation(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: { reason: string },
  ): Promise<string> {
    await this.authz.require(ctx, M14_PERMISSIONS.matterUpdate);
    if (input.reason.trim() === '') throw badRequest('a reason is required to escalate', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, matterId);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      const escalationRef = m.escalation_ref ?? randomUUID();
      await this.repo.patchMatter(tx, { id: matterId, expectedVersion: m.version, escalationRef, by: actor });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.escalationTriggered,
        entityType: 'legal_matter',
        entityId: matterId,
        reason: input.reason,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'MatterEscalated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          matterId,
          ...(m.legal_risk != null ? { legalRisk: m.legal_risk } : {}),
          reasonCode: 'manual',
        },
      });
      return escalationRef;
    });
  }

  // --- deterministic SLA (materializes stage deadlines) -----------------------------------------
  async startSla(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    policyCode: string,
  ): Promise<DeadlineRow[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.deadlineManage);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, matterId);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      const policy = await this.repo.findActiveSlaPolicy(tx, policyCode);
      if (policy === null)
        throw ProblemError.conflict('No active SLA policy for that code.', ctx.correlationId);
      const spec = policy.spec as LegalSlaPolicySpec;
      const startMs = this.clock.now();
      const due = computeDueDates(spec, startMs);
      const iso = (ms: number): string => new Date(ms).toISOString();
      const stages: { type: string; ms: number }[] = [
        { type: 'response', ms: due.reviewAtMs },
        { type: 'submissions', ms: due.pleadingAtMs },
        { type: 'internal_instruction', ms: due.resolutionAtMs },
      ];
      const rows: DeadlineRow[] = [];
      for (const s of stages) {
        rows.push(
          await this.repo.insertDeadline(tx, {
            tenantId: ctx.tenantId,
            matterId,
            deadlineType: s.type,
            startAt: iso(startMs),
            dueAt: iso(s.ms),
            calculationRule: 'sla_policy',
            source: policyCode,
            authority: null,
            linkedTask: null,
            linkedActivity: null,
            correlationId: ctx.correlationId,
            by: actor,
          }),
        );
      }
      await this.repo.patchMatter(tx, {
        id: matterId,
        expectedVersion: m.version,
        slaPolicyCode: policyCode,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.slaStarted,
        entityType: 'legal_matter',
        entityId: matterId,
        detail: { policyCode },
      });
      return rows;
    });
  }

  // --- relationships ----------------------------------------------------------------------------
  async link(
    ctx: RequestContext,
    actor: string | null,
    input: { fromMatterId: string; toMatterId: string; kind: string },
  ): Promise<RelationshipRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.relationshipManage);
    if (!isRelationshipKind(input.kind)) throw badRequest('invalid relationship kind', ctx.correlationId);
    if (isSelfRelation(input.fromMatterId, input.toMatterId))
      throw badRequest('a matter cannot relate to itself', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const from = await this.repo.findMatter(tx, input.fromMatterId);
      const to = await this.repo.findMatter(tx, input.toMatterId);
      if (from === null || to === null)
        throw ProblemError.notFound('Both matters must exist in this tenant.', ctx.correlationId);
      if (
        input.kind === 'duplicate_of' ||
        input.kind === 'consolidated_with' ||
        input.kind === 'parent_of' ||
        input.kind === 'child_of'
      ) {
        const reverse = await this.repo.findReverseRelationship(
          tx,
          input.fromMatterId,
          input.toMatterId,
          input.kind === 'parent_of' ? 'child_of' : input.kind === 'child_of' ? 'parent_of' : input.kind,
        );
        if (reverse !== null)
          throw ProblemError.conflict(
            'The reverse relationship already exists (cycle rejected).',
            ctx.correlationId,
          );
      }
      const row = await this.repo.insertRelationship(tx, {
        tenantId: ctx.tenantId,
        fromId: input.fromMatterId,
        toId: input.toMatterId,
        kind: input.kind,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.relationshipCreated,
        entityType: 'legal_relationship',
        entityId: row.id,
        detail: { kind: input.kind },
      });
      return row;
    });
  }
  async listRelationships(ctx: RequestContext, matterId: string): Promise<RelationshipRow[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.relationshipRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRelationships(tx, matterId));
  }

  // --- research (read, mirrors work.service create) ---------------------------------------------
  async listResearch(ctx: RequestContext, matterId: string): Promise<ResearchRow[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.researchRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listResearch(tx, matterId));
  }

  // --- analytics --------------------------------------------------------------------------------
  async analytics(ctx: RequestContext, dimension: string): Promise<{ dim: string | null; count: string }[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.analyticsRead);
    return this.db.withTenant(ctx, (tx) => this.repo.analyticsByDimension(tx, dimension));
  }
}
