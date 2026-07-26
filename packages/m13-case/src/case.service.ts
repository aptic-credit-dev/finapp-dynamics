/**
 * CaseService — intake (manual, M12 feedback handoff, external adapter), triage, assignment, the full case
 * lifecycle, closure and reopening, and the controlled m14 conversion (F2-F6/F31/F32). Every mutating method
 * enforces its permission (default deny), runs inside `db.withTenant`, records audit + a case.lifecycle outbox
 * event in the SAME transaction, appends status/assignment history, and is optimistic-lock guarded. Lifecycle
 * transitions go through the PURE `checkCaseTransition` choke point. Confidential cases are redacted on read
 * unless the caller holds `cases.confidential.read` (ADR-060). The M12 handoff is idempotent (one case per
 * handoff) and completed through a port — m13 never reads m12's tables.
 */
import { randomUUID } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M13_PERMISSIONS } from './permissions.ts';
import { M13_AUDIT_CODES } from './audit-codes.ts';
import { checkCaseTransition, isCaseTerminal } from './domain/lifecycles.ts';
import { isConfidentiality, isPriority, isSeverity, isRiskRating, CASE_LIMITS } from './domain/limits.ts';
import { evaluateClosure, type ClosureCriteria } from './domain/closure.ts';
import { formatCaseNumber } from './case-number.ts';
import { CaseRepository, type CaseRow } from './repository.ts';
import type { M13Emitter } from './emit.ts';
import type { FeedbackHandoffSource } from './ports.ts';
import { badRequest } from './errors.ts';

/** Default closure criteria for a worked case (a full impl consults an M07 rule set + the case type, ADR-057). */
const DEFAULT_CLOSURE_CRITERIA: ClosureCriteria = {
  requireMandatoryTasksComplete: true,
  requireDecisionApproved: true,
  requireDeadlinesDispositioned: true,
  requireNoActiveLegalHold: true,
  requireNoOpenCriticalEscalation: true,
  requireNoUnresolvedMandatoryIssue: true,
};

export class CaseService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M13Emitter;
  private readonly repo: CaseRepository;
  private readonly handoff: FeedbackHandoffSource | null;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M13Emitter,
    repo: CaseRepository = new CaseRepository(),
    handoff: FeedbackHandoffSource | null = null,
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.handoff = handoff;
  }

  // --- manual + external intake -----------------------------------------------------------------
  async create(
    ctx: RequestContext,
    actor: string | null,
    input: {
      caseTypeCode: string;
      title: string;
      summary?: string | null;
      description?: string | null;
      source?: string | null;
      customerRef?: string | null;
      subjectRef?: string | null;
      productRef?: string | null;
      branch?: string | null;
      department?: string | null;
      confidentiality?: string | null;
      severity?: string | null;
      priority?: string | null;
      slaPolicyCode?: string | null;
      originatingModule?: string | null;
      originatingEntityType?: string | null;
      originatingEntityId?: string | null;
      idempotencyKey?: string | null;
      causationId?: string | null;
    },
  ): Promise<CaseRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.caseCreate);
    return this.insertCase(ctx, actor, {
      ...input,
      source: input.source ?? 'manual',
      originatingFeedbackId: null,
    });
  }

  private async insertCase(
    ctx: RequestContext,
    actor: string | null,
    input: {
      caseTypeCode: string;
      title: string;
      summary?: string | null;
      description?: string | null;
      source: string;
      customerRef?: string | null;
      subjectRef?: string | null;
      productRef?: string | null;
      branch?: string | null;
      department?: string | null;
      confidentiality?: string | null;
      severity?: string | null;
      priority?: string | null;
      slaPolicyCode?: string | null;
      originatingModule?: string | null;
      originatingEntityType?: string | null;
      originatingEntityId?: string | null;
      originatingFeedbackId?: string | null;
      idempotencyKey?: string | null;
      causationId?: string | null;
    },
  ): Promise<CaseRow> {
    if (input.title.trim() === '' || input.title.length > CASE_LIMITS.maxTitleChars)
      throw badRequest('a title is required and must be bounded', ctx.correlationId);
    if (input.caseTypeCode.trim() === '') throw badRequest('a case type is required', ctx.correlationId);
    const confidentiality = input.confidentiality ?? 'standard';
    if (!isConfidentiality(confidentiality)) throw badRequest('invalid confidentiality', ctx.correlationId);
    const priority = input.priority ?? 'normal';
    if (!isPriority(priority)) throw badRequest('invalid priority', ctx.correlationId);
    if (input.severity != null && !isSeverity(input.severity))
      throw badRequest('invalid severity', ctx.correlationId);
    if (input.description != null && input.description.length > CASE_LIMITS.maxDescriptionChars)
      throw badRequest('description too long', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findCaseByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const active = await this.repo.findActiveCaseType(tx, input.caseTypeCode);
      const c = await this.repo.insertCase(tx, {
        tenantId: ctx.tenantId,
        caseNumber: formatCaseNumber(randomUUID()),
        caseTypeCode: input.caseTypeCode,
        caseTypeVersion: active?.version_number ?? null,
        title: input.title,
        summary: input.summary ?? null,
        description: input.description ?? null,
        source: input.source,
        originatingModule: input.originatingModule ?? null,
        originatingEntityType: input.originatingEntityType ?? null,
        originatingEntityId: input.originatingEntityId ?? null,
        originatingFeedbackId: input.originatingFeedbackId ?? null,
        customerRef: input.customerRef ?? null,
        subjectRef: input.subjectRef ?? null,
        productRef: input.productRef ?? null,
        branch: input.branch ?? null,
        department: input.department ?? null,
        confidentiality,
        severity: input.severity ?? null,
        priority,
        slaPolicyCode: input.slaPolicyCode ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        causationId: input.causationId ?? null,
        by: actor,
      });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        caseId: c.id,
        fromStatus: null,
        toStatus: c.status,
        reason: null,
        reasonCode: 'created',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.caseCreated,
        entityType: 'case_record',
        entityId: c.id,
        detail: { caseNumber: c.case_number, caseType: c.case_type_code, source: c.source },
      });
      await this.emitter.publish(tx, {
        type: 'CaseCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          caseId: c.id,
          caseType: c.case_type_code,
          source: c.source,
          ...(c.originating_feedback_id != null ? { originatingFeedbackId: c.originating_feedback_id } : {}),
          toStatus: c.status,
        },
      });
      return c;
    });
  }

  async intakeExternal(
    ctx: RequestContext,
    actor: string | null,
    input: {
      source: string;
      externalReference: string;
      caseTypeCode: string;
      title: string;
      customerRef?: string | null;
      product?: string | null;
      branch?: string | null;
      department?: string | null;
      payloadHash?: string | null;
    },
  ): Promise<CaseRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.intakeCreate);
    // Idempotent on (source, externalReference) via the record idempotency key.
    const key = `intake:${input.source}:${input.externalReference}`;
    return this.insertCase(ctx, actor, {
      caseTypeCode: input.caseTypeCode,
      title: input.title,
      source: input.source,
      customerRef: input.customerRef ?? null,
      productRef: input.product ?? null,
      branch: input.branch ?? null,
      department: input.department ?? null,
      originatingModule: 'external',
      originatingEntityType: input.source,
      idempotencyKey: key,
    });
  }

  // --- M12 feedback handoff (idempotent, one case per handoff) -----------------------------------
  async acceptHandoff(
    ctx: RequestContext,
    actor: string | null,
    input: {
      handoffId: string;
      caseTypeCode: string;
      title: string;
      confidentiality?: string | null;
      priority?: string | null;
    },
  ): Promise<{ case: CaseRow; created: boolean }> {
    await this.authz.require(ctx, M13_PERMISSIONS.handoffAccept);
    if (this.handoff === null)
      throw ProblemError.conflict('No feedback handoff source is configured.', ctx.correlationId);
    const source = this.handoff;
    // Idempotency: one case per handoff. A repeat returns the existing case (no second case).
    const existingCaseId = await this.db.withTenant(ctx, async (tx) => {
      const intake = await this.repo.findHandoffIntake(tx, input.handoffId);
      return intake?.case_id ?? null;
    });
    if (existingCaseId !== null) {
      // A repeat handoff returns the existing case WITHOUT re-completing (the m12 handoff is already completed;
      // m12's completeCaseHandoff is not idempotent and would 409 on a non-pending handoff).
      const existing = await this.db.withTenant(ctx, (tx) => this.repo.findCase(tx, existingCaseId));
      if (existing === null)
        throw ProblemError.conflict('Handoff intake references a missing case.', ctx.correlationId);
      return { case: existing, created: false };
    }
    const handoff = await source.getHandoff(ctx, input.handoffId);
    if (handoff === null) throw ProblemError.notFound('Handoff not found.', ctx.correlationId);
    const result = await this.db.withTenant(ctx, async (tx): Promise<{ case: CaseRow; created: boolean }> => {
      // Re-check under the tx to lose gracefully on a concurrent accept (unique handoff_id).
      const again = await this.repo.findHandoffIntake(tx, input.handoffId);
      if (again !== null) {
        const c = await this.repo.findCase(tx, again.case_id);
        if (c === null)
          throw ProblemError.conflict('Handoff intake references a missing case.', ctx.correlationId);
        return { case: c, created: false };
      }
      const confidentiality = input.confidentiality ?? 'confidential';
      if (!isConfidentiality(confidentiality)) throw badRequest('invalid confidentiality', ctx.correlationId);
      const priority = input.priority ?? 'high';
      if (!isPriority(priority)) throw badRequest('invalid priority', ctx.correlationId);
      const c = await this.repo.insertCase(tx, {
        tenantId: ctx.tenantId,
        caseNumber: formatCaseNumber(randomUUID()),
        caseTypeCode: input.caseTypeCode,
        caseTypeVersion: null,
        title: input.title,
        summary: null,
        description: null,
        source: 'feedback_handoff',
        originatingModule: 'm12-feedback',
        originatingEntityType: 'feedback_record',
        originatingEntityId: handoff.feedbackId,
        originatingFeedbackId: handoff.feedbackId,
        customerRef: handoff.customerRef,
        subjectRef: null,
        productRef: handoff.product,
        branch: null,
        department: null,
        confidentiality,
        severity: handoff.severity,
        priority,
        slaPolicyCode: null,
        idempotencyKey: null,
        correlationId: ctx.correlationId,
        causationId: input.handoffId,
        by: actor,
      });
      await this.repo.insertHandoffIntake(tx, {
        tenantId: ctx.tenantId,
        handoffId: input.handoffId,
        feedbackId: handoff.feedbackId,
        caseId: c.id,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        caseId: c.id,
        fromStatus: null,
        toStatus: c.status,
        reason: null,
        reasonCode: 'handoff',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.handoffConsumed,
        entityType: 'case_handoff_intake',
        entityId: input.handoffId,
        detail: { feedbackId: handoff.feedbackId, caseId: c.id },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.caseCreated,
        entityType: 'case_record',
        entityId: c.id,
        detail: { caseNumber: c.case_number, source: 'feedback_handoff' },
      });
      await this.emitter.publish(tx, {
        type: 'CaseCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          caseId: c.id,
          caseType: c.case_type_code,
          source: 'feedback_handoff',
          originatingFeedbackId: handoff.feedbackId,
          toStatus: c.status,
        },
      });
      await this.emitter.publish(tx, {
        type: 'CaseHandoffAccepted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId: c.id, originatingFeedbackId: handoff.feedbackId, reasonCode: 'handoff' },
      });
      return { case: c, created: true };
    });
    // Complete the m12 handoff ONLY when we actually created the case here (feedback -> converted_to_case).
    if (result.created) await source.completeHandoff(ctx, actor, input.handoffId, result.case.case_number);
    return result;
  }

  // --- lifecycle transitions --------------------------------------------------------------------
  private async move(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    to: string,
    opts: {
      permission: string;
      auditCode: string;
      eventType: 'CaseOpened' | 'CaseResolved';
      reasonCode?: string;
      stamp?: 'opened' | 'resolved' | 'closed' | null;
      expectedVersion: number;
    },
  ): Promise<CaseRow> {
    await this.authz.require(ctx, opts.permission);
    return this.db.withTenant(ctx, async (tx) => {
      const c = await this.repo.findCase(tx, id);
      if (c === null) throw ProblemError.notFound('Case not found.', ctx.correlationId);
      const check = checkCaseTransition(c.status, to);
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot move ${c.status} -> ${to}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateCaseStatus(tx, {
        id,
        expectedVersion: opts.expectedVersion,
        toStatus: to,
        by: actor,
        stamp: opts.stamp ?? null,
      });
      if (upd === null)
        throw ProblemError.conflict('Case modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        caseId: id,
        fromStatus: c.status,
        toStatus: to,
        reason: null,
        reasonCode: opts.reasonCode ?? null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: opts.auditCode,
        entityType: 'case_record',
        entityId: id,
        detail: { fromStatus: c.status, toStatus: to },
      });
      await this.emitter.publish(tx, {
        type: opts.eventType,
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId: id, fromStatus: c.status, toStatus: to },
      });
      return upd;
    });
  }

  open(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.move(ctx, actor, id, 'opened', {
      permission: M13_PERMISSIONS.caseOpen,
      auditCode: M13_AUDIT_CODES.caseOpened,
      eventType: 'CaseOpened',
      reasonCode: 'opened',
      stamp: 'opened',
      expectedVersion,
    });
  }

  async triage(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      severity?: string | null;
      priority?: string | null;
      confidentiality?: string | null;
      riskRating?: string | null;
      recommendedTeam?: string | null;
      recommendedSlaPolicy?: string | null;
      legalStatus?: string | null;
      ruleEvaluationId?: string | null;
      reasonCode?: string | null;
    },
  ): Promise<CaseRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.caseTriage);
    if (input.severity != null && !isSeverity(input.severity))
      throw badRequest('invalid severity', ctx.correlationId);
    if (input.priority != null && !isPriority(input.priority))
      throw badRequest('invalid priority', ctx.correlationId);
    if (input.riskRating != null && !isRiskRating(input.riskRating))
      throw badRequest('invalid risk rating', ctx.correlationId);
    if (input.confidentiality != null && !isConfidentiality(input.confidentiality))
      throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const c = await this.repo.findCase(tx, id);
      if (c === null) throw ProblemError.notFound('Case not found.', ctx.correlationId);
      const to = checkCaseTransition(c.status, 'triage').ok ? 'triage' : c.status;
      const upd = await this.repo.patchCase(tx, {
        id,
        expectedVersion: input.expectedVersion,
        severity: input.severity ?? null,
        priority: input.priority ?? null,
        riskRating: input.riskRating ?? null,
        confidentiality: input.confidentiality ?? null,
        triageStatus: 'triaged',
        responsibleTeam: input.recommendedTeam ?? null,
        slaPolicyCode: input.recommendedSlaPolicy ?? null,
        legalStatus: input.legalStatus ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Case modified concurrently (stale version).', ctx.correlationId);
      if (to !== c.status) {
        await this.repo.updateCaseStatus(tx, { id, expectedVersion: upd.version, toStatus: to, by: actor });
        await this.repo.insertStatusHistory(tx, {
          tenantId: ctx.tenantId,
          caseId: id,
          fromStatus: c.status,
          toStatus: to,
          reason: null,
          reasonCode: 'triage',
          by: actor,
          correlationId: ctx.correlationId,
        });
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.triageCompleted,
        entityType: 'case_record',
        entityId: id,
        ...(input.ruleEvaluationId != null
          ? { detail: { ruleEvaluationId: input.ruleEvaluationId } }
          : { detail: {} }),
      });
      await this.emitter.publish(tx, {
        type: 'CaseTriaged',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          caseId: id,
          ...(input.severity != null ? { severity: input.severity } : {}),
          ...(input.priority != null ? { priority: input.priority } : {}),
          ...(input.ruleEvaluationId != null ? { ruleEvaluationId: input.ruleEvaluationId } : {}),
          toStatus: to,
        },
      });
      const result = await this.repo.findCase(tx, id);
      return result ?? upd;
    });
  }

  async assign(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      owner: string;
      kind?: string;
      team?: string | null;
      reason?: string | null;
      reassign?: boolean;
      delegation?: boolean;
      ruleEvaluationId?: string | null;
    },
  ): Promise<CaseRow> {
    await this.authz.require(
      ctx,
      input.reassign === true ? M13_PERMISSIONS.caseReassign : M13_PERMISSIONS.caseAssign,
    );
    if (input.owner.trim() === '') throw badRequest('an owner is required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const c = await this.repo.findCase(tx, id);
      if (c === null) throw ProblemError.notFound('Case not found.', ctx.correlationId);
      if (isCaseTerminal(c.status)) throw ProblemError.conflict(`Case is ${c.status}.`, ctx.correlationId);
      const to = checkCaseTransition(c.status, 'assigned').ok ? 'assigned' : c.status;
      const upd = await this.repo.assignCase(tx, {
        id,
        expectedVersion: input.expectedVersion,
        owner: input.owner,
        toStatus: to,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Case modified concurrently (stale version).', ctx.correlationId);
      if (input.team != null)
        await this.repo.patchCase(tx, {
          id,
          expectedVersion: upd.version,
          responsibleTeam: input.team,
          by: actor,
        });
      await this.repo.insertAssignmentHistory(tx, {
        tenantId: ctx.tenantId,
        caseId: id,
        kind: input.kind ?? 'officer',
        ref: input.owner,
        by: actor,
        reason: input.reason ?? null,
        delegation: input.delegation === true,
        ruleEvalId: input.ruleEvaluationId ?? null,
        correlationId: ctx.correlationId,
      });
      if (to !== c.status)
        await this.repo.insertStatusHistory(tx, {
          tenantId: ctx.tenantId,
          caseId: id,
          fromStatus: c.status,
          toStatus: to,
          reason: null,
          reasonCode: 'assigned',
          by: actor,
          correlationId: ctx.correlationId,
        });
      await this.emitter.recordAudit(tx, ctx, {
        code: input.reassign === true ? M13_AUDIT_CODES.caseReassigned : M13_AUDIT_CODES.caseAssigned,
        entityType: 'case_record',
        entityId: id,
        detail: { owner: input.owner },
      });
      await this.emitter.publish(tx, {
        type: input.reassign === true ? 'CaseReassigned' : 'CaseAssigned',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId: id, toStatus: to },
      });
      const result = await this.repo.findCase(tx, id);
      return result ?? upd;
    });
  }

  resolve(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    summary: string | null,
  ) {
    return this.db.withTenant(ctx, async (tx) => {
      await this.authz.require(ctx, M13_PERMISSIONS.caseResolve);
      const c = await this.repo.findCase(tx, id);
      if (c === null) throw ProblemError.notFound('Case not found.', ctx.correlationId);
      const check = checkCaseTransition(c.status, 'resolved');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot resolve from ${c.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateCaseStatus(tx, {
        id,
        expectedVersion,
        toStatus: 'resolved',
        by: actor,
        stamp: 'resolved',
      });
      if (upd === null)
        throw ProblemError.conflict('Case modified concurrently (stale version).', ctx.correlationId);
      if (summary != null)
        await this.repo.patchCase(tx, {
          id,
          expectedVersion: upd.version,
          resolutionSummary: summary,
          by: actor,
        });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        caseId: id,
        fromStatus: c.status,
        toStatus: 'resolved',
        reason: null,
        reasonCode: 'resolved',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.caseResolved,
        entityType: 'case_record',
        entityId: id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'CaseResolved',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId: id, fromStatus: c.status, toStatus: 'resolved' },
      });
      const result = await this.repo.findCase(tx, id);
      return result ?? upd;
    });
  }

  async close(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      summary?: string | null;
      residualRisk?: string | null;
      waive?: boolean;
    },
  ): Promise<CaseRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.caseClose);
    return this.db.withTenant(ctx, async (tx) => {
      const c = await this.repo.findCase(tx, id);
      if (c === null) throw ProblemError.notFound('Case not found.', ctx.correlationId);
      if (isCaseTerminal(c.status)) throw ProblemError.conflict(`Case is ${c.status}.`, ctx.correlationId);
      const openMandatoryTasks = await this.repo.countOpenMandatoryTasks(tx, id);
      const openDeadlines = await this.repo.countOpenDeadlines(tx, id);
      const unresolvedIssues = await this.repo.countUnresolvedMandatoryIssues(tx, id);
      const decisionApproved = await this.repo.hasApprovedDecision(tx, id);
      const state = {
        workflowComplete: true,
        openMandatoryTasks,
        findingsRecorded: await this.repo.hasFindings(tx, id),
        decisionApproved,
        requiredDocumentsPresent: true,
        openDeadlines,
        subjectInformed: c.subject_informed,
        remedyRecorded: decisionApproved,
        settlementResolved: true,
        activeLegalHold: c.legal_hold,
        openCriticalEscalations: 0,
        unresolvedMandatoryIssues: unresolvedIssues,
        regulatoryActionComplete: true,
      };
      const criteria: ClosureCriteria =
        input.waive === true ? { requireNoActiveLegalHold: true } : DEFAULT_CLOSURE_CRITERIA;
      const eligibility = evaluateClosure(criteria, state);
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.closureEvaluated,
        entityType: 'case_record',
        entityId: id,
        detail: { eligible: eligibility.eligible, reasons: eligibility.reasonCodes.length },
      });
      if (!eligibility.eligible)
        throw ProblemError.conflict(
          `Not eligible for closure: ${eligibility.reasonCodes.join(', ')}`,
          ctx.correlationId,
        );
      const check = checkCaseTransition(c.status, 'closed');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot close from ${c.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateCaseStatus(tx, {
        id,
        expectedVersion: input.expectedVersion,
        toStatus: 'closed',
        by: actor,
        stamp: 'closed',
      });
      if (upd === null)
        throw ProblemError.conflict('Case modified concurrently (stale version).', ctx.correlationId);
      await this.repo.patchCase(tx, {
        id,
        expectedVersion: upd.version,
        closureSummary: input.summary ?? null,
        residualRisk: input.residualRisk ?? null,
        by: actor,
      });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        caseId: id,
        fromStatus: c.status,
        toStatus: 'closed',
        reason: null,
        reasonCode: 'closed',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.caseClosed,
        entityType: 'case_record',
        entityId: id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'CaseClosed',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId: id, toStatus: 'closed' },
      });
      const result = await this.repo.findCase(tx, id);
      return result ?? upd;
    });
  }

  async reopen(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<CaseRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.caseReopen);
    if (input.reason.trim() === '') throw badRequest('a reason is required to reopen', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const c = await this.repo.findCase(tx, id);
      if (c === null) throw ProblemError.notFound('Case not found.', ctx.correlationId);
      const check = checkCaseTransition(c.status, 'reopened');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot reopen from ${c.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateCaseStatus(tx, {
        id,
        expectedVersion: input.expectedVersion,
        toStatus: 'reopened',
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Case modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        caseId: id,
        fromStatus: c.status,
        toStatus: 'reopened',
        reason: input.reason,
        reasonCode: 'reopened',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.caseReopened,
        entityType: 'case_record',
        entityId: id,
        reason: input.reason,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'CaseReopened',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId: id, toStatus: 'reopened' },
      });
      return upd;
    });
  }

  async archive(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<CaseRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.caseArchive);
    return this.db.withTenant(ctx, async (tx) => {
      const c = await this.repo.findCase(tx, id);
      if (c === null) throw ProblemError.notFound('Case not found.', ctx.correlationId);
      if (c.legal_hold)
        throw ProblemError.conflict('An active legal hold blocks archival.', ctx.correlationId);
      const check = checkCaseTransition(c.status, 'archived');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot archive from ${c.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateCaseStatus(tx, {
        id,
        expectedVersion,
        toStatus: 'archived',
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Case modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        caseId: id,
        fromStatus: c.status,
        toStatus: 'archived',
        reason: null,
        reasonCode: 'archived',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.caseArchived,
        entityType: 'case_record',
        entityId: id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'CaseArchived',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId: id, toStatus: 'archived' },
      });
      return upd;
    });
  }

  /** The controlled m14 boundary — promote a case to a legal matter (emits case.converted_to_matter). */
  async convertToMatter(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { recommendedMatterType?: string | null; reason?: string | null },
  ): Promise<CaseRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.legalManage);
    return this.db.withTenant(ctx, async (tx) => {
      const c = await this.repo.findCase(tx, id);
      if (c === null) throw ProblemError.notFound('Case not found.', ctx.correlationId);
      if (isCaseTerminal(c.status)) throw ProblemError.conflict(`Case is ${c.status}.`, ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.convertedToMatter,
        entityType: 'case_record',
        entityId: id,
        detail: { recommendedMatterType: input.recommendedMatterType },
      });
      await this.emitter.publishConversion(tx, {
        type: 'CaseConvertedToMatter',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          caseId: id,
          caseType: c.case_type_code,
          ...(input.recommendedMatterType != null
            ? { recommendedMatterType: input.recommendedMatterType }
            : {}),
          ...(c.legal_status != null ? { legalStatus: c.legal_status } : {}),
          ...(c.court_reference != null ? { courtReference: c.court_reference } : {}),
          reasonCode: 'converted',
        },
      });
      return c;
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async get(ctx: RequestContext, id: string): Promise<{ case: CaseRow; canReadConfidential: boolean }> {
    await this.authz.require(ctx, M13_PERMISSIONS.caseRead);
    const canReadConfidential = await this.authz.can(ctx, M13_PERMISSIONS.confidentialRead);
    const c = await this.db.withTenant(ctx, async (tx) => {
      const found = await this.repo.findCase(tx, id);
      if (found !== null && canReadConfidential && found.confidentiality !== 'standard') {
        await this.emitter.recordAudit(tx, ctx, {
          code: M13_AUDIT_CODES.confidentialAccessed,
          entityType: 'case_record',
          entityId: id,
          detail: {},
        });
      }
      return found;
    });
    if (c === null) throw ProblemError.notFound('Case not found.', ctx.correlationId);
    if (c.confidentiality !== 'standard' && !canReadConfidential) {
      // A confidential case is still listable by id but its sensitive fields are redacted by the view.
    }
    return { case: c, canReadConfidential };
  }
  async search(
    ctx: RequestContext,
    filters: {
      caseTypeCode?: string;
      status?: string;
      severity?: string;
      priority?: string;
      branch?: string;
      department?: string;
      owner?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<CaseRow[]> {
    await this.authz.require(ctx, M13_PERMISSIONS.caseRead);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.searchCases(tx, {
        ...filters,
        limit: Math.min(filters.limit ?? 50, CASE_LIMITS.maxSearchLimit),
        offset: filters.offset ?? 0,
      }),
    );
  }
}
