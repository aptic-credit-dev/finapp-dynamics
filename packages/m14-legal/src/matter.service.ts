/**
 * MatterService — intake (direct instruction, external, and the idempotent M13 case conversion), legal
 * instructions (controlled accept/reject), assignment, the full matter lifecycle, closure, reopening and archival
 * (F2-G4/G34-G36). Every mutating method enforces its permission (default deny), runs inside `db.withTenant`,
 * records audit + a legal.lifecycle outbox event in the SAME transaction, appends status/assignment history, and
 * is optimistic-lock guarded. Lifecycle transitions go through the PURE `checkMatterTransition` choke point.
 * Confidential matters are redacted on read unless the caller holds `legal.confidential.read` (ADR-064). The M13
 * conversion is idempotent (one matter per source case) — m14 consumes `case.converted_to_matter` and never reads
 * m13's tables; no callback into m13 is required.
 */
import { randomUUID } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M14_PERMISSIONS } from './permissions.ts';
import { M14_AUDIT_CODES } from './audit-codes.ts';
import { checkMatterTransition, isMatterTerminal } from './domain/lifecycles.ts';
import { isConfidentiality, isPriority, isLegalRisk, LEGAL_LIMITS } from './domain/limits.ts';
import { evaluateClosure, type ClosureCriteria } from './domain/closure.ts';
import { formatMatterNumber } from './matter-number.ts';
import { LegalRepository, type MatterRow, type InstructionRow } from './repository.ts';
import type { M14Emitter } from './emit.ts';
import type { CaseConversion } from './ports.ts';
import { badRequest } from './errors.ts';

/** Default closure criteria for a worked matter (a full impl consults an M07 rule set + the matter type, ADR-061). */
const DEFAULT_CLOSURE_CRITERIA: ClosureCriteria = {
  requireMandatoryTasksComplete: true,
  requireDeadlinesDispositioned: true,
  requireNoImminentLimitation: true,
  requireOutcomeRecorded: true,
  requireNoActiveLegalHold: true,
  requireNoOpenCriticalEscalation: true,
};

export class MatterService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M14Emitter;
  private readonly repo: LegalRepository;
  constructor(db: Db, authz: Authz, emitter: M14Emitter, repo: LegalRepository = new LegalRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  // --- direct + external intake -----------------------------------------------------------------
  async create(
    ctx: RequestContext,
    actor: string | null,
    input: {
      matterTypeCode: string;
      title: string;
      summary?: string | null;
      legalDescription?: string | null;
      source?: string | null;
      jurisdiction?: string | null;
      forum?: string | null;
      confidentiality?: string | null;
      privileged?: boolean;
      legalRisk?: string | null;
      priority?: string | null;
      branch?: string | null;
      department?: string | null;
      slaPolicyCode?: string | null;
      idempotencyKey?: string | null;
      causationId?: string | null;
    },
  ): Promise<MatterRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.matterCreate);
    return this.insertMatter(ctx, actor, {
      ...input,
      source: input.source ?? 'direct_instruction',
      sourceCaseId: null,
      originatingModule: null,
    });
  }

  private async insertMatter(
    ctx: RequestContext,
    actor: string | null,
    input: {
      matterTypeCode: string;
      title: string;
      summary?: string | null;
      legalDescription?: string | null;
      source: string;
      sourceCaseId?: string | null;
      originatingModule?: string | null;
      jurisdiction?: string | null;
      forum?: string | null;
      confidentiality?: string | null;
      privileged?: boolean;
      legalRisk?: string | null;
      priority?: string | null;
      branch?: string | null;
      department?: string | null;
      slaPolicyCode?: string | null;
      idempotencyKey?: string | null;
      causationId?: string | null;
    },
  ): Promise<MatterRow> {
    if (input.title.trim() === '' || input.title.length > LEGAL_LIMITS.maxTitleChars)
      throw badRequest('a title is required and must be bounded', ctx.correlationId);
    if (input.matterTypeCode.trim() === '') throw badRequest('a matter type is required', ctx.correlationId);
    const confidentiality = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(confidentiality)) throw badRequest('invalid confidentiality', ctx.correlationId);
    const priority = input.priority ?? 'normal';
    if (!isPriority(priority)) throw badRequest('invalid priority', ctx.correlationId);
    if (input.legalRisk != null && !isLegalRisk(input.legalRisk))
      throw badRequest('invalid legal risk', ctx.correlationId);
    if (input.legalDescription != null && input.legalDescription.length > LEGAL_LIMITS.maxDescriptionChars)
      throw badRequest('legal description too long', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findMatterByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const active = await this.repo.findActiveMatterType(tx, input.matterTypeCode);
      const m = await this.repo.insertMatter(tx, {
        tenantId: ctx.tenantId,
        matterNumber: formatMatterNumber(randomUUID()),
        matterTypeCode: input.matterTypeCode,
        matterTypeVersion: active?.version_number ?? null,
        source: input.source,
        sourceCaseId: input.sourceCaseId ?? null,
        originatingModule: input.originatingModule ?? null,
        title: input.title,
        summary: input.summary ?? null,
        legalDescription: input.legalDescription ?? null,
        jurisdiction: input.jurisdiction ?? null,
        forum: input.forum ?? null,
        confidentiality,
        privileged: input.privileged === true,
        legalRisk: input.legalRisk ?? null,
        priority,
        branch: input.branch ?? null,
        department: input.department ?? null,
        slaPolicyCode: input.slaPolicyCode ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        causationId: input.causationId ?? null,
        by: actor,
      });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        matterId: m.id,
        fromStatus: null,
        toStatus: m.status,
        reason: null,
        reasonCode: 'created',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.matterCreated,
        entityType: 'legal_matter',
        entityId: m.id,
        detail: { matterNumber: m.matter_number, matterType: m.matter_type_code, source: m.source },
      });
      await this.emitter.publish(tx, {
        type: 'MatterCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          matterId: m.id,
          matterType: m.matter_type_code,
          source: m.source,
          ...(m.source_case_id != null ? { sourceCaseId: m.source_case_id } : {}),
          toStatus: m.status,
        },
      });
      return m;
    });
  }

  async intakeExternal(
    ctx: RequestContext,
    actor: string | null,
    input: {
      source: string;
      externalReference: string;
      matterTypeCode: string;
      title: string;
      jurisdiction?: string | null;
      branch?: string | null;
      department?: string | null;
    },
  ): Promise<MatterRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.matterCreate);
    const key = `intake:${input.source}:${input.externalReference}`;
    return this.insertMatter(ctx, actor, {
      matterTypeCode: input.matterTypeCode,
      title: input.title,
      source: input.source,
      jurisdiction: input.jurisdiction ?? null,
      branch: input.branch ?? null,
      department: input.department ?? null,
      originatingModule: 'external',
      idempotencyKey: key,
    });
  }

  // --- M13 case conversion (idempotent, one matter per source case) ------------------------------
  async acceptConversion(
    ctx: RequestContext,
    actor: string | null,
    input: CaseConversion,
  ): Promise<{ matter: MatterRow; created: boolean }> {
    await this.authz.require(ctx, M14_PERMISSIONS.conversionAccept);
    if (input.sourceCaseId.trim() === '') throw badRequest('a source case id is required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx): Promise<{ matter: MatterRow; created: boolean }> => {
      const existing = await this.repo.findConversion(tx, input.sourceCaseId);
      if (existing !== null) {
        const m = await this.repo.findMatter(tx, existing.matter_id);
        if (m === null)
          throw ProblemError.conflict('Conversion references a missing matter.', ctx.correlationId);
        return { matter: m, created: false };
      }
      const active = await this.repo.findActiveMatterType(tx, input.matterTypeCode);
      const m = await this.repo.insertMatter(tx, {
        tenantId: ctx.tenantId,
        matterNumber: formatMatterNumber(randomUUID()),
        matterTypeCode: input.matterTypeCode,
        matterTypeVersion: active?.version_number ?? null,
        source: 'case_conversion',
        sourceCaseId: input.sourceCaseId,
        originatingModule: 'm13-case',
        title: input.title,
        summary: null,
        legalDescription: null,
        jurisdiction: null,
        forum: null,
        confidentiality: 'confidential',
        privileged: true,
        legalRisk: null,
        priority: 'high',
        branch: null,
        department: null,
        slaPolicyCode: null,
        idempotencyKey: null,
        correlationId: ctx.correlationId,
        causationId: input.causationId ?? input.sourceCaseId,
        by: actor,
      });
      if (input.courtReference != null)
        await this.repo.patchMatter(tx, {
          id: m.id,
          expectedVersion: m.version,
          courtReference: input.courtReference,
          by: actor,
        });
      await this.repo.insertConversion(tx, {
        tenantId: ctx.tenantId,
        sourceCaseId: input.sourceCaseId,
        matterId: m.id,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        matterId: m.id,
        fromStatus: null,
        toStatus: m.status,
        reason: null,
        reasonCode: 'converted',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.matterConverted,
        entityType: 'legal_case_conversion',
        entityId: input.sourceCaseId,
        detail: { sourceCaseId: input.sourceCaseId, matterId: m.id },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.matterCreated,
        entityType: 'legal_matter',
        entityId: m.id,
        detail: { matterNumber: m.matter_number, source: 'case_conversion' },
      });
      await this.emitter.publish(tx, {
        type: 'MatterCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          matterId: m.id,
          matterType: m.matter_type_code,
          source: 'case_conversion',
          sourceCaseId: input.sourceCaseId,
          toStatus: m.status,
        },
      });
      await this.emitter.publish(tx, {
        type: 'MatterConvertedFromCase',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId: m.id, sourceCaseId: input.sourceCaseId, reasonCode: 'converted' },
      });
      return { matter: m, created: true };
    });
  }

  // --- instructions -----------------------------------------------------------------------------
  async addInstruction(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      instructionType?: string | null;
      instructingDepartment?: string | null;
      summary?: string | null;
      scope?: string | null;
      desiredOutcome?: string | null;
      urgency?: string | null;
      requiredAction?: string | null;
      confidentiality?: string;
      privileged?: boolean;
    },
  ): Promise<InstructionRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.instructionCreate);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, matterId);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      const ins = await this.repo.insertInstruction(tx, {
        tenantId: ctx.tenantId,
        matterId,
        instructionType: input.instructionType ?? null,
        instructingDepartment: input.instructingDepartment ?? null,
        instructingOfficer: actor,
        summary: input.summary ?? null,
        scope: input.scope ?? null,
        desiredOutcome: input.desiredOutcome ?? null,
        urgency: input.urgency ?? null,
        requiredAction: input.requiredAction ?? null,
        responsibleOfficer: null,
        confidentiality: conf,
        privileged: input.privileged === true,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.instructionReceived,
        entityType: 'legal_instruction',
        entityId: ins.id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'InstructionReceived',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId },
      });
      return ins;
    });
  }
  async decideInstruction(
    ctx: RequestContext,
    actor: string | null,
    instructionId: string,
    input: { expectedVersion: number; accept: boolean; rejectionReason?: string | null },
  ): Promise<InstructionRow> {
    await this.authz.require(
      ctx,
      input.accept ? M14_PERMISSIONS.instructionAccept : M14_PERMISSIONS.instructionReject,
    );
    if (!input.accept && (input.rejectionReason ?? '').trim() === '')
      throw badRequest('a rejection reason is required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.decideInstruction(tx, {
        id: instructionId,
        expectedVersion: input.expectedVersion,
        status: input.accept ? 'accepted' : 'rejected',
        by: actor,
        rejectionReason: input.rejectionReason ?? null,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Instruction already decided or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: input.accept ? M14_AUDIT_CODES.instructionAccepted : M14_AUDIT_CODES.instructionRejected,
        entityType: 'legal_instruction',
        entityId: instructionId,
        ...(input.accept ? {} : { reason: input.rejectionReason ?? '' }),
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: input.accept ? 'InstructionAccepted' : 'InstructionRejected',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId: upd.matter_id },
      });
      return upd;
    });
  }
  async listInstructions(ctx: RequestContext, matterId: string): Promise<InstructionRow[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.instructionRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listInstructions(tx, matterId));
  }

  // --- lifecycle --------------------------------------------------------------------------------
  private async move(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    to: string,
    opts: {
      permission: string;
      auditCode: string;
      eventType: 'MatterOpened' | 'MatterResolved';
      reasonCode?: string;
      stamp?: 'opened' | 'filed' | 'resolved' | 'closed' | null;
      expectedVersion: number;
    },
  ): Promise<MatterRow> {
    await this.authz.require(ctx, opts.permission);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, id);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      const check = checkMatterTransition(m.status, to);
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot move ${m.status} -> ${to}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateMatterStatus(tx, {
        id,
        expectedVersion: opts.expectedVersion,
        toStatus: to,
        by: actor,
        stamp: opts.stamp ?? null,
      });
      if (upd === null)
        throw ProblemError.conflict('Matter modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        matterId: id,
        fromStatus: m.status,
        toStatus: to,
        reason: null,
        reasonCode: opts.reasonCode ?? null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: opts.auditCode,
        entityType: 'legal_matter',
        entityId: id,
        detail: { fromStatus: m.status, toStatus: to },
      });
      await this.emitter.publish(tx, {
        type: opts.eventType,
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId: id, fromStatus: m.status, toStatus: to },
      });
      return upd;
    });
  }

  open(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.move(ctx, actor, id, 'opened', {
      permission: M14_PERMISSIONS.matterOpen,
      auditCode: M14_AUDIT_CODES.matterOpened,
      eventType: 'MatterOpened',
      reasonCode: 'opened',
      stamp: 'opened',
      expectedVersion,
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
      ruleEvaluationId?: string | null;
    },
  ): Promise<MatterRow> {
    await this.authz.require(
      ctx,
      input.reassign === true ? M14_PERMISSIONS.matterReassign : M14_PERMISSIONS.matterAssign,
    );
    if (input.owner.trim() === '') throw badRequest('an owner is required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, id);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      if (isMatterTerminal(m.status))
        throw ProblemError.conflict(`Matter is ${m.status}.`, ctx.correlationId);
      const to = checkMatterTransition(m.status, 'legal_review').ok ? 'legal_review' : m.status;
      const upd = await this.repo.assignMatter(tx, {
        id,
        expectedVersion: input.expectedVersion,
        owner: input.owner,
        toStatus: to,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Matter modified concurrently (stale version).', ctx.correlationId);
      if (input.team != null)
        await this.repo.patchMatter(tx, {
          id,
          expectedVersion: upd.version,
          legalTeam: input.team,
          by: actor,
        });
      await this.repo.insertAssignmentHistory(tx, {
        tenantId: ctx.tenantId,
        matterId: id,
        kind: input.kind ?? 'legal_officer',
        ref: input.owner,
        by: actor,
        reason: input.reason ?? null,
        ruleEvalId: input.ruleEvaluationId ?? null,
        correlationId: ctx.correlationId,
      });
      if (to !== m.status)
        await this.repo.insertStatusHistory(tx, {
          tenantId: ctx.tenantId,
          matterId: id,
          fromStatus: m.status,
          toStatus: to,
          reason: null,
          reasonCode: 'assigned',
          by: actor,
          correlationId: ctx.correlationId,
        });
      await this.emitter.recordAudit(tx, ctx, {
        code: input.reassign === true ? M14_AUDIT_CODES.matterReassigned : M14_AUDIT_CODES.matterAssigned,
        entityType: 'legal_matter',
        entityId: id,
        detail: { owner: input.owner },
      });
      await this.emitter.publish(tx, {
        type: input.reassign === true ? 'MatterReassigned' : 'MatterAssigned',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId: id, toStatus: to },
      });
      const result = await this.repo.findMatter(tx, id);
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
      await this.authz.require(ctx, M14_PERMISSIONS.matterResolve);
      const m = await this.repo.findMatter(tx, id);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      const check = checkMatterTransition(m.status, 'resolved');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot resolve from ${m.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateMatterStatus(tx, {
        id,
        expectedVersion,
        toStatus: 'resolved',
        by: actor,
        stamp: 'resolved',
      });
      if (upd === null)
        throw ProblemError.conflict('Matter modified concurrently (stale version).', ctx.correlationId);
      if (summary != null)
        await this.repo.patchMatter(tx, {
          id,
          expectedVersion: upd.version,
          resolutionSummary: summary,
          by: actor,
        });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        matterId: id,
        fromStatus: m.status,
        toStatus: 'resolved',
        reason: null,
        reasonCode: 'resolved',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.matterResolved,
        entityType: 'legal_matter',
        entityId: id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'MatterResolved',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId: id, fromStatus: m.status, toStatus: 'resolved' },
      });
      const result = await this.repo.findMatter(tx, id);
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
  ): Promise<MatterRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.matterClose);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, id);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      if (isMatterTerminal(m.status))
        throw ProblemError.conflict(`Matter is ${m.status}.`, ctx.correlationId);
      const soonIso = new Date(Date.now() + 14 * 86_400_000).toISOString();
      const state = {
        instructionsComplete: !(await this.repo.hasPendingInstruction(tx, id)),
        workflowComplete: true,
        openMandatoryTasks: await this.repo.countOpenMandatoryTasks(tx, id),
        openDeadlines: await this.repo.countOpenDeadlines(tx, id),
        imminentLimitation: await this.repo.hasImminentLimitation(tx, id, soonIso),
        requiredPleadingsFiled: true,
        outcomeRecorded: await this.repo.hasOutcome(tx, id),
        appealDispositioned: true,
        enforcementDispositioned: true,
        counselFinalReport: true,
        costsRecorded: true,
        exposureReviewed: true,
        activeLegalHold: m.legal_hold,
        openCriticalEscalations: 0,
        businessOwnerInformed: m.business_owner_informed,
        closureApproved: true,
      };
      const criteria: ClosureCriteria =
        input.waive === true
          ? { requireNoActiveLegalHold: true, requireNoImminentLimitation: true }
          : DEFAULT_CLOSURE_CRITERIA;
      const eligibility = evaluateClosure(criteria, state);
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.closureEvaluated,
        entityType: 'legal_matter',
        entityId: id,
        detail: { eligible: eligibility.eligible, reasons: eligibility.reasonCodes.length },
      });
      if (!eligibility.eligible)
        throw ProblemError.conflict(
          `Not eligible for closure: ${eligibility.reasonCodes.join(', ')}`,
          ctx.correlationId,
        );
      const check = checkMatterTransition(m.status, 'closed');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot close from ${m.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateMatterStatus(tx, {
        id,
        expectedVersion: input.expectedVersion,
        toStatus: 'closed',
        by: actor,
        stamp: 'closed',
      });
      if (upd === null)
        throw ProblemError.conflict('Matter modified concurrently (stale version).', ctx.correlationId);
      await this.repo.patchMatter(tx, {
        id,
        expectedVersion: upd.version,
        closureSummary: input.summary ?? null,
        residualRisk: input.residualRisk ?? null,
        by: actor,
      });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        matterId: id,
        fromStatus: m.status,
        toStatus: 'closed',
        reason: null,
        reasonCode: 'closed',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.matterClosed,
        entityType: 'legal_matter',
        entityId: id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'MatterClosed',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId: id, toStatus: 'closed' },
      });
      const result = await this.repo.findMatter(tx, id);
      return result ?? upd;
    });
  }

  async reopen(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<MatterRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.matterReopen);
    if (input.reason.trim() === '') throw badRequest('a reason is required to reopen', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, id);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      const check = checkMatterTransition(m.status, 'reopened');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot reopen from ${m.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateMatterStatus(tx, {
        id,
        expectedVersion: input.expectedVersion,
        toStatus: 'reopened',
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Matter modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        matterId: id,
        fromStatus: m.status,
        toStatus: 'reopened',
        reason: input.reason,
        reasonCode: 'reopened',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.matterReopened,
        entityType: 'legal_matter',
        entityId: id,
        reason: input.reason,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'MatterReopened',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId: id, toStatus: 'reopened' },
      });
      return upd;
    });
  }

  async archive(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<MatterRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.matterArchive);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.repo.findMatter(tx, id);
      if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
      if (m.legal_hold)
        throw ProblemError.conflict('An active legal hold blocks archival.', ctx.correlationId);
      const check = checkMatterTransition(m.status, 'archived');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot archive from ${m.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateMatterStatus(tx, {
        id,
        expectedVersion,
        toStatus: 'archived',
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Matter modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        matterId: id,
        fromStatus: m.status,
        toStatus: 'archived',
        reason: null,
        reasonCode: 'archived',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.matterArchived,
        entityType: 'legal_matter',
        entityId: id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'MatterArchived',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId: id, toStatus: 'archived' },
      });
      return upd;
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async get(ctx: RequestContext, id: string): Promise<{ matter: MatterRow; canReadConfidential: boolean }> {
    await this.authz.require(ctx, M14_PERMISSIONS.matterRead);
    const canReadConfidential = await this.authz.can(ctx, M14_PERMISSIONS.confidentialRead);
    const m = await this.db.withTenant(ctx, async (tx) => {
      const found = await this.repo.findMatter(tx, id);
      if (
        found !== null &&
        canReadConfidential &&
        (found.confidentiality !== 'standard' || found.privileged)
      ) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M14_AUDIT_CODES.confidentialAccessed,
          entityType: 'legal_matter',
          entityId: id,
          detail: {},
        });
      }
      return found;
    });
    if (m === null) throw ProblemError.notFound('Matter not found.', ctx.correlationId);
    return { matter: m, canReadConfidential };
  }
  async search(
    ctx: RequestContext,
    filters: {
      matterTypeCode?: string;
      status?: string;
      legalRisk?: string;
      priority?: string;
      jurisdiction?: string;
      branch?: string;
      owner?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<MatterRow[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.matterRead);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.searchMatters(tx, {
        ...filters,
        limit: Math.min(filters.limit ?? 50, LEGAL_LIMITS.maxSearchLimit),
        offset: filters.offset ?? 0,
      }),
    );
  }
}
