/**
 * LitigationWorkService — the structured working entities of a litigation proceeding: filings (maker-checker),
 * service of process (single-winner verification), appearances/diary, hearing records, witnesses, experts,
 * exhibits (single-winner admission), hearing bundles (maker-checker), orders, compliance obligations,
 * rulings/judgments (append-only), appeals (one active), deterministic deadlines/limitation, cost references,
 * notes, relationships, SLA materialization, escalation and the safe downstream boundary signals for m17/m18.
 * Every mutating method enforces its permission (default deny), runs inside `db.withTenant`, records audit + a
 * litigation.lifecycle event (where one exists) in the same tx, and is optimistic-lock/CAS guarded. Private
 * witness/party contacts, privileged/counsel/strategy notes, legal strategy, full pleadings/submissions and
 * confidential order/outcome terms are RLS-stored, redacted on read, and never in events/audit (ADR-068). Full
 * documents live in m09; costs store court + finance REFERENCES only — no ledger/posting/payment (ADR-067).
 */
import { randomUUID } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { LitigationLifecycleEventType } from '@finapp/contracts';
import { M16_PERMISSIONS } from './permissions.ts';
import { M16_AUDIT_CODES } from './audit-codes.ts';
import {
  isConfidentiality,
  isFilingRole,
  isServiceMethod,
  isAppearanceType,
  isWitnessType,
  isOrderType,
  isOutcomeType,
  isDeadlineType,
  isCostType,
  isNoteType,
  isRestrictedNote,
  LITIGATION_LIMITS,
} from './domain/limits.ts';
import { isRelationshipKind, isSelfRelation } from './domain/closure.ts';
import {
  computeDeadlineDueMs,
  deadlineState,
  isLimitationSafe,
  type DeadlineRule,
} from './domain/deadlines.ts';
import { computeDueDates, type LitigationSlaPolicySpec } from './domain/sla.ts';
import {
  LitigationRepository,
  type FilingRow,
  type ServiceRow,
  type AppearanceRow,
  type ProceedingRecordRow,
  type WitnessRow,
  type ExpertRow,
  type ExhibitRow,
  type BundleRow,
  type BundleItemRow,
  type OrderRow,
  type ComplianceRow,
  type OutcomeRow,
  type AppealRow,
  type DeadlineRow,
  type CostRow,
  type NoteRow,
  type RelationshipRow,
} from './repository.ts';
import type { M16Emitter } from './emit.ts';
import type { Clock } from './ports.ts';
import { SystemClock } from './ports.ts';
import { badRequest } from './errors.ts';

const iso = (ms: number): string => new Date(ms).toISOString();

export class LitigationWorkService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M16Emitter;
  private readonly repo: LitigationRepository;
  private readonly clock: Clock;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M16Emitter,
    repo: LitigationRepository = new LitigationRepository(),
    clock: Clock = new SystemClock(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.clock = clock;
  }

  private async requireProceeding(
    tx: Parameters<Parameters<Db['withTenant']>[1]>[0],
    id: string,
    correlationId: string,
  ) {
    const p = await this.repo.findProceeding(tx, id);
    if (p === null) throw ProblemError.notFound('Proceeding not found.', correlationId);
    return p;
  }
  private async publish(
    tx: Parameters<Parameters<Db['withTenant']>[1]>[0],
    ctx: RequestContext,
    actor: string | null,
    type: LitigationLifecycleEventType,
    payload: Record<string, unknown> & { proceedingId: string },
  ): Promise<void> {
    await this.emitter.publish(tx, {
      type,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor !== null ? { actor } : {}),
      payload,
    });
  }

  // --- filings (maker-checker) ------------------------------------------------------------------
  async registerFiling(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      filingRole: string;
      documentRef?: string | null;
      documentVersion?: number | null;
      receivingRegistry?: string | null;
      filingReference?: string | null;
      privileged?: boolean;
      confidentiality?: string;
    },
  ): Promise<FilingRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.filingManage);
    if (!isFilingRole(input.filingRole)) throw badRequest('invalid filing role', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const f = await this.repo.insertFiling(tx, {
        tenantId: ctx.tenantId,
        proceedingId,
        filingRole: input.filingRole,
        documentRef: input.documentRef ?? null,
        documentVersion: input.documentVersion ?? null,
        preparedBy: actor,
        receivingRegistry: input.receivingRegistry ?? null,
        filingReference: input.filingReference ?? null,
        privileged: input.privileged === true,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.filingRegistered,
        entityType: 'litigation_filing',
        entityId: f.id,
        detail: { filingRole: input.filingRole },
      });
      await this.publish(tx, ctx, actor, 'FilingRegistered', { proceedingId });
      return f;
    });
  }
  async reviewFiling(
    ctx: RequestContext,
    actor: string | null,
    filingId: string,
    expectedVersion: number,
  ): Promise<FilingRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.filingManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.reviewFiling(tx, { id: filingId, expectedVersion, by: actor });
      if (upd === null)
        throw ProblemError.conflict('Filing not reviewable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.filingReviewed,
        entityType: 'litigation_filing',
        entityId: filingId,
        detail: {},
      });
      return upd;
    });
  }
  async approveFiling(
    ctx: RequestContext,
    actor: string | null,
    filingId: string,
    expectedVersion: number,
  ): Promise<FilingRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.filingApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const f = await this.repo.findFiling(tx, filingId);
      if (f === null) throw ProblemError.notFound('Filing not found.', ctx.correlationId);
      if (f.prepared_by !== null && actor !== null && f.prepared_by === actor)
        throw ProblemError.conflict(
          'The filing preparer cannot approve it (segregation of duties).',
          ctx.correlationId,
        );
      const upd = await this.repo.approveFiling(tx, { id: filingId, expectedVersion, approvedBy: actor });
      if (upd === null)
        throw ProblemError.conflict('Filing not approvable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.filingApproved,
        entityType: 'litigation_filing',
        entityId: filingId,
        detail: {},
      });
      return upd;
    });
  }
  async fileFiling(
    ctx: RequestContext,
    actor: string | null,
    filingId: string,
    input: { expectedVersion: number; courtStampReference?: string | null },
  ): Promise<FilingRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.filingManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.fileFiling(tx, {
        id: filingId,
        expectedVersion: input.expectedVersion,
        courtStampReference: input.courtStampReference ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Filing not fileable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.filingFiled,
        entityType: 'litigation_filing',
        entityId: filingId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'FilingFiled', { proceedingId: upd.proceeding_id });
      return upd;
    });
  }
  async listFilings(ctx: RequestContext, proceedingId: string): Promise<FilingRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.filingRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listFilings(tx, proceedingId));
  }

  // --- service of process (single-winner verify) ------------------------------------------------
  async recordService(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      itemServed?: string | null;
      partyRef?: string | null;
      serviceMethod?: string | null;
      serviceDate?: string | null;
      locationReference?: string | null;
      recipient?: string | null;
      serviceStatus?: string;
      confidentiality?: string;
    },
  ): Promise<ServiceRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.serviceManage);
    if (input.serviceMethod != null && !isServiceMethod(input.serviceMethod))
      throw badRequest('invalid service method', ctx.correlationId);
    const conf = input.confidentiality ?? 'standard';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const svc = await this.repo.insertService(tx, {
        tenantId: ctx.tenantId,
        proceedingId,
        itemServed: input.itemServed ?? null,
        partyRef: input.partyRef ?? null,
        serviceMethod: input.serviceMethod ?? null,
        serviceDate: input.serviceDate ?? null,
        locationReference: input.locationReference ?? null,
        servedBy: actor,
        recipient: input.recipient ?? null,
        serviceStatus: input.serviceStatus ?? 'pending',
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.serviceRecorded,
        entityType: 'litigation_service',
        entityId: svc.id,
        detail: {},
      });
      return svc;
    });
  }
  async verifyService(
    ctx: RequestContext,
    actor: string | null,
    serviceId: string,
    decision: 'verified' | 'rejected',
  ): Promise<ServiceRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.serviceVerify);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.verifyService(tx, { id: serviceId, decision, by: actor });
      if (upd === null)
        throw ProblemError.conflict(
          'Service already verified/rejected or not found (single-winner).',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.serviceVerified,
        entityType: 'litigation_service',
        entityId: serviceId,
        detail: { decision },
      });
      if (decision === 'verified')
        await this.publish(tx, ctx, actor, 'ServiceCompleted', {
          proceedingId: upd.proceeding_id,
          reasonCode: 'verified',
        });
      return upd;
    });
  }
  async listServices(ctx: RequestContext, proceedingId: string): Promise<ServiceRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.serviceRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listServices(tx, proceedingId));
  }

  // --- appearances ------------------------------------------------------------------------------
  async scheduleAppearance(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      appearanceType: string;
      scheduledAt?: string | null;
      forum?: string | null;
      venue?: string | null;
      presidingRef?: string | null;
      purpose?: string | null;
      confidentiality?: string;
    },
  ): Promise<AppearanceRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.appearanceManage);
    if (!isAppearanceType(input.appearanceType))
      throw badRequest('invalid appearance type', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const a = await this.repo.insertAppearance(tx, {
        tenantId: ctx.tenantId,
        proceedingId,
        appearanceType: input.appearanceType,
        scheduledAt: input.scheduledAt ?? null,
        forum: input.forum ?? null,
        venue: input.venue ?? null,
        presidingRef: input.presidingRef ?? null,
        purpose: input.purpose ?? null,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.appearanceScheduled,
        entityType: 'litigation_appearance',
        entityId: a.id,
        detail: { appearanceType: input.appearanceType },
      });
      await this.publish(tx, ctx, actor, 'AppearanceScheduled', {
        proceedingId,
        ...(input.scheduledAt != null ? { dueAt: input.scheduledAt } : {}),
      });
      return a;
    });
  }
  async updateAppearance(
    ctx: RequestContext,
    actor: string | null,
    appearanceId: string,
    input: {
      expectedVersion: number;
      scheduledAt?: string | null;
      forum?: string | null;
      venue?: string | null;
      presidingRef?: string | null;
      purpose?: string | null;
    },
  ): Promise<AppearanceRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.appearanceManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateAppearance(tx, {
        id: appearanceId,
        expectedVersion: input.expectedVersion,
        scheduledAt: input.scheduledAt ?? null,
        forum: input.forum ?? null,
        venue: input.venue ?? null,
        presidingRef: input.presidingRef ?? null,
        purpose: input.purpose ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Appearance not updatable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.appearanceUpdated,
        entityType: 'litigation_appearance',
        entityId: appearanceId,
        detail: {},
      });
      return upd;
    });
  }
  async completeAppearance(
    ctx: RequestContext,
    actor: string | null,
    appearanceId: string,
    input: {
      expectedVersion: number;
      outcome?: string | null;
      directions?: string | null;
      nextAction?: string | null;
      nextAt?: string | null;
    },
  ): Promise<AppearanceRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.appearanceComplete);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.completeAppearance(tx, {
        id: appearanceId,
        expectedVersion: input.expectedVersion,
        outcome: input.outcome ?? null,
        directions: input.directions ?? null,
        nextAction: input.nextAction ?? null,
        nextAt: input.nextAt ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Appearance already complete or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.appearanceCompleted,
        entityType: 'litigation_appearance',
        entityId: appearanceId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'AppearanceCompleted', { proceedingId: upd.proceeding_id });
      return upd;
    });
  }
  async adjournAppearance(
    ctx: RequestContext,
    actor: string | null,
    appearanceId: string,
    input: { expectedVersion: number; reason?: string | null; nextAt?: string | null },
  ): Promise<AppearanceRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.appearanceManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.adjournAppearance(tx, {
        id: appearanceId,
        expectedVersion: input.expectedVersion,
        reason: input.reason ?? null,
        nextAt: input.nextAt ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Appearance not adjournable or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.appearanceAdjourned,
        entityType: 'litigation_appearance',
        entityId: appearanceId,
        ...(input.reason != null ? { reason: input.reason } : {}),
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'AppearanceAdjourned', { proceedingId: upd.proceeding_id });
      return upd;
    });
  }
  async listAppearances(ctx: RequestContext, proceedingId: string): Promise<AppearanceRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.appearanceRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listAppearances(tx, proceedingId));
  }

  // --- proceeding records (append-only) ---------------------------------------------------------
  async captureRecord(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      appearanceId?: string | null;
      attendance?: string | null;
      submissionsSummary?: string | null;
      evidenceTaken?: string | null;
      directions?: string | null;
      ordersSummary?: string | null;
      nextAt?: string | null;
      documentRef?: string | null;
      privileged?: boolean;
      confidentiality?: string;
    },
  ): Promise<ProceedingRecordRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.appearanceManage);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const rec = await this.repo.insertRecord(tx, {
        tenantId: ctx.tenantId,
        proceedingId,
        appearanceId: input.appearanceId ?? null,
        attendance: input.attendance ?? null,
        submissionsSummary: input.submissionsSummary ?? null,
        evidenceTaken: input.evidenceTaken ?? null,
        directions: input.directions ?? null,
        ordersSummary: input.ordersSummary ?? null,
        nextAt: input.nextAt ?? null,
        legalOfficer: actor,
        documentRef: input.documentRef ?? null,
        privileged: input.privileged === true,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.recordCaptured,
        entityType: 'litigation_proceeding_record',
        entityId: rec.id,
        detail: {},
      });
      return rec;
    });
  }
  async listRecords(ctx: RequestContext, proceedingId: string): Promise<ProceedingRecordRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.appearanceRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRecords(tx, proceedingId));
  }

  // --- witnesses --------------------------------------------------------------------------------
  async addWitness(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      witnessType: string;
      witnessRef?: string | null;
      role?: string | null;
      relevance?: string | null;
      statementDocumentRef?: string | null;
      contactRef?: string | null;
      protectionFlag?: boolean;
      confidentiality?: string;
      privileged?: boolean;
    },
  ): Promise<WitnessRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.witnessManage);
    if (!isWitnessType(input.witnessType)) throw badRequest('invalid witness type', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const w = await this.repo.insertWitness(tx, {
        tenantId: ctx.tenantId,
        proceedingId,
        witnessRef: input.witnessRef ?? null,
        witnessType: input.witnessType,
        role: input.role ?? null,
        relevance: input.relevance ?? null,
        statementDocumentRef: input.statementDocumentRef ?? null,
        contactRef: input.contactRef ?? null,
        protectionFlag: input.protectionFlag === true,
        confidentiality: conf,
        privileged: input.privileged === true,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.witnessAdded,
        entityType: 'litigation_witness',
        entityId: w.id,
        detail: { witnessType: input.witnessType },
      });
      await this.publish(tx, ctx, actor, 'WitnessRegistered', { proceedingId });
      return w;
    });
  }
  async updateWitness(
    ctx: RequestContext,
    actor: string | null,
    witnessId: string,
    input: {
      expectedVersion: number;
      attendanceStatus?: string | null;
      summonsStatus?: string | null;
      preparationStatus?: string | null;
      examinationStatus?: string | null;
      statementDocumentRef?: string | null;
    },
  ): Promise<WitnessRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.witnessManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateWitness(tx, {
        id: witnessId,
        expectedVersion: input.expectedVersion,
        attendanceStatus: input.attendanceStatus ?? null,
        summonsStatus: input.summonsStatus ?? null,
        preparationStatus: input.preparationStatus ?? null,
        examinationStatus: input.examinationStatus ?? null,
        statementDocumentRef: input.statementDocumentRef ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Witness modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.witnessStatementLinked,
        entityType: 'litigation_witness',
        entityId: witnessId,
        detail: {},
      });
      return upd;
    });
  }
  async listWitnesses(
    ctx: RequestContext,
    proceedingId: string,
  ): Promise<{ witnesses: WitnessRow[]; canReadContact: boolean }> {
    await this.authz.require(ctx, M16_PERMISSIONS.witnessRead);
    const canReadContact = await this.authz.can(ctx, M16_PERMISSIONS.witnessContactRead);
    const witnesses = await this.db.withTenant(ctx, (tx) => this.repo.listWitnesses(tx, proceedingId));
    return { witnesses, canReadContact };
  }

  // --- experts ----------------------------------------------------------------------------------
  async addExpert(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      expertRef?: string | null;
      expertise?: string | null;
      engagementReference?: string | null;
      instructionScope?: string | null;
      reportDocumentRef?: string | null;
      reportDueDate?: string | null;
      confidentiality?: string;
      privileged?: boolean;
    },
  ): Promise<ExpertRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.expertManage);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const e = await this.repo.insertExpert(tx, {
        tenantId: ctx.tenantId,
        proceedingId,
        expertRef: input.expertRef ?? null,
        expertise: input.expertise ?? null,
        engagementReference: input.engagementReference ?? null,
        instructionScope: input.instructionScope ?? null,
        reportDocumentRef: input.reportDocumentRef ?? null,
        reportDueDate: input.reportDueDate ?? null,
        internalOwner: actor,
        confidentiality: conf,
        privileged: input.privileged === true,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.expertAdded,
        entityType: 'litigation_expert',
        entityId: e.id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'ExpertRegistered', { proceedingId });
      return e;
    });
  }
  async updateExpert(
    ctx: RequestContext,
    actor: string | null,
    expertId: string,
    input: {
      expectedVersion: number;
      reportStatus?: string | null;
      attendanceStatus?: string | null;
      reportDocumentRef?: string | null;
    },
  ): Promise<ExpertRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.expertManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateExpert(tx, {
        id: expertId,
        expectedVersion: input.expectedVersion,
        reportStatus: input.reportStatus ?? null,
        attendanceStatus: input.attendanceStatus ?? null,
        reportDocumentRef: input.reportDocumentRef ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Expert modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.expertAdded,
        entityType: 'litigation_expert',
        entityId: expertId,
        detail: {},
      });
      return upd;
    });
  }
  async listExperts(ctx: RequestContext, proceedingId: string): Promise<ExpertRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.expertRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listExperts(tx, proceedingId));
  }

  // --- exhibits (single-winner admit) -----------------------------------------------------------
  async registerExhibit(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      exhibitNumber?: string | null;
      description?: string | null;
      source?: string | null;
      relatedWitness?: string | null;
      documentRef?: string | null;
      evidenceRef?: string | null;
      confidentiality?: string;
      privileged?: boolean;
    },
  ): Promise<ExhibitRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.exhibitManage);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const ex = await this.repo.insertExhibit(tx, {
        tenantId: ctx.tenantId,
        proceedingId,
        exhibitNumber: input.exhibitNumber ?? null,
        description: input.description ?? null,
        source: input.source ?? null,
        relatedWitness: input.relatedWitness ?? null,
        documentRef: input.documentRef ?? null,
        evidenceRef: input.evidenceRef ?? null,
        confidentiality: conf,
        privileged: input.privileged === true,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.exhibitRegistered,
        entityType: 'litigation_exhibit',
        entityId: ex.id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'ExhibitRegistered', { proceedingId });
      return ex;
    });
  }
  async admitExhibit(
    ctx: RequestContext,
    actor: string | null,
    exhibitId: string,
    decision: 'admitted' | 'rejected' | 'marked' | 'withdrawn',
  ): Promise<ExhibitRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.exhibitManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.admitExhibit(tx, { id: exhibitId, decision, by: actor });
      if (upd === null)
        throw ProblemError.conflict(
          'Exhibit already decided or not found (single-winner).',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.exhibitAdmitted,
        entityType: 'litigation_exhibit',
        entityId: exhibitId,
        detail: { decision },
      });
      await this.publish(tx, ctx, actor, 'ExhibitAdmitted', {
        proceedingId: upd.proceeding_id,
        reasonCode: decision,
      });
      return upd;
    });
  }
  async listExhibits(ctx: RequestContext, proceedingId: string): Promise<ExhibitRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.exhibitRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listExhibits(tx, proceedingId));
  }

  // --- bundles (maker-checker) ------------------------------------------------------------------
  async createBundle(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      bundleType?: string | null;
      title?: string | null;
      indexDocumentRef?: string | null;
      appearanceRef?: string | null;
      privileged?: boolean;
      confidentiality?: string;
    },
  ): Promise<BundleRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.bundleManage);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const b = await this.repo.insertBundle(tx, {
        tenantId: ctx.tenantId,
        proceedingId,
        bundleType: input.bundleType ?? null,
        title: input.title ?? null,
        indexDocumentRef: input.indexDocumentRef ?? null,
        appearanceRef: input.appearanceRef ?? null,
        preparedBy: actor,
        privileged: input.privileged === true,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.bundleCreated,
        entityType: 'litigation_bundle',
        entityId: b.id,
        detail: {},
      });
      return b;
    });
  }
  async approveBundle(
    ctx: RequestContext,
    actor: string | null,
    bundleId: string,
    expectedVersion: number,
  ): Promise<BundleRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.bundleApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const b = await this.repo.findBundle(tx, bundleId);
      if (b === null) throw ProblemError.notFound('Bundle not found.', ctx.correlationId);
      if (b.prepared_by !== null && actor !== null && b.prepared_by === actor)
        throw ProblemError.conflict(
          'The bundle preparer cannot approve it (segregation of duties).',
          ctx.correlationId,
        );
      const upd = await this.repo.approveBundle(tx, { id: bundleId, expectedVersion, approvedBy: actor });
      if (upd === null)
        throw ProblemError.conflict('Bundle not approvable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.bundleApproved,
        entityType: 'litigation_bundle',
        entityId: bundleId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'BundleApproved', { proceedingId: upd.proceeding_id });
      return upd;
    });
  }
  async fileBundle(
    ctx: RequestContext,
    actor: string | null,
    bundleId: string,
    expectedVersion: number,
  ): Promise<BundleRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.bundleManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.fileBundle(tx, { id: bundleId, expectedVersion, by: actor });
      if (upd === null)
        throw ProblemError.conflict('Bundle not fileable (must be approved) or stale.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.bundleFiled,
        entityType: 'litigation_bundle',
        entityId: bundleId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'BundleFiled', { proceedingId: upd.proceeding_id });
      return upd;
    });
  }
  async addBundleItem(
    ctx: RequestContext,
    actor: string | null,
    bundleId: string,
    input: {
      documentRef?: string | null;
      tab?: string | null;
      pageFrom?: number | null;
      pageTo?: number | null;
      description?: string | null;
      sortOrder?: number;
    },
  ): Promise<BundleItemRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.bundleManage);
    return this.db.withTenant(ctx, async (tx) => {
      const item = await this.repo.insertBundleItem(tx, {
        tenantId: ctx.tenantId,
        bundleId,
        documentRef: input.documentRef ?? null,
        tab: input.tab ?? null,
        pageFrom: input.pageFrom ?? null,
        pageTo: input.pageTo ?? null,
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? 0,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.bundleCreated,
        entityType: 'litigation_bundle_item',
        entityId: item.id,
        detail: { bundleId },
      });
      return item;
    });
  }
  async listBundles(ctx: RequestContext, proceedingId: string): Promise<BundleRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.bundleRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listBundles(tx, proceedingId));
  }

  // --- orders (append-only) ---------------------------------------------------------------------
  async recordOrder(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      orderType: string;
      orderDate?: string | null;
      issuingForum?: string | null;
      presidingRef?: string | null;
      summary?: string | null;
      operativeTerms?: string | null;
      effectiveDate?: string | null;
      expiryDate?: string | null;
      documentRef?: string | null;
      privileged?: boolean;
      confidentiality?: string;
    },
  ): Promise<OrderRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.orderManage);
    if (!isOrderType(input.orderType)) throw badRequest('invalid order type', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const o = await this.repo.insertOrder(tx, {
        tenantId: ctx.tenantId,
        proceedingId,
        orderType: input.orderType,
        orderDate: input.orderDate ?? null,
        issuingForum: input.issuingForum ?? null,
        presidingRef: input.presidingRef ?? null,
        summary: input.summary ?? null,
        operativeTerms: input.operativeTerms ?? null,
        effectiveDate: input.effectiveDate ?? null,
        expiryDate: input.expiryDate ?? null,
        documentRef: input.documentRef ?? null,
        privileged: input.privileged === true,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.orderRecorded,
        entityType: 'litigation_order',
        entityId: o.id,
        detail: { orderType: input.orderType },
      });
      await this.publish(tx, ctx, actor, 'OrderRecorded', { proceedingId });
      return o;
    });
  }
  async listOrders(ctx: RequestContext, proceedingId: string): Promise<OrderRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.orderRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listOrders(tx, proceedingId));
  }

  // --- compliance obligations -------------------------------------------------------------------
  async addObligation(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      orderId?: string | null;
      obligation?: string | null;
      responsibleRef?: string | null;
      affectedParty?: string | null;
      dueDate?: string | null;
    },
  ): Promise<ComplianceRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.complianceManage);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const c = await this.repo.insertObligation(tx, {
        tenantId: ctx.tenantId,
        proceedingId,
        orderId: input.orderId ?? null,
        obligation: input.obligation ?? null,
        responsibleRef: input.responsibleRef ?? null,
        affectedParty: input.affectedParty ?? null,
        dueDate: input.dueDate ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.complianceCreated,
        entityType: 'litigation_compliance_obligation',
        entityId: c.id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'ComplianceObligationCreated', {
        proceedingId,
        ...(input.dueDate != null ? { dueAt: input.dueDate } : {}),
      });
      return c;
    });
  }
  async completeObligation(
    ctx: RequestContext,
    actor: string | null,
    obligationId: string,
    input: { expectedVersion: number; evidenceReference?: string | null },
  ): Promise<ComplianceRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.complianceManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.completeObligation(tx, {
        id: obligationId,
        expectedVersion: input.expectedVersion,
        evidenceReference: input.evidenceReference ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Obligation not completable or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.complianceCompleted,
        entityType: 'litigation_compliance_obligation',
        entityId: obligationId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'ComplianceCompleted', { proceedingId: upd.proceeding_id });
      return upd;
    });
  }
  async breachObligation(
    ctx: RequestContext,
    actor: string | null,
    obligationId: string,
    expectedVersion: number,
  ): Promise<ComplianceRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.complianceManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.breachObligation(tx, { id: obligationId, expectedVersion, by: actor });
      if (upd === null)
        throw ProblemError.conflict('Obligation not breachable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.complianceBreached,
        entityType: 'litigation_compliance_obligation',
        entityId: obligationId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'ComplianceBreached', {
        proceedingId: upd.proceeding_id,
        reasonCode: 'breach',
      });
      return upd;
    });
  }
  async listObligations(ctx: RequestContext, proceedingId: string): Promise<ComplianceRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.complianceRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listObligations(tx, proceedingId));
  }

  // --- outcomes (append-only ruling/judgment) ---------------------------------------------------
  async recordOutcome(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      outcomeType: string;
      outcomeDate?: string | null;
      forum?: string | null;
      presidingRef?: string | null;
      summary?: string | null;
      disposition?: string | null;
      amountAwardedMinor?: number | null;
      currency?: string | null;
      costsAwardedMinor?: number | null;
      appealable?: boolean;
      appealDeadline?: string | null;
      documentRef?: string | null;
      privileged?: boolean;
      confidentiality?: string;
    },
  ): Promise<OutcomeRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.outcomeManage);
    if (!isOutcomeType(input.outcomeType)) throw badRequest('invalid outcome type', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    for (const v of [input.amountAwardedMinor, input.costsAwardedMinor])
      if (v != null && (!Number.isInteger(v) || v < 0))
        throw badRequest('awarded amounts are non-negative integer minor units', ctx.correlationId);
    const isJudgment = input.outcomeType === 'final_judgment';
    return this.db.withTenant(ctx, async (tx) => {
      const p = await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const o = await this.repo.insertOutcome(tx, {
        tenantId: ctx.tenantId,
        proceedingId,
        outcomeType: input.outcomeType,
        outcomeDate: input.outcomeDate ?? null,
        forum: input.forum ?? null,
        presidingRef: input.presidingRef ?? null,
        summary: input.summary ?? null,
        disposition: input.disposition ?? null,
        amountAwardedMinor: input.amountAwardedMinor ?? null,
        currency: input.currency ?? null,
        costsAwardedMinor: input.costsAwardedMinor ?? null,
        appealable: input.appealable === true,
        appealDeadline: input.appealDeadline ?? null,
        documentRef: input.documentRef ?? null,
        privileged: input.privileged === true,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.patchProceeding(tx, {
        id: proceedingId,
        expectedVersion: p.version,
        finalOutcome: input.outcomeType,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: isJudgment ? M16_AUDIT_CODES.judgmentRecorded : M16_AUDIT_CODES.rulingRecorded,
        entityType: 'litigation_outcome',
        entityId: o.id,
        detail: { outcomeType: input.outcomeType },
      });
      await this.publish(tx, ctx, actor, isJudgment ? 'JudgmentRecorded' : 'RulingRecorded', {
        proceedingId,
        ...(input.amountAwardedMinor != null ? { amountMinor: input.amountAwardedMinor } : {}),
      });
      return o;
    });
  }
  async listOutcomes(ctx: RequestContext, proceedingId: string): Promise<OutcomeRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.outcomeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listOutcomes(tx, proceedingId));
  }

  // --- appeals (one active per proceeding) ------------------------------------------------------
  async initiateAppeal(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      appealType?: string | null;
      forum?: string | null;
      deadline?: string | null;
      groundsSummary?: string | null;
      counselRef?: string | null;
      confidentiality?: string;
    },
  ): Promise<AppealRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.appealManage);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const p = await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      let a: AppealRow;
      try {
        a = await this.repo.insertAppeal(tx, {
          tenantId: ctx.tenantId,
          proceedingId,
          appealType: input.appealType ?? null,
          forum: input.forum ?? null,
          deadline: input.deadline ?? null,
          groundsSummary: input.groundsSummary ?? null,
          counselRef: input.counselRef ?? null,
          sourceMatterId: p.source_matter_id,
          confidentiality: conf,
          correlationId: ctx.correlationId,
          by: actor,
        });
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw ProblemError.conflict(
            'An active appeal already exists for this proceeding.',
            ctx.correlationId,
          );
        throw e;
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.appealInitiated,
        entityType: 'litigation_appeal',
        entityId: a.id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'AppealInitiated', { proceedingId });
      return a;
    });
  }
  async updateAppeal(
    ctx: RequestContext,
    actor: string | null,
    appealId: string,
    input: {
      expectedVersion: number;
      approvalStatus?: string | null;
      filingStatus?: string | null;
      appealNumber?: string | null;
      status?: string | null;
      outcome?: string | null;
    },
  ): Promise<AppealRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.appealManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateAppeal(tx, {
        id: appealId,
        expectedVersion: input.expectedVersion,
        approvalStatus: input.approvalStatus ?? null,
        approvedBy: input.approvalStatus === 'approved' ? actor : null,
        filingStatus: input.filingStatus ?? null,
        appealNumber: input.appealNumber ?? null,
        status: input.status ?? null,
        outcome: input.outcome ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Appeal modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.appealInitiated,
        entityType: 'litigation_appeal',
        entityId: appealId,
        detail: {},
      });
      return upd;
    });
  }
  async listAppeals(ctx: RequestContext, proceedingId: string): Promise<AppealRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.appealRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listAppeals(tx, proceedingId));
  }

  // --- deadlines (deterministic; limitation is high-risk) ---------------------------------------
  async addDeadline(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      deadlineType: string;
      rule: DeadlineRule;
      startAt?: string | null;
      source?: string | null;
      authority?: string | null;
      warnWindowMs?: number | null;
    },
  ): Promise<DeadlineRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.deadlineManage);
    if (!isDeadlineType(input.deadlineType)) throw badRequest('invalid deadline type', ctx.correlationId);
    const startMs = input.startAt != null ? Date.parse(input.startAt) : this.clock.now();
    const dueMs = computeDeadlineDueMs({ type: input.deadlineType, startMs, rule: input.rule });
    if (!isLimitationSafe(input.deadlineType, dueMs, this.clock.now()))
      throw badRequest('a limitation deadline cannot be in the past', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const p = await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const d = await this.repo.insertDeadline(tx, {
        tenantId: ctx.tenantId,
        proceedingId,
        deadlineType: input.deadlineType,
        startAt: iso(startMs),
        dueAt: iso(dueMs),
        rule: input.rule,
        source: input.source ?? null,
        authority: input.authority ?? null,
        warnWindowMs: input.warnWindowMs ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      if (input.deadlineType === 'limitation')
        await this.repo.patchProceeding(tx, {
          id: proceedingId,
          expectedVersion: p.version,
          limitationAt: iso(dueMs),
          by: actor,
        });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.deadlineCreated,
        entityType: 'litigation_deadline',
        entityId: d.id,
        detail: { deadlineType: input.deadlineType },
      });
      await this.publish(tx, ctx, actor, 'DeadlineCreated', { proceedingId, dueAt: iso(dueMs) });
      return d;
    });
  }
  async extendDeadline(
    ctx: RequestContext,
    actor: string | null,
    deadlineId: string,
    input: { expectedVersion: number; extensionTo: string; reason?: string | null },
  ): Promise<DeadlineRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.deadlineManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.extendDeadline(tx, {
        id: deadlineId,
        expectedVersion: input.expectedVersion,
        extensionTo: input.extensionTo,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Deadline not extendable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.deadlineExtended,
        entityType: 'litigation_deadline',
        entityId: deadlineId,
        ...(input.reason != null ? { reason: input.reason } : {}),
        detail: {},
      });
      return upd;
    });
  }
  async evaluateDeadline(
    ctx: RequestContext,
    actor: string | null,
    deadlineId: string,
  ): Promise<{ breached: boolean }> {
    await this.authz.require(ctx, M16_PERMISSIONS.deadlineManage);
    return this.db.withTenant(ctx, async (tx) => {
      const d = await this.repo.findDeadline(tx, deadlineId);
      if (d === null) throw ProblemError.notFound('Deadline not found.', ctx.correlationId);
      if (d.status !== 'open' && d.status !== 'extended') return { breached: d.status === 'breached' };
      const state = deadlineState({
        dueMs: Date.parse(d.due_at),
        nowMs: this.clock.now(),
        warnWindowMs: d.warn_window_ms != null ? Number(d.warn_window_ms) : 0,
      });
      if (!state.breached) return { breached: false };
      const upd = await this.repo.markDeadlineBreach(tx, deadlineId);
      if (upd === null) return { breached: true };
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.deadlineBreached,
        entityType: 'litigation_deadline',
        entityId: deadlineId,
        detail: { deadlineType: d.deadline_type },
      });
      await this.publish(tx, ctx, actor, 'DeadlineBreached', {
        proceedingId: d.proceeding_id,
        reasonCode: d.deadline_type,
      });
      return { breached: true };
    });
  }
  async listDeadlines(ctx: RequestContext, proceedingId: string): Promise<DeadlineRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.deadlineRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listDeadlines(tx, proceedingId));
  }

  // --- cost references --------------------------------------------------------------------------
  async recordCost(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      costType?: string | null;
      description?: string | null;
      amountMinor?: number | null;
      currency?: string | null;
      counselReference?: string | null;
      invoiceReference?: string | null;
      recoverable?: boolean;
    },
  ): Promise<CostRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.costManage);
    if (input.costType != null && !isCostType(input.costType))
      throw badRequest('invalid cost type', ctx.correlationId);
    if (input.amountMinor != null && (!Number.isInteger(input.amountMinor) || input.amountMinor < 0))
      throw badRequest('amountMinor must be a non-negative integer (minor units)', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const c = await this.repo.insertCost(tx, {
        tenantId: ctx.tenantId,
        proceedingId,
        costType: input.costType ?? null,
        description: input.description ?? null,
        amountMinor: input.amountMinor ?? null,
        currency: input.currency ?? null,
        counselReference: input.counselReference ?? null,
        invoiceReference: input.invoiceReference ?? null,
        recoverable: input.recoverable === true,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.costRecorded,
        entityType: 'litigation_cost_reference',
        entityId: c.id,
        detail: {},
      });
      return c;
    });
  }
  async listCosts(ctx: RequestContext, proceedingId: string): Promise<CostRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.costRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listCosts(tx, proceedingId));
  }

  // --- notes (privileged redaction) -------------------------------------------------------------
  async addNote(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: {
      noteType?: string;
      headline?: string | null;
      content: string;
      relatedAppearance?: string | null;
      confidentiality?: string;
    },
  ): Promise<NoteRow> {
    const noteType = input.noteType ?? 'general';
    if (!isNoteType(noteType)) throw badRequest('invalid note type', ctx.correlationId);
    const restricted = isRestrictedNote(noteType);
    await this.authz.require(
      ctx,
      restricted ? M16_PERMISSIONS.privilegedCreate : M16_PERMISSIONS.proceedingUpdate,
    );
    if (input.content.trim() === '' || input.content.length > LITIGATION_LIMITS.maxNoteChars)
      throw badRequest('note content is required and must be bounded', ctx.correlationId);
    const conf = input.confidentiality ?? (restricted ? 'privileged' : 'standard');
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const n = await this.repo.insertNote(tx, {
        tenantId: ctx.tenantId,
        proceedingId,
        noteType,
        headline: input.headline ?? null,
        content: input.content,
        relatedAppearance: input.relatedAppearance ?? null,
        privileged: restricted,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      // Note CONTENT never enters the event/audit payload (ADR-068).
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.noteCreated,
        entityType: 'litigation_note',
        entityId: n.id,
        detail: { noteType, restricted },
      });
      return n;
    });
  }
  async listNotes(
    ctx: RequestContext,
    proceedingId: string,
  ): Promise<{ notes: NoteRow[]; canReadPrivileged: boolean }> {
    await this.authz.require(ctx, M16_PERMISSIONS.proceedingRead);
    const canReadPrivileged = await this.authz.can(ctx, M16_PERMISSIONS.privilegedRead);
    const all = await this.db.withTenant(ctx, (tx) => this.repo.listNotes(tx, proceedingId));
    const notes = canReadPrivileged ? all : all.filter((n) => !n.privileged);
    if (canReadPrivileged && all.some((n) => n.privileged))
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M16_AUDIT_CODES.privilegedAccessed,
          entityType: 'litigation_note',
          entityId: proceedingId,
          detail: {},
        }),
      );
    return { notes, canReadPrivileged };
  }

  // --- relationships ----------------------------------------------------------------------------
  async link(
    ctx: RequestContext,
    actor: string | null,
    input: { fromProceedingId: string; toProceedingId: string; kind: string },
  ): Promise<RelationshipRow> {
    await this.authz.require(ctx, M16_PERMISSIONS.proceedingUpdate);
    if (!isRelationshipKind(input.kind)) throw badRequest('invalid relationship kind', ctx.correlationId);
    if (isSelfRelation(input.fromProceedingId, input.toProceedingId))
      throw badRequest('a proceeding cannot relate to itself', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const from = await this.repo.findProceeding(tx, input.fromProceedingId);
      const to = await this.repo.findProceeding(tx, input.toProceedingId);
      if (from === null || to === null)
        throw ProblemError.notFound('Both proceedings must exist in this tenant.', ctx.correlationId);
      if (
        input.kind === 'duplicate_of' ||
        input.kind === 'consolidated_with' ||
        input.kind === 'parent_of' ||
        input.kind === 'child_of'
      ) {
        const reverse = await this.repo.findReverseRelationship(
          tx,
          input.fromProceedingId,
          input.toProceedingId,
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
        fromId: input.fromProceedingId,
        toId: input.toProceedingId,
        kind: input.kind,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.relationshipCreated,
        entityType: 'litigation_relationship',
        entityId: row.id,
        detail: { kind: input.kind },
      });
      return row;
    });
  }
  async listRelationships(ctx: RequestContext, proceedingId: string): Promise<RelationshipRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.proceedingRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRelationships(tx, proceedingId));
  }

  // --- deterministic SLA (materializes stage deadlines) -----------------------------------------
  async startSla(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    policyCode: string,
  ): Promise<DeadlineRow[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.deadlineManage);
    return this.db.withTenant(ctx, async (tx) => {
      const p = await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const policy = await this.repo.findActiveSlaPolicy(tx, policyCode);
      if (policy === null)
        throw ProblemError.conflict('No active SLA policy for that code.', ctx.correlationId);
      const spec = policy.spec as LitigationSlaPolicySpec;
      const startMs = this.clock.now();
      const due = computeDueDates(spec, startMs);
      const stages: { type: string; ms: number }[] = [
        { type: 'filing', ms: due.filingAtMs },
        { type: 'service', ms: due.serviceAtMs },
        { type: 'bundle', ms: due.bundlePrepAtMs },
        { type: 'hearing', ms: due.hearingPrepAtMs },
        { type: 'ruling', ms: due.outcomeAtMs },
        { type: 'internal_preparation', ms: due.closureAtMs },
      ];
      const rows: DeadlineRow[] = [];
      for (const st of stages) {
        rows.push(
          await this.repo.insertDeadline(tx, {
            tenantId: ctx.tenantId,
            proceedingId,
            deadlineType: st.type,
            startAt: iso(startMs),
            dueAt: iso(st.ms),
            rule: { kind: 'explicit', dueMs: st.ms },
            source: policyCode,
            authority: null,
            warnWindowMs: null,
            correlationId: ctx.correlationId,
            by: actor,
          }),
        );
      }
      await this.repo.patchProceeding(tx, {
        id: proceedingId,
        expectedVersion: p.version,
        slaPolicyCode: policyCode,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.slaStarted,
        entityType: 'litigation_proceeding',
        entityId: proceedingId,
        detail: { policyCode },
      });
      return rows;
    });
  }

  // --- escalation (reuses m08 via an event; m16 builds no second escalation engine) --------------
  async triggerEscalation(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
    input: { reason: string },
  ): Promise<string> {
    await this.authz.require(ctx, M16_PERMISSIONS.proceedingUpdate);
    if (input.reason.trim() === '') throw badRequest('a reason is required to escalate', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const p = await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const escalationRef = p.escalation_ref ?? randomUUID();
      await this.repo.patchProceeding(tx, {
        id: proceedingId,
        expectedVersion: p.version,
        escalationRef,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.escalationTriggered,
        entityType: 'litigation_proceeding',
        entityId: proceedingId,
        reason: input.reason,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'ProceedingEscalated', {
        proceedingId,
        ...(p.litigation_risk != null ? { litigationRisk: p.litigation_risk } : {}),
        reasonCode: 'manual',
      });
      return escalationRef;
    });
  }

  // --- safe downstream boundary signals (m17 enforcement, m18 knowledge) ------------------------
  async enforcementReferral(
    ctx: RequestContext,
    actor: string | null,
    proceedingId: string,
  ): Promise<string> {
    await this.authz.require(ctx, M16_PERMISSIONS.proceedingUpdate);
    return this.db.withTenant(ctx, async (tx) => {
      const p = await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      const ref = randomUUID();
      await this.repo.patchProceeding(tx, {
        id: proceedingId,
        expectedVersion: p.version,
        enforcementReferralReady: true,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.enforcementReferralReady,
        entityType: 'litigation_proceeding',
        entityId: proceedingId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'EnforcementReferralReady', {
        proceedingId,
        reasonCode: 'enforcement_ready',
      });
      return ref;
    });
  }
  async knowledgeCandidate(ctx: RequestContext, actor: string | null, proceedingId: string): Promise<void> {
    await this.authz.require(ctx, M16_PERMISSIONS.proceedingUpdate);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireProceeding(tx, proceedingId, ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.knowledgeCandidateCreated,
        entityType: 'litigation_proceeding',
        entityId: proceedingId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'KnowledgeCandidateCreated', {
        proceedingId,
        reasonCode: 'knowledge_candidate',
      });
    });
  }

  // --- analytics --------------------------------------------------------------------------------
  async analytics(ctx: RequestContext, dimension: string): Promise<{ dim: string | null; count: string }[]> {
    await this.authz.require(ctx, M16_PERMISSIONS.analyticsRead);
    return this.db.withTenant(ctx, (tx) => this.repo.analyticsByDimension(tx, dimension));
  }
}
