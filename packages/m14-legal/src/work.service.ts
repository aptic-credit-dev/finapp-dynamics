/**
 * MatterWorkService — the structured working entities of a legal matter: parties, activities (incl.
 * correspondence), tasks, issues, pleadings/filings, court events, deadlines/limitation, research references and
 * notes (G6-G17/G31/G32). Every mutating method enforces its permission (default deny), runs inside
 * `db.withTenant`, records audit + a legal.lifecycle event in the same tx, and is optimistic-lock/CAS guarded.
 * Party contacts, privileged/counsel/strategy notes and correspondence bodies are sensitive: RLS-stored, redacted
 * on read, and never in events/audit (ADR-064). Full pleadings/documents live in m09; only references + metadata
 * are stored here.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M14_PERMISSIONS } from './permissions.ts';
import { M14_AUDIT_CODES } from './audit-codes.ts';
import {
  isPartyRole,
  isConfidentiality,
  isPleadingRole,
  isCourtEventType,
  isDeadlineType,
  isNoteType,
  isRestrictedNote,
  LEGAL_LIMITS,
} from './domain/limits.ts';
import { computeDeadlineDueMs, isLimitationSafe, type DeadlineRule } from './domain/deadlines.ts';
import {
  LegalRepository,
  type PartyRow,
  type ActivityRow,
  type TaskRow,
  type IssueRow,
  type ResearchRow,
  type PleadingRow,
  type CourtEventRow,
  type DeadlineRow,
  type NoteRow,
} from './repository.ts';
import type { M14Emitter } from './emit.ts';
import type { Clock } from './ports.ts';
import { SystemClock } from './ports.ts';
import { badRequest } from './errors.ts';

export class MatterWorkService {
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

  private async requireMatter(
    tx: Parameters<Parameters<Db['withTenant']>[1]>[0],
    id: string,
    correlationId: string,
  ) {
    const m = await this.repo.findMatter(tx, id);
    if (m === null) throw ProblemError.notFound('Matter not found.', correlationId);
    return m;
  }

  // --- parties ----------------------------------------------------------------------------------
  async addParty(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      partyRole: string;
      entityRef?: string | null;
      displayLabel?: string | null;
      advocateRef?: string | null;
      lawFirmRef?: string | null;
      contactRef?: string | null;
      authority?: string | null;
      confidentiality?: string;
      relationship?: string | null;
    },
  ): Promise<PartyRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.partyManage);
    if (!isPartyRole(input.partyRole)) throw badRequest('invalid party role', ctx.correlationId);
    const conf = input.confidentiality ?? 'standard';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireMatter(tx, matterId, ctx.correlationId);
      const p = await this.repo.insertParty(tx, {
        tenantId: ctx.tenantId,
        matterId,
        partyRole: input.partyRole,
        entityRef: input.entityRef ?? null,
        displayLabel: input.displayLabel ?? null,
        advocateRef: input.advocateRef ?? null,
        lawFirmRef: input.lawFirmRef ?? null,
        contactRef: input.contactRef ?? null,
        authority: input.authority ?? null,
        confidentiality: conf,
        relationship: input.relationship ?? null,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.partyAdded,
        entityType: 'legal_party',
        entityId: p.id,
        detail: { partyRole: input.partyRole },
      });
      await this.emitter.publish(tx, {
        type: 'PartyAdded',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId },
      });
      return p;
    });
  }
  async removeParty(
    ctx: RequestContext,
    actor: string | null,
    partyId: string,
    expectedVersion: number,
  ): Promise<PartyRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.partyManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.deactivateParty(tx, { id: partyId, expectedVersion, by: actor });
      if (upd === null)
        throw ProblemError.conflict('Party already inactive or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.partyRemoved,
        entityType: 'legal_party',
        entityId: partyId,
        detail: {},
      });
      return upd;
    });
  }
  async listParties(
    ctx: RequestContext,
    matterId: string,
  ): Promise<{ parties: PartyRow[]; canReadContact: boolean }> {
    await this.authz.require(ctx, M14_PERMISSIONS.partyRead);
    const canReadContact = await this.authz.can(ctx, M14_PERMISSIONS.partyContactRead);
    const parties = await this.db.withTenant(ctx, (tx) => this.repo.listParties(tx, matterId));
    return { parties, canReadContact };
  }

  // --- activities (incl. correspondence) --------------------------------------------------------
  async addActivity(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      activityType: string;
      headline: string;
      description?: string | null;
      occurredAt?: string | null;
      dueAt?: string | null;
      assignedTo?: string | null;
      direction?: string | null;
      source?: string | null;
      confidentiality?: string;
      privileged?: boolean;
      documentRefs?: unknown;
      responseRequired?: boolean;
      correspondence?: boolean;
    },
  ): Promise<ActivityRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.activityCreate);
    const conf = input.confidentiality ?? 'standard';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    if (input.description != null && input.description.length > LEGAL_LIMITS.maxActivityDescriptionChars)
      throw badRequest('activity description too long', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireMatter(tx, matterId, ctx.correlationId);
      const a = await this.repo.insertActivity(tx, {
        tenantId: ctx.tenantId,
        matterId,
        activityType: input.activityType,
        headline: input.headline,
        description: input.description ?? null,
        occurredAt: input.occurredAt ?? null,
        dueAt: input.dueAt ?? null,
        assignedTo: input.assignedTo ?? null,
        direction: input.direction ?? null,
        source: input.source ?? null,
        confidentiality: conf,
        privileged: input.privileged === true,
        documentRefs: input.documentRefs ?? null,
        responseRequired: input.responseRequired === true,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code:
          input.correspondence === true
            ? M14_AUDIT_CODES.correspondenceRecorded
            : M14_AUDIT_CODES.activityCreated,
        entityType: 'legal_activity',
        entityId: a.id,
        detail: { activityType: input.activityType },
      });
      await this.emitter.publish(tx, {
        type: 'ActivityCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId },
      });
      return a;
    });
  }
  async completeActivity(
    ctx: RequestContext,
    actor: string | null,
    activityId: string,
    expectedVersion: number,
    outcome: string | null,
  ): Promise<ActivityRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.activityComplete);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.completeActivity(tx, {
        id: activityId,
        expectedVersion,
        outcome,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Activity already complete or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.activityCompleted,
        entityType: 'legal_activity',
        entityId: activityId,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'ActivityCompleted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId: upd.matter_id },
      });
      return upd;
    });
  }
  async listActivities(ctx: RequestContext, matterId: string): Promise<ActivityRow[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.activityRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listActivities(tx, matterId));
  }

  // --- tasks ------------------------------------------------------------------------------------
  async addTask(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      taskType: string;
      headline: string;
      description?: string | null;
      owner?: string | null;
      team?: string | null;
      dueAt?: string | null;
      priority?: string;
      mandatory?: boolean;
      workflowTaskRef?: string | null;
    },
  ): Promise<TaskRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.taskManage);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireMatter(tx, matterId, ctx.correlationId);
      const t = await this.repo.insertTask(tx, {
        tenantId: ctx.tenantId,
        matterId,
        taskType: input.taskType,
        headline: input.headline,
        description: input.description ?? null,
        owner: input.owner ?? null,
        team: input.team ?? null,
        dueAt: input.dueAt ?? null,
        priority: input.priority ?? 'normal',
        mandatory: input.mandatory === true,
        workflowTaskRef: input.workflowTaskRef ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.taskCreated,
        entityType: 'legal_task',
        entityId: t.id,
        detail: { taskType: input.taskType },
      });
      await this.emitter.publish(tx, {
        type: 'TaskCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId },
      });
      return t;
    });
  }
  async completeTask(
    ctx: RequestContext,
    actor: string | null,
    taskId: string,
    expectedVersion: number,
    outcome: string | null,
  ): Promise<TaskRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.taskManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.completeTask(tx, { id: taskId, expectedVersion, outcome, by: actor });
      if (upd === null)
        throw ProblemError.conflict(
          'Task already complete/cancelled or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.taskCompleted,
        entityType: 'legal_task',
        entityId: taskId,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'TaskCompleted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId: upd.matter_id },
      });
      return upd;
    });
  }
  async listTasks(ctx: RequestContext, matterId: string): Promise<TaskRow[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.taskRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listTasks(tx, matterId));
  }

  // --- issues -----------------------------------------------------------------------------------
  async addIssue(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      issueCode?: string | null;
      category?: string | null;
      statement: string;
      causeOfAction?: string | null;
      defence?: string | null;
      legalBasisReference?: string | null;
      risk?: string | null;
      mandatory?: boolean;
    },
  ): Promise<IssueRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.issueManage);
    if (input.statement.trim() === '') throw badRequest('an issue statement is required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireMatter(tx, matterId, ctx.correlationId);
      const i = await this.repo.insertIssue(tx, {
        tenantId: ctx.tenantId,
        matterId,
        issueCode: input.issueCode ?? null,
        category: input.category ?? null,
        statement: input.statement,
        causeOfAction: input.causeOfAction ?? null,
        defence: input.defence ?? null,
        legalBasisReference: input.legalBasisReference ?? null,
        affectedParty: null,
        risk: input.risk ?? null,
        mandatory: input.mandatory === true,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.issueCreated,
        entityType: 'legal_issue',
        entityId: i.id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'IssueCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId },
      });
      return i;
    });
  }
  async patchIssue(
    ctx: RequestContext,
    actor: string | null,
    issueId: string,
    input: {
      expectedVersion: number;
      position?: string | null;
      outcome?: string | null;
      status?: string | null;
    },
  ): Promise<IssueRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.issueManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.patchIssue(tx, {
        id: issueId,
        expectedVersion: input.expectedVersion,
        position: input.position ?? null,
        outcome: input.outcome ?? null,
        status: input.status ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Issue modified concurrently (stale version).', ctx.correlationId);
      return upd;
    });
  }
  async listIssues(ctx: RequestContext, matterId: string): Promise<IssueRow[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.issueRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listIssues(tx, matterId));
  }

  // --- research references ----------------------------------------------------------------------
  async addResearch(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      referenceType: string;
      citation?: string | null;
      title?: string | null;
      jurisdiction?: string | null;
      source?: string | null;
      relevanceSummary?: string | null;
      relatedIssue?: string | null;
      documentRef?: string | null;
    },
  ): Promise<ResearchRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.researchManage);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireMatter(tx, matterId, ctx.correlationId);
      const r = await this.repo.insertResearch(tx, {
        tenantId: ctx.tenantId,
        matterId,
        referenceType: input.referenceType,
        citation: input.citation ?? null,
        title: input.title ?? null,
        jurisdiction: input.jurisdiction ?? null,
        source: input.source ?? null,
        relevanceSummary: input.relevanceSummary ?? null,
        relatedIssue: input.relatedIssue ?? null,
        documentRef: input.documentRef ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.researchAdded,
        entityType: 'legal_research_reference',
        entityId: r.id,
        detail: { referenceType: input.referenceType },
      });
      return r;
    });
  }
  async listResearch(ctx: RequestContext, matterId: string): Promise<ResearchRow[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.researchRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listResearch(tx, matterId));
  }

  // --- pleadings + documents --------------------------------------------------------------------
  async registerPleading(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      documentRole: string;
      documentRef?: string | null;
      confidentiality?: string;
      privileged?: boolean;
      relatedCourtEvent?: string | null;
      relatedIssue?: string | null;
    },
  ): Promise<PleadingRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.pleadingManage);
    if (!isPleadingRole(input.documentRole)) throw badRequest('invalid pleading role', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireMatter(tx, matterId, ctx.correlationId);
      const p = await this.repo.insertPleading(tx, {
        tenantId: ctx.tenantId,
        matterId,
        documentRole: input.documentRole,
        documentRef: input.documentRef ?? null,
        confidentiality: conf,
        privileged: input.privileged === true,
        relatedCourtEvent: input.relatedCourtEvent ?? null,
        relatedIssue: input.relatedIssue ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.pleadingRegistered,
        entityType: 'legal_pleading',
        entityId: p.id,
        detail: { documentRole: input.documentRole },
      });
      await this.emitter.publish(tx, {
        type: 'PleadingRegistered',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId },
      });
      return p;
    });
  }
  async filePleading(
    ctx: RequestContext,
    actor: string | null,
    pleadingId: string,
    input: { expectedVersion: number; courtStampReference?: string | null },
  ): Promise<PleadingRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.pleadingManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.filePleading(tx, {
        id: pleadingId,
        expectedVersion: input.expectedVersion,
        courtStampReference: input.courtStampReference ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Pleading not fileable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.pleadingFiled,
        entityType: 'legal_pleading',
        entityId: pleadingId,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'PleadingFiled',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId: upd.matter_id },
      });
      return upd;
    });
  }
  async linkDocument(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: { documentRef: string; documentRole?: string; confidentiality?: string; privileged?: boolean },
  ): Promise<PleadingRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.documentLink);
    const role = input.documentRole ?? 'list_of_documents';
    if (!isPleadingRole(role)) throw badRequest('invalid document role', ctx.correlationId);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireMatter(tx, matterId, ctx.correlationId);
      const p = await this.repo.insertPleading(tx, {
        tenantId: ctx.tenantId,
        matterId,
        documentRole: role,
        documentRef: input.documentRef,
        confidentiality: conf,
        privileged: input.privileged === true,
        relatedCourtEvent: null,
        relatedIssue: null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.documentLinked,
        entityType: 'legal_pleading',
        entityId: p.id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'DocumentLinked',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId },
      });
      return p;
    });
  }
  async listPleadings(ctx: RequestContext, matterId: string): Promise<PleadingRow[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.pleadingRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listPleadings(tx, matterId));
  }

  // --- court events -----------------------------------------------------------------------------
  async scheduleCourtEvent(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      eventType: string;
      title?: string | null;
      scheduledAt?: string | null;
      forum?: string | null;
      venue?: string | null;
      presidingRef?: string | null;
      documentRefs?: unknown;
    },
  ): Promise<CourtEventRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.courtEventManage);
    if (!isCourtEventType(input.eventType)) throw badRequest('invalid court event type', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireMatter(tx, matterId, ctx.correlationId);
      const e = await this.repo.insertCourtEvent(tx, {
        tenantId: ctx.tenantId,
        matterId,
        eventType: input.eventType,
        title: input.title ?? null,
        scheduledAt: input.scheduledAt ?? null,
        forum: input.forum ?? null,
        venue: input.venue ?? null,
        presidingRef: input.presidingRef ?? null,
        documentRefs: input.documentRefs ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.courtEventScheduled,
        entityType: 'legal_court_event',
        entityId: e.id,
        detail: { eventType: input.eventType },
      });
      await this.emitter.publish(tx, {
        type: 'CourtEventScheduled',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId, ...(input.scheduledAt != null ? { dueAt: input.scheduledAt } : {}) },
      });
      return e;
    });
  }
  async updateCourtEvent(
    ctx: RequestContext,
    actor: string | null,
    eventId: string,
    input: {
      expectedVersion: number;
      scheduledAt?: string | null;
      status?: string | null;
      adjournmentReason?: string | null;
      nextAt?: string | null;
    },
  ): Promise<CourtEventRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.courtEventManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateCourtEvent(tx, {
        id: eventId,
        expectedVersion: input.expectedVersion,
        scheduledAt: input.scheduledAt ?? null,
        status: input.status ?? null,
        adjournmentReason: input.adjournmentReason ?? null,
        nextAt: input.nextAt ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Court event modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.courtEventUpdated,
        entityType: 'legal_court_event',
        entityId: eventId,
        detail: {},
      });
      return upd;
    });
  }
  async completeCourtEvent(
    ctx: RequestContext,
    actor: string | null,
    eventId: string,
    input: {
      expectedVersion: number;
      outcome?: string | null;
      orderDirection?: string | null;
      nextAction?: string | null;
      nextAt?: string | null;
    },
  ): Promise<CourtEventRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.courtEventManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.completeCourtEvent(tx, {
        id: eventId,
        expectedVersion: input.expectedVersion,
        outcome: input.outcome ?? null,
        orderDirection: input.orderDirection ?? null,
        nextAction: input.nextAction ?? null,
        nextAt: input.nextAt ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Court event already complete or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.courtEventCompleted,
        entityType: 'legal_court_event',
        entityId: eventId,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'CourtEventCompleted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId: upd.matter_id },
      });
      return upd;
    });
  }
  async listCourtEvents(ctx: RequestContext, matterId: string): Promise<CourtEventRow[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.courtEventRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listCourtEvents(tx, matterId));
  }

  // --- deadlines (deterministic; limitation is high-risk) ---------------------------------------
  async addDeadline(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      deadlineType: string;
      rule: DeadlineRule;
      startAt?: string | null;
      source?: string | null;
      authority?: string | null;
    },
  ): Promise<DeadlineRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.deadlineManage);
    if (!isDeadlineType(input.deadlineType)) throw badRequest('invalid deadline type', ctx.correlationId);
    const startMs = input.startAt != null ? Date.parse(input.startAt) : this.clock.now();
    const dueMs = computeDeadlineDueMs({ type: input.deadlineType, startMs, rule: input.rule });
    if (!isLimitationSafe(input.deadlineType, dueMs, this.clock.now()))
      throw badRequest('a limitation deadline cannot be in the past', ctx.correlationId);
    const iso = (ms: number): string => new Date(ms).toISOString();
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.requireMatter(tx, matterId, ctx.correlationId);
      const d = await this.repo.insertDeadline(tx, {
        tenantId: ctx.tenantId,
        matterId,
        deadlineType: input.deadlineType,
        startAt: iso(startMs),
        dueAt: iso(dueMs),
        calculationRule: input.rule.kind,
        source: input.source ?? null,
        authority: input.authority ?? null,
        linkedTask: null,
        linkedActivity: null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      if (input.deadlineType === 'limitation')
        await this.repo.patchMatter(tx, {
          id: matterId,
          expectedVersion: m.version,
          limitationAt: iso(dueMs),
          by: actor,
        });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.deadlineCreated,
        entityType: 'legal_deadline',
        entityId: d.id,
        detail: { deadlineType: input.deadlineType },
      });
      await this.emitter.publish(tx, {
        type: 'DeadlineCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId, dueAt: iso(dueMs) },
      });
      return d;
    });
  }
  async extendDeadline(
    ctx: RequestContext,
    actor: string | null,
    deadlineId: string,
    input: { expectedVersion: number; extensionTo: string; reason?: string | null },
  ): Promise<DeadlineRow> {
    await this.authz.require(ctx, M14_PERMISSIONS.deadlineManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.extendDeadline(tx, {
        id: deadlineId,
        expectedVersion: input.expectedVersion,
        extensionTo: input.extensionTo,
        reason: input.reason ?? null,
        authority: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Deadline not extendable or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.deadlineExtended,
        entityType: 'legal_deadline',
        entityId: deadlineId,
        reason: input.reason ?? '',
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
    await this.authz.require(ctx, M14_PERMISSIONS.deadlineManage);
    return this.db.withTenant(ctx, async (tx) => {
      const d = await this.repo.findDeadline(tx, deadlineId);
      if (d === null) throw ProblemError.notFound('Deadline not found.', ctx.correlationId);
      if (d.status !== 'open' && d.status !== 'extended') return { breached: d.status === 'breached' };
      if (this.clock.now() <= Date.parse(d.due_at)) return { breached: false };
      const upd = await this.repo.markDeadlineBreach(tx, deadlineId);
      if (upd === null) return { breached: true };
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.deadlineBreached,
        entityType: 'legal_deadline',
        entityId: deadlineId,
        detail: { deadlineType: d.deadline_type },
      });
      await this.emitter.publish(tx, {
        type: 'DeadlineBreached',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { matterId: d.matter_id, reasonCode: d.deadline_type },
      });
      return { breached: true };
    });
  }
  async listDeadlines(ctx: RequestContext, matterId: string): Promise<DeadlineRow[]> {
    await this.authz.require(ctx, M14_PERMISSIONS.deadlineRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listDeadlines(tx, matterId));
  }

  // --- notes ------------------------------------------------------------------------------------
  async addNote(
    ctx: RequestContext,
    actor: string | null,
    matterId: string,
    input: {
      noteType?: string;
      headline?: string | null;
      content: string;
      confidentiality?: string;
      relatedIssue?: string | null;
    },
  ): Promise<NoteRow> {
    const noteType = input.noteType ?? 'general';
    if (!isNoteType(noteType)) throw badRequest('invalid note type', ctx.correlationId);
    const restricted = isRestrictedNote(noteType);
    await this.authz.require(
      ctx,
      restricted ? M14_PERMISSIONS.privilegedCreate : M14_PERMISSIONS.activityCreate,
    );
    if (input.content.trim() === '' || input.content.length > LEGAL_LIMITS.maxNoteChars)
      throw badRequest('note content is required and must be bounded', ctx.correlationId);
    const conf = input.confidentiality ?? (restricted ? 'privileged' : 'standard');
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireMatter(tx, matterId, ctx.correlationId);
      const n = await this.repo.insertNote(tx, {
        tenantId: ctx.tenantId,
        matterId,
        noteType,
        headline: input.headline ?? null,
        content: input.content,
        author: actor,
        privileged: restricted,
        confidentiality: conf,
        relatedIssue: input.relatedIssue ?? null,
        relatedActivity: null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      // Note CONTENT never enters the event/audit payload (ADR-064).
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.noteCreated,
        entityType: 'legal_note',
        entityId: n.id,
        detail: { noteType, restricted },
      });
      return n;
    });
  }
  async listNotes(
    ctx: RequestContext,
    matterId: string,
  ): Promise<{ notes: NoteRow[]; canReadPrivileged: boolean }> {
    await this.authz.require(ctx, M14_PERMISSIONS.activityRead);
    const canReadPrivileged = await this.authz.can(ctx, M14_PERMISSIONS.privilegedRead);
    const all = await this.db.withTenant(ctx, (tx) => this.repo.listNotes(tx, matterId));
    const notes = canReadPrivileged ? all : all.filter((n) => !n.privileged);
    if (canReadPrivileged && all.some((n) => n.privileged)) {
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M14_AUDIT_CODES.privilegedAccessed,
          entityType: 'legal_note',
          entityId: matterId,
          detail: {},
        }),
      );
    }
    return { notes, canReadPrivileged };
  }
}
