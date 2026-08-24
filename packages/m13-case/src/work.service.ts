/**
 * CaseWorkService — the structured working entities of a case: parties, activities (incl. correspondence),
 * tasks, issues/allegations, investigation, findings, documents (m09 references), evidence, deadlines and
 * hearings (F7-F16/F22/F28/F29). Every mutating method enforces its permission (default deny), runs inside
 * `db.withTenant`, records audit + a case.lifecycle event in the same tx, and is optimistic-lock/CAS guarded.
 * Party contacts, privileged/confidential notes, correspondence bodies and full allegations are sensitive:
 * stored under RLS, redacted on read, and never placed in events/audit (ADR-060). Full documents live in m09;
 * only references + case metadata are stored here.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M13_PERMISSIONS } from './permissions.ts';
import { M13_AUDIT_CODES } from './audit-codes.ts';
import {
  isPartyType,
  isConfidentiality,
  isFindingType,
  isEvidenceType,
  isHearingType,
  isDeadlineType,
  isNoteType,
  isRestrictedNote,
  CASE_LIMITS,
} from './domain/limits.ts';
import { computeDeadlineDueMs, isLimitationSafe, type DeadlineRule } from './domain/deadlines.ts';
import {
  CaseRepository,
  type PartyRow,
  type ActivityRow,
  type TaskRow,
  type IssueRow,
  type InvestigationRow,
  type FindingRow,
  type DocumentRow,
  type EvidenceRow,
  type DeadlineRow,
  type HearingRow,
  type NoteRow,
} from './repository.ts';
import type { M13Emitter } from './emit.ts';
import type { Clock } from './ports.ts';
import { SystemClock } from './ports.ts';
import { badRequest } from './errors.ts';

export class CaseWorkService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M13Emitter;
  private readonly repo: CaseRepository;
  private readonly clock: Clock;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M13Emitter,
    repo: CaseRepository = new CaseRepository(),
    clock: Clock = new SystemClock(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.clock = clock;
  }

  private async requireCase(
    tx: Parameters<Parameters<Db['withTenant']>[1]>[0],
    id: string,
    correlationId: string,
  ) {
    const c = await this.repo.findCase(tx, id);
    if (c === null) throw ProblemError.notFound('Case not found.', correlationId);
    return c;
  }

  // --- parties ----------------------------------------------------------------------------------
  async addParty(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: {
      partyType: string;
      role?: string | null;
      entityRef?: string | null;
      displayLabel?: string | null;
      contactRef?: string | null;
      representation?: string | null;
      confidentiality?: string;
      relationship?: string | null;
      consentAuthority?: string | null;
    },
  ): Promise<PartyRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.partyManage);
    if (!isPartyType(input.partyType)) throw badRequest('invalid party type', ctx.correlationId);
    const conf = input.confidentiality ?? 'standard';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireCase(tx, caseId, ctx.correlationId);
      const p = await this.repo.insertParty(tx, {
        tenantId: ctx.tenantId,
        caseId,
        partyType: input.partyType,
        role: input.role ?? null,
        entityRef: input.entityRef ?? null,
        displayLabel: input.displayLabel ?? null,
        contactRef: input.contactRef ?? null,
        representation: input.representation ?? null,
        confidentiality: conf,
        relationship: input.relationship ?? null,
        consentAuthority: input.consentAuthority ?? null,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.partyAdded,
        entityType: 'case_party',
        entityId: p.id,
        detail: { partyType: input.partyType },
      });
      await this.emitter.publish(tx, {
        type: 'PartyAdded',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId },
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
    await this.authz.require(ctx, M13_PERMISSIONS.partyManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.deactivateParty(tx, { id: partyId, expectedVersion, by: actor });
      if (upd === null)
        throw ProblemError.conflict('Party already inactive or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.partyRemoved,
        entityType: 'case_party',
        entityId: partyId,
        detail: {},
      });
      return upd;
    });
  }
  async listParties(
    ctx: RequestContext,
    caseId: string,
  ): Promise<{ parties: PartyRow[]; canReadContact: boolean }> {
    await this.authz.require(ctx, M13_PERMISSIONS.partyRead);
    const canReadContact = await this.authz.can(ctx, M13_PERMISSIONS.partyContactRead);
    return this.db.withTenant(ctx, async (tx) => {
      const parties = await this.repo.listParties(tx, caseId);
      // ADR-060: contact VALUES never enter events/audit — but ACCESS to protected contact data is itself a
      // sensitive, auditable act. Emit CASE_PARTY_CONTACT_ACCESSED ONLY when contact is actually revealed
      // (the caller holds cases.party_contact.read AND ≥1 party exposes a non-null contact ref) — never for
      // non-sensitive party metadata, and carrying only the case id + a count, never the contact value.
      const revealedCount = canReadContact ? parties.filter((p) => p.contact_ref !== null).length : 0;
      if (revealedCount > 0) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M13_AUDIT_CODES.partyContactAccessed,
          entityType: 'case',
          entityId: caseId,
          detail: { revealedCount },
        });
      }
      return { parties, canReadContact };
    });
  }

  // --- activities (incl. correspondence) --------------------------------------------------------
  async addActivity(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: {
      activityType: string;
      headline: string;
      description?: string | null;
      occurredAt?: string | null;
      dueAt?: string | null;
      assignedTo?: string | null;
      direction?: string | null;
      partyRef?: string | null;
      source?: string | null;
      confidentiality?: string;
      documentRefs?: unknown;
      responseRequired?: boolean;
      correspondence?: boolean;
    },
  ): Promise<ActivityRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.activityCreate);
    const conf = input.confidentiality ?? 'standard';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    if (input.description != null && input.description.length > CASE_LIMITS.maxActivityDescriptionChars)
      throw badRequest('activity description too long', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireCase(tx, caseId, ctx.correlationId);
      const a = await this.repo.insertActivity(tx, {
        tenantId: ctx.tenantId,
        caseId,
        activityType: input.activityType,
        headline: input.headline,
        description: input.description ?? null,
        occurredAt: input.occurredAt ?? null,
        dueAt: input.dueAt ?? null,
        assignedTo: input.assignedTo ?? null,
        direction: input.direction ?? null,
        partyRef: input.partyRef ?? null,
        source: input.source ?? null,
        confidentiality: conf,
        documentRefs: input.documentRefs ?? null,
        responseRequired: input.responseRequired === true,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code:
          input.correspondence === true
            ? M13_AUDIT_CODES.correspondenceRecorded
            : M13_AUDIT_CODES.activityCreated,
        entityType: 'case_activity',
        entityId: a.id,
        detail: { activityType: input.activityType },
      });
      await this.emitter.publish(tx, {
        type: 'ActivityCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId },
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
    await this.authz.require(ctx, M13_PERMISSIONS.activityComplete);
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
        code: M13_AUDIT_CODES.activityCompleted,
        entityType: 'case_activity',
        entityId: activityId,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'ActivityCompleted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId: upd.case_id },
      });
      return upd;
    });
  }
  async listActivities(ctx: RequestContext, caseId: string): Promise<ActivityRow[]> {
    await this.authz.require(ctx, M13_PERMISSIONS.activityRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listActivities(tx, caseId));
  }

  // --- tasks ------------------------------------------------------------------------------------
  async addTask(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: {
      taskType: string;
      headline: string;
      description?: string | null;
      owner?: string | null;
      team?: string | null;
      dueAt?: string | null;
      priority?: string;
      mandatory?: boolean;
      completionCriteria?: string | null;
      dependsOn?: string | null;
      workflowTaskRef?: string | null;
    },
  ): Promise<TaskRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.taskManage);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireCase(tx, caseId, ctx.correlationId);
      const t = await this.repo.insertTask(tx, {
        tenantId: ctx.tenantId,
        caseId,
        taskType: input.taskType,
        headline: input.headline,
        description: input.description ?? null,
        owner: input.owner ?? null,
        team: input.team ?? null,
        dueAt: input.dueAt ?? null,
        priority: input.priority ?? 'normal',
        mandatory: input.mandatory === true,
        completionCriteria: input.completionCriteria ?? null,
        dependsOn: input.dependsOn ?? null,
        workflowTaskRef: input.workflowTaskRef ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.taskCreated,
        entityType: 'case_task',
        entityId: t.id,
        detail: { taskType: input.taskType },
      });
      await this.emitter.publish(tx, {
        type: 'TaskCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId },
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
    await this.authz.require(ctx, M13_PERMISSIONS.taskManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.completeTask(tx, { id: taskId, expectedVersion, outcome, by: actor });
      if (upd === null)
        throw ProblemError.conflict(
          'Task already complete/cancelled or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.taskCompleted,
        entityType: 'case_task',
        entityId: taskId,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'TaskCompleted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId: upd.case_id },
      });
      return upd;
    });
  }
  async listTasks(ctx: RequestContext, caseId: string): Promise<TaskRow[]> {
    await this.authz.require(ctx, M13_PERMISSIONS.taskRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listTasks(tx, caseId));
  }

  // --- issues -----------------------------------------------------------------------------------
  async addIssue(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: {
      issueCode?: string | null;
      category?: string | null;
      description: string;
      severity?: string | null;
      affectedParty?: string | null;
      respondent?: string | null;
      ruleReference?: string | null;
      mandatory?: boolean;
    },
  ): Promise<IssueRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.investigationManage);
    if (input.description.trim() === '' || input.description.length > CASE_LIMITS.maxAllegationChars)
      throw badRequest('an issue description is required and must be bounded', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireCase(tx, caseId, ctx.correlationId);
      const i = await this.repo.insertIssue(tx, {
        tenantId: ctx.tenantId,
        caseId,
        issueCode: input.issueCode ?? null,
        category: input.category ?? null,
        description: input.description,
        severity: input.severity ?? null,
        affectedParty: input.affectedParty ?? null,
        respondent: input.respondent ?? null,
        ruleReference: input.ruleReference ?? null,
        mandatory: input.mandatory === true,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.issueAdded,
        entityType: 'case_issue',
        entityId: i.id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'IssueCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId },
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
      finding?: string | null;
      outcome?: string | null;
      remediation?: string | null;
      resolved?: boolean;
    },
  ): Promise<IssueRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.investigationManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.patchIssue(tx, {
        id: issueId,
        expectedVersion: input.expectedVersion,
        finding: input.finding ?? null,
        outcome: input.outcome ?? null,
        remediation: input.remediation ?? null,
        resolved: input.resolved ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Issue modified concurrently (stale version).', ctx.correlationId);
      return upd;
    });
  }
  async listIssues(ctx: RequestContext, caseId: string): Promise<IssueRow[]> {
    await this.authz.require(ctx, M13_PERMISSIONS.investigationRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listIssues(tx, caseId));
  }

  // --- investigation + findings -----------------------------------------------------------------
  async startInvestigation(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: {
      plan?: string | null;
      allegation?: string | null;
      scope?: string | null;
      investigator?: string | null;
      targetCompletionAt?: string | null;
    },
  ): Promise<InvestigationRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.investigationManage);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireCase(tx, caseId, ctx.correlationId);
      const inv = await this.repo.upsertInvestigation(tx, {
        tenantId: ctx.tenantId,
        caseId,
        plan: input.plan ?? null,
        allegation: input.allegation ?? null,
        scope: input.scope ?? null,
        investigator: input.investigator ?? null,
        targetCompletionAt: input.targetCompletionAt ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.investigationStarted,
        entityType: 'case_investigation',
        entityId: inv.id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'InvestigationStarted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId },
      });
      return inv;
    });
  }
  async completeInvestigation(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: {
      expectedVersion: number;
      substantiation?: string | null;
      contributingFactors?: string | null;
      rootCause?: string | null;
      recommendedAction?: string | null;
      managementReview?: string | null;
    },
  ): Promise<InvestigationRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.investigationManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.completeInvestigation(tx, {
        caseId,
        expectedVersion: input.expectedVersion,
        substantiation: input.substantiation ?? null,
        contributingFactors: input.contributingFactors ?? null,
        rootCause: input.rootCause ?? null,
        recommendedAction: input.recommendedAction ?? null,
        managementReview: input.managementReview ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Investigation already complete or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.investigationCompleted,
        entityType: 'case_investigation',
        entityId: upd.id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'InvestigationCompleted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId },
      });
      return upd;
    });
  }
  async getInvestigation(ctx: RequestContext, caseId: string): Promise<InvestigationRow | null> {
    await this.authz.require(ctx, M13_PERMISSIONS.investigationRead);
    return this.db.withTenant(ctx, (tx) => this.repo.findInvestigation(tx, caseId));
  }
  async recordFinding(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: {
      issueId?: string | null;
      findingType: string;
      summary?: string | null;
      evidenceConsidered?: string | null;
      substantiation?: string | null;
      basisReference?: string | null;
      investigator?: string | null;
      reviewer?: string | null;
      reviewStatus?: string | null;
      confidentiality?: string;
      recommendedAction?: string | null;
    },
  ): Promise<FindingRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.findingManage);
    if (!isFindingType(input.findingType)) throw badRequest('invalid finding type', ctx.correlationId);
    const conf = input.confidentiality ?? 'standard';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireCase(tx, caseId, ctx.correlationId);
      const f = await this.repo.insertFinding(tx, {
        tenantId: ctx.tenantId,
        caseId,
        issueId: input.issueId ?? null,
        findingType: input.findingType,
        summary: input.summary ?? null,
        evidenceConsidered: input.evidenceConsidered ?? null,
        substantiation: input.substantiation ?? null,
        basisReference: input.basisReference ?? null,
        investigator: input.investigator ?? null,
        reviewer: input.reviewer ?? null,
        reviewStatus: input.reviewStatus ?? null,
        confidentiality: conf,
        recommendedAction: input.recommendedAction ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.findingRecorded,
        entityType: 'case_finding',
        entityId: f.id,
        detail: { findingType: input.findingType },
      });
      await this.emitter.publish(tx, {
        type: 'FindingRecorded',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId },
      });
      return f;
    });
  }
  async listFindings(ctx: RequestContext, caseId: string): Promise<FindingRow[]> {
    await this.authz.require(ctx, M13_PERMISSIONS.findingRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listFindings(tx, caseId));
  }

  // --- documents + evidence (references to m09; bytes never here) --------------------------------
  async linkDocument(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: {
      documentRef: string;
      documentRole?: string | null;
      evidenceCategory?: string | null;
      filingDate?: string | null;
      receivedDate?: string | null;
      servedDate?: string | null;
      confidentiality?: string;
      privileged?: boolean;
      source?: string | null;
      relatedActivity?: string | null;
      relatedHearing?: string | null;
      exhibitReference?: string | null;
    },
  ): Promise<DocumentRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.documentLink);
    const conf = input.confidentiality ?? 'standard';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireCase(tx, caseId, ctx.correlationId);
      const d = await this.repo.insertDocument(tx, {
        tenantId: ctx.tenantId,
        caseId,
        documentRef: input.documentRef,
        documentRole: input.documentRole ?? null,
        evidenceCategory: input.evidenceCategory ?? null,
        filingDate: input.filingDate ?? null,
        receivedDate: input.receivedDate ?? null,
        servedDate: input.servedDate ?? null,
        confidentiality: conf,
        privileged: input.privileged === true,
        source: input.source ?? null,
        relatedActivity: input.relatedActivity ?? null,
        relatedHearing: input.relatedHearing ?? null,
        exhibitReference: input.exhibitReference ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.documentLinked,
        entityType: 'case_document',
        entityId: d.id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'DocumentLinked',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId },
      });
      return d;
    });
  }
  async listDocuments(ctx: RequestContext, caseId: string): Promise<DocumentRow[]> {
    await this.authz.require(ctx, M13_PERMISSIONS.documentRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listDocuments(tx, caseId));
  }
  async registerEvidence(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: {
      documentRef?: string | null;
      evidenceType: string;
      description?: string | null;
      source?: string | null;
      custodian?: string | null;
      collectedBy?: string | null;
      collectedAt?: string | null;
      integrityHash?: string | null;
      confidentiality?: string;
      privileged?: boolean;
      relatedIssue?: string | null;
    },
  ): Promise<EvidenceRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.evidenceManage);
    if (!isEvidenceType(input.evidenceType)) throw badRequest('invalid evidence type', ctx.correlationId);
    const conf = input.confidentiality ?? 'standard';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireCase(tx, caseId, ctx.correlationId);
      const e = await this.repo.insertEvidence(tx, {
        tenantId: ctx.tenantId,
        caseId,
        documentRef: input.documentRef ?? null,
        evidenceType: input.evidenceType,
        description: input.description ?? null,
        source: input.source ?? null,
        custodian: input.custodian ?? null,
        collectedBy: input.collectedBy ?? null,
        collectedAt: input.collectedAt ?? null,
        integrityHash: input.integrityHash ?? null,
        confidentiality: conf,
        privileged: input.privileged === true,
        relatedIssue: input.relatedIssue ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.evidenceRegistered,
        entityType: 'case_evidence',
        entityId: e.id,
        detail: { evidenceType: input.evidenceType },
      });
      await this.emitter.publish(tx, {
        type: 'EvidenceRegistered',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId },
      });
      return e;
    });
  }
  async verifyEvidence(
    ctx: RequestContext,
    actor: string | null,
    evidenceId: string,
    input: { authenticityStatus: string; admissibilityStatus?: string | null },
  ): Promise<EvidenceRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.evidenceVerify);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.verifyEvidence(tx, {
        id: evidenceId,
        authenticityStatus: input.authenticityStatus,
        admissibilityStatus: input.admissibilityStatus ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Evidence already verified or not found.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.evidenceVerified,
        entityType: 'case_evidence',
        entityId: evidenceId,
        detail: {},
      });
      return upd;
    });
  }
  async listEvidence(ctx: RequestContext, caseId: string): Promise<EvidenceRow[]> {
    await this.authz.require(ctx, M13_PERMISSIONS.evidenceRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listEvidence(tx, caseId));
  }

  // --- deadlines (deterministic) ----------------------------------------------------------------
  async addDeadline(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: {
      deadlineType: string;
      rule: DeadlineRule;
      startAt?: string | null;
      source?: string | null;
      authority?: string | null;
      linkedActivity?: string | null;
      linkedTask?: string | null;
    },
  ): Promise<DeadlineRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.deadlineManage);
    if (!isDeadlineType(input.deadlineType)) throw badRequest('invalid deadline type', ctx.correlationId);
    const startMs = input.startAt != null ? Date.parse(input.startAt) : this.clock.now();
    const dueMs = computeDeadlineDueMs({ type: input.deadlineType, startMs, rule: input.rule });
    if (!isLimitationSafe(input.deadlineType, dueMs, this.clock.now()))
      throw badRequest('a limitation deadline cannot be in the past', ctx.correlationId);
    const iso = (ms: number): string => new Date(ms).toISOString();
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireCase(tx, caseId, ctx.correlationId);
      const d = await this.repo.insertDeadline(tx, {
        tenantId: ctx.tenantId,
        caseId,
        deadlineType: input.deadlineType,
        startAt: iso(startMs),
        dueAt: iso(dueMs),
        calculationRule: input.rule.kind,
        source: input.source ?? null,
        authority: input.authority ?? null,
        linkedActivity: input.linkedActivity ?? null,
        linkedTask: input.linkedTask ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.deadlineCreated,
        entityType: 'case_deadline',
        entityId: d.id,
        detail: { deadlineType: input.deadlineType },
      });
      await this.emitter.publish(tx, {
        type: 'DeadlineCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId, dueAt: iso(dueMs) },
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
    await this.authz.require(ctx, M13_PERMISSIONS.deadlineManage);
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
        code: M13_AUDIT_CODES.deadlineExtended,
        entityType: 'case_deadline',
        entityId: deadlineId,
        reason: input.reason ?? '',
        detail: {},
      });
      return upd;
    });
  }
  /** Evaluate a deadline against the clock; mark + publish breach deterministically. */
  async evaluateDeadline(
    ctx: RequestContext,
    actor: string | null,
    deadlineId: string,
  ): Promise<{ breached: boolean }> {
    await this.authz.require(ctx, M13_PERMISSIONS.deadlineManage);
    return this.db.withTenant(ctx, async (tx) => {
      const d = await this.repo.findDeadline(tx, deadlineId);
      if (d === null) throw ProblemError.notFound('Deadline not found.', ctx.correlationId);
      if (d.status !== 'open' && d.status !== 'extended') return { breached: d.status === 'breached' };
      if (this.clock.now() <= Date.parse(d.due_at)) return { breached: false };
      const upd = await this.repo.markDeadlineBreach(tx, deadlineId);
      if (upd === null) return { breached: true };
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.deadlineBreached,
        entityType: 'case_deadline',
        entityId: deadlineId,
        detail: { deadlineType: d.deadline_type },
      });
      await this.emitter.publish(tx, {
        type: 'DeadlineBreached',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId: d.case_id, reasonCode: d.deadline_type },
      });
      return { breached: true };
    });
  }
  async listDeadlines(ctx: RequestContext, caseId: string): Promise<DeadlineRow[]> {
    await this.authz.require(ctx, M13_PERMISSIONS.deadlineRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listDeadlines(tx, caseId));
  }

  // --- hearings ---------------------------------------------------------------------------------
  async scheduleHearing(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: {
      hearingType: string;
      title?: string | null;
      scheduledAt?: string | null;
      venue?: string | null;
      virtualLinkRef?: string | null;
      court?: string | null;
      presidingRef?: string | null;
      attendanceRequirement?: string | null;
      documentRefs?: unknown;
    },
  ): Promise<HearingRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.hearingManage);
    if (!isHearingType(input.hearingType)) throw badRequest('invalid hearing type', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireCase(tx, caseId, ctx.correlationId);
      const h = await this.repo.insertHearing(tx, {
        tenantId: ctx.tenantId,
        caseId,
        hearingType: input.hearingType,
        title: input.title ?? null,
        scheduledAt: input.scheduledAt ?? null,
        venue: input.venue ?? null,
        virtualLinkRef: input.virtualLinkRef ?? null,
        court: input.court ?? null,
        presidingRef: input.presidingRef ?? null,
        attendanceRequirement: input.attendanceRequirement ?? null,
        documentRefs: input.documentRefs ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.hearingScheduled,
        entityType: 'case_hearing',
        entityId: h.id,
        detail: { hearingType: input.hearingType },
      });
      await this.emitter.publish(tx, {
        type: 'HearingScheduled',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId, ...(input.scheduledAt != null ? { dueAt: input.scheduledAt } : {}) },
      });
      return h;
    });
  }
  async updateHearing(
    ctx: RequestContext,
    actor: string | null,
    hearingId: string,
    input: {
      expectedVersion: number;
      scheduledAt?: string | null;
      status?: string | null;
      adjournmentReason?: string | null;
      nextAt?: string | null;
    },
  ): Promise<HearingRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.hearingManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateHearing(tx, {
        id: hearingId,
        expectedVersion: input.expectedVersion,
        scheduledAt: input.scheduledAt ?? null,
        status: input.status ?? null,
        adjournmentReason: input.adjournmentReason ?? null,
        nextAt: input.nextAt ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Hearing modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.hearingUpdated,
        entityType: 'case_hearing',
        entityId: hearingId,
        detail: {},
      });
      return upd;
    });
  }
  async completeHearing(
    ctx: RequestContext,
    actor: string | null,
    hearingId: string,
    input: {
      expectedVersion: number;
      outcome?: string | null;
      nextAction?: string | null;
      nextAt?: string | null;
    },
  ): Promise<HearingRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.hearingManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.completeHearing(tx, {
        id: hearingId,
        expectedVersion: input.expectedVersion,
        outcome: input.outcome ?? null,
        nextAction: input.nextAction ?? null,
        nextAt: input.nextAt ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Hearing already complete or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.hearingCompleted,
        entityType: 'case_hearing',
        entityId: hearingId,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'HearingCompleted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId: upd.case_id },
      });
      return upd;
    });
  }
  async listHearings(ctx: RequestContext, caseId: string): Promise<HearingRow[]> {
    await this.authz.require(ctx, M13_PERMISSIONS.hearingRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listHearings(tx, caseId));
  }

  // --- notes ------------------------------------------------------------------------------------
  async addNote(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: {
      noteType?: string;
      headline?: string | null;
      content: string;
      confidentiality?: string;
      relatedActivity?: string | null;
      relatedIssue?: string | null;
      relatedDocument?: string | null;
    },
  ): Promise<NoteRow> {
    const noteType = input.noteType ?? 'general';
    if (!isNoteType(noteType)) throw badRequest('invalid note type', ctx.correlationId);
    const restricted = isRestrictedNote(noteType);
    await this.authz.require(
      ctx,
      restricted ? M13_PERMISSIONS.privilegedNotesCreate : M13_PERMISSIONS.activityCreate,
    );
    if (input.content.trim() === '' || input.content.length > CASE_LIMITS.maxNoteChars)
      throw badRequest('note content is required and must be bounded', ctx.correlationId);
    const conf = input.confidentiality ?? (restricted ? 'privileged' : 'standard');
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireCase(tx, caseId, ctx.correlationId);
      const n = await this.repo.insertNote(tx, {
        tenantId: ctx.tenantId,
        caseId,
        noteType,
        headline: input.headline ?? null,
        content: input.content,
        author: actor,
        confidentiality: conf,
        privileged: restricted,
        relatedActivity: input.relatedActivity ?? null,
        relatedIssue: input.relatedIssue ?? null,
        relatedDocument: input.relatedDocument ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      // Note CONTENT never enters the event/audit payload (ADR-060).
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.noteCreated,
        entityType: 'case_note',
        entityId: n.id,
        detail: { noteType, restricted },
      });
      return n;
    });
  }
  async listNotes(
    ctx: RequestContext,
    caseId: string,
  ): Promise<{ notes: NoteRow[]; canReadPrivileged: boolean }> {
    await this.authz.require(ctx, M13_PERMISSIONS.activityRead);
    const canReadPrivileged = await this.authz.can(ctx, M13_PERMISSIONS.privilegedNotesRead);
    const all = await this.db.withTenant(ctx, (tx) => this.repo.listNotes(tx, caseId));
    const notes = canReadPrivileged ? all : all.filter((n) => !n.privileged);
    if (canReadPrivileged && all.some((n) => n.privileged)) {
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M13_AUDIT_CODES.privilegedAccessed,
          entityType: 'case_note',
          entityId: caseId,
          detail: {},
        }),
      );
    }
    return { notes, canReadPrivileged };
  }
}
