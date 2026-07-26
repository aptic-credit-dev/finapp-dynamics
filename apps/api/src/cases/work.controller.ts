import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CaseWorkService, M13_AUDIT_CODES, M13_PERMISSIONS, type DeadlineRule } from '@finapp/m13-case';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import {
  partyView,
  activityView,
  taskView,
  issueView,
  investigationView,
  findingView,
  documentView,
  evidenceView,
  deadlineView,
  hearingView,
  noteView,
} from './views.ts';

/**
 * Case working entities — parties, activities (incl. correspondence), tasks, issues, investigation, findings,
 * documents, evidence, deadlines, hearings and notes, under `/api/v1/cases`. Party contacts + privileged notes
 * are redacted by the view / filtered by the service. Permission enforced in CaseWorkService (default deny).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('cases')
export class CaseWorkController {
  private readonly service: CaseWorkService;
  private readonly actors: ActorContextFactory;
  constructor(service: CaseWorkService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- parties ----------------------------------------------------------------------------------
  @Endpoint({
    permission: M13_PERMISSIONS.partyManage,
    auditCode: M13_AUDIT_CODES.partyAdded,
    description: 'Add a party to a case.',
  })
  @Post(':id/parties')
  async addParty(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add party (m13)');
    return partyView(
      await this.service.addParty(s.ctx, s.actor.identityId, id, {
        partyType: requireString(b['partyType'], 'partyType', s.correlationId),
        ...optStr(b['role'], 'role'),
        ...optStr(b['entityRef'], 'entityRef'),
        ...optStr(b['displayLabel'], 'displayLabel'),
        ...optStr(b['contactRef'], 'contactRef'),
        ...optStr(b['representation'], 'representation'),
        ...optStr(b['confidentiality'], 'confidentiality'),
        ...optStr(b['relationship'], 'relationship'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M13_PERMISSIONS.partyManage,
    auditCode: M13_AUDIT_CODES.partyRemoved,
    description: 'Remove (deactivate) a party.',
  })
  @Post('parties/:pid/remove')
  async removeParty(
    @Param('pid') pid: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'remove party (m13)');
    return partyView(
      await this.service.removeParty(
        s.ctx,
        s.actor.identityId,
        pid,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
      true,
    );
  }
  @Get(':id/parties')
  async listParties(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list parties (m13)');
    const { parties, canReadContact } = await this.service.listParties(s.ctx, id);
    return { parties: parties.map((p) => partyView(p, canReadContact)) };
  }

  // --- activities -------------------------------------------------------------------------------
  @Endpoint({
    permission: M13_PERMISSIONS.activityCreate,
    auditCode: M13_AUDIT_CODES.activityCreated,
    description: 'Add an activity to a case.',
  })
  @Post(':id/activities')
  async addActivity(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add activity (m13)');
    return activityView(
      await this.service.addActivity(s.ctx, s.actor.identityId, id, {
        activityType: requireString(b['activityType'], 'activityType', s.correlationId),
        headline: requireString(b['headline'], 'headline', s.correlationId),
        ...optStr(b['description'], 'description'),
        ...optStr(b['occurredAt'], 'occurredAt'),
        ...optStr(b['dueAt'], 'dueAt'),
        ...optStr(b['direction'], 'direction'),
        ...optStr(b['confidentiality'], 'confidentiality'),
        ...(b['documentRefs'] !== undefined ? { documentRefs: b['documentRefs'] } : {}),
        responseRequired: b['responseRequired'] === true,
        correspondence: b['correspondence'] === true,
      }),
    );
  }
  @Endpoint({
    permission: M13_PERMISSIONS.activityComplete,
    auditCode: M13_AUDIT_CODES.activityCompleted,
    description: 'Complete an activity.',
  })
  @Post('activities/:aid/complete')
  async completeActivity(
    @Param('aid') aid: string,
    @Body() b: { expectedVersion?: unknown; outcome?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'complete activity (m13)');
    return activityView(
      await this.service.completeActivity(
        s.ctx,
        s.actor.identityId,
        aid,
        requireVersion(b.expectedVersion, s.correlationId),
        typeof b.outcome === 'string' ? b.outcome : null,
      ),
    );
  }
  @Get(':id/activities')
  async listActivities(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list activities (m13)');
    return { activities: (await this.service.listActivities(s.ctx, id)).map(activityView) };
  }

  // --- tasks ------------------------------------------------------------------------------------
  @Endpoint({
    permission: M13_PERMISSIONS.taskManage,
    auditCode: M13_AUDIT_CODES.taskCreated,
    description: 'Add a task to a case.',
  })
  @Post(':id/tasks')
  async addTask(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add task (m13)');
    return taskView(
      await this.service.addTask(s.ctx, s.actor.identityId, id, {
        taskType: requireString(b['taskType'], 'taskType', s.correlationId),
        headline: requireString(b['headline'], 'headline', s.correlationId),
        ...optStr(b['description'], 'description'),
        ...optStr(b['owner'], 'owner'),
        ...optStr(b['team'], 'team'),
        ...optStr(b['dueAt'], 'dueAt'),
        ...optStr(b['priority'], 'priority'),
        mandatory: b['mandatory'] === true,
        ...optStr(b['workflowTaskRef'], 'workflowTaskRef'),
      }),
    );
  }
  @Endpoint({
    permission: M13_PERMISSIONS.taskManage,
    auditCode: M13_AUDIT_CODES.taskCompleted,
    description: 'Complete a task.',
  })
  @Post('tasks/:tid/complete')
  async completeTask(
    @Param('tid') tid: string,
    @Body() b: { expectedVersion?: unknown; outcome?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'complete task (m13)');
    return taskView(
      await this.service.completeTask(
        s.ctx,
        s.actor.identityId,
        tid,
        requireVersion(b.expectedVersion, s.correlationId),
        typeof b.outcome === 'string' ? b.outcome : null,
      ),
    );
  }
  @Get(':id/tasks')
  async listTasks(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list tasks (m13)');
    return { tasks: (await this.service.listTasks(s.ctx, id)).map(taskView) };
  }

  // --- issues -----------------------------------------------------------------------------------
  @Endpoint({
    permission: M13_PERMISSIONS.investigationManage,
    auditCode: M13_AUDIT_CODES.issueAdded,
    description: 'Add an issue/allegation.',
  })
  @Post(':id/issues')
  async addIssue(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add issue (m13)');
    return issueView(
      await this.service.addIssue(s.ctx, s.actor.identityId, id, {
        description: requireString(b['description'], 'description', s.correlationId),
        ...optStr(b['issueCode'], 'issueCode'),
        ...optStr(b['category'], 'category'),
        ...optStr(b['severity'], 'severity'),
        ...optStr(b['ruleReference'], 'ruleReference'),
        mandatory: b['mandatory'] === true,
      }),
    );
  }
  @Endpoint({
    permission: M13_PERMISSIONS.investigationManage,
    auditCode: M13_AUDIT_CODES.findingRecorded,
    description: 'Update an issue finding/outcome.',
  })
  @Post('issues/:iid')
  async patchIssue(
    @Param('iid') iid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'patch issue (m13)');
    return issueView(
      await this.service.patchIssue(s.ctx, s.actor.identityId, iid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['finding'], 'finding'),
        ...optStr(b['outcome'], 'outcome'),
        ...optStr(b['remediation'], 'remediation'),
        resolved: b['resolved'] === true,
      }),
    );
  }
  @Get(':id/issues')
  async listIssues(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list issues (m13)');
    return { issues: (await this.service.listIssues(s.ctx, id)).map(issueView) };
  }

  // --- investigation + findings -----------------------------------------------------------------
  @Endpoint({
    permission: M13_PERMISSIONS.investigationManage,
    auditCode: M13_AUDIT_CODES.investigationStarted,
    description: 'Start an investigation.',
  })
  @Post(':id/investigation')
  async startInvestigation(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'start investigation (m13)');
    return investigationView(
      await this.service.startInvestigation(s.ctx, s.actor.identityId, id, {
        ...optStr(b['plan'], 'plan'),
        ...optStr(b['allegation'], 'allegation'),
        ...optStr(b['scope'], 'scope'),
        ...optStr(b['investigator'], 'investigator'),
        ...optStr(b['targetCompletionAt'], 'targetCompletionAt'),
      }),
    );
  }
  @Endpoint({
    permission: M13_PERMISSIONS.investigationManage,
    auditCode: M13_AUDIT_CODES.investigationCompleted,
    description: 'Complete an investigation.',
  })
  @Post(':id/investigation/complete')
  async completeInvestigation(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'complete investigation (m13)');
    return investigationView(
      await this.service.completeInvestigation(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['substantiation'], 'substantiation'),
        ...optStr(b['rootCause'], 'rootCause'),
        ...optStr(b['recommendedAction'], 'recommendedAction'),
        ...optStr(b['managementReview'], 'managementReview'),
      }),
    );
  }
  @Get(':id/investigation')
  async getInvestigation(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get investigation (m13)');
    const inv = await this.service.getInvestigation(s.ctx, id);
    return { investigation: inv === null ? null : investigationView(inv) };
  }
  @Endpoint({
    permission: M13_PERMISSIONS.findingManage,
    auditCode: M13_AUDIT_CODES.findingRecorded,
    description: 'Record a finding.',
  })
  @Post(':id/findings')
  async recordFinding(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record finding (m13)');
    return findingView(
      await this.service.recordFinding(s.ctx, s.actor.identityId, id, {
        findingType: requireString(b['findingType'], 'findingType', s.correlationId),
        ...optStr(b['issueId'], 'issueId'),
        ...optStr(b['summary'], 'summary'),
        ...optStr(b['substantiation'], 'substantiation'),
        ...optStr(b['basisReference'], 'basisReference'),
        ...optStr(b['reviewStatus'], 'reviewStatus'),
        ...optStr(b['confidentiality'], 'confidentiality'),
        ...optStr(b['recommendedAction'], 'recommendedAction'),
      }),
    );
  }
  @Get(':id/findings')
  async listFindings(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list findings (m13)');
    return { findings: (await this.service.listFindings(s.ctx, id)).map(findingView) };
  }

  // --- documents + evidence ---------------------------------------------------------------------
  @Endpoint({
    permission: M13_PERMISSIONS.documentLink,
    auditCode: M13_AUDIT_CODES.documentLinked,
    description: 'Link an m09 document to a case.',
  })
  @Post(':id/documents')
  async linkDocument(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'link document (m13)');
    return documentView(
      await this.service.linkDocument(s.ctx, s.actor.identityId, id, {
        documentRef: requireString(b['documentRef'], 'documentRef', s.correlationId),
        ...optStr(b['documentRole'], 'documentRole'),
        ...optStr(b['evidenceCategory'], 'evidenceCategory'),
        ...optStr(b['confidentiality'], 'confidentiality'),
        privileged: b['privileged'] === true,
        ...optStr(b['exhibitReference'], 'exhibitReference'),
      }),
    );
  }
  @Get(':id/documents')
  async listDocuments(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list documents (m13)');
    return { documents: (await this.service.listDocuments(s.ctx, id)).map(documentView) };
  }
  @Endpoint({
    permission: M13_PERMISSIONS.evidenceManage,
    auditCode: M13_AUDIT_CODES.evidenceRegistered,
    description: 'Register evidence.',
  })
  @Post(':id/evidence')
  async registerEvidence(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'register evidence (m13)');
    return evidenceView(
      await this.service.registerEvidence(s.ctx, s.actor.identityId, id, {
        evidenceType: requireString(b['evidenceType'], 'evidenceType', s.correlationId),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['description'], 'description'),
        ...optStr(b['source'], 'source'),
        ...optStr(b['custodian'], 'custodian'),
        ...optStr(b['integrityHash'], 'integrityHash'),
        ...optStr(b['confidentiality'], 'confidentiality'),
        privileged: b['privileged'] === true,
      }),
    );
  }
  @Endpoint({
    permission: M13_PERMISSIONS.evidenceVerify,
    auditCode: M13_AUDIT_CODES.evidenceVerified,
    description: 'Verify evidence.',
  })
  @Post('evidence/:eid/verify')
  async verifyEvidence(
    @Param('eid') eid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'verify evidence (m13)');
    return evidenceView(
      await this.service.verifyEvidence(s.ctx, s.actor.identityId, eid, {
        authenticityStatus: requireString(b['authenticityStatus'], 'authenticityStatus', s.correlationId),
        ...optStr(b['admissibilityStatus'], 'admissibilityStatus'),
      }),
    );
  }
  @Get(':id/evidence')
  async listEvidence(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list evidence (m13)');
    return { evidence: (await this.service.listEvidence(s.ctx, id)).map(evidenceView) };
  }

  // --- deadlines --------------------------------------------------------------------------------
  @Endpoint({
    permission: M13_PERMISSIONS.deadlineManage,
    auditCode: M13_AUDIT_CODES.deadlineCreated,
    description: 'Add a deadline.',
  })
  @Post(':id/deadlines')
  async addDeadline(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add deadline (m13)');
    const rule = b['rule'] as DeadlineRule;
    return deadlineView(
      await this.service.addDeadline(s.ctx, s.actor.identityId, id, {
        deadlineType: requireString(b['deadlineType'], 'deadlineType', s.correlationId),
        rule,
        ...optStr(b['startAt'], 'startAt'),
        ...optStr(b['source'], 'source'),
        ...optStr(b['authority'], 'authority'),
      }),
    );
  }
  @Endpoint({
    permission: M13_PERMISSIONS.deadlineManage,
    auditCode: M13_AUDIT_CODES.deadlineExtended,
    description: 'Extend a deadline.',
  })
  @Post('deadlines/:did/extend')
  async extendDeadline(
    @Param('did') did: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'extend deadline (m13)');
    return deadlineView(
      await this.service.extendDeadline(s.ctx, s.actor.identityId, did, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        extensionTo: requireString(b['extensionTo'], 'extensionTo', s.correlationId),
        ...optStr(b['reason'], 'reason'),
      }),
    );
  }
  @Endpoint({
    permission: M13_PERMISSIONS.deadlineManage,
    auditCode: M13_AUDIT_CODES.deadlineBreached,
    description: 'Evaluate a deadline against the clock.',
  })
  @Post('deadlines/:did/evaluate')
  async evaluateDeadline(@Param('did') did: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'evaluate deadline (m13)');
    return this.service.evaluateDeadline(s.ctx, s.actor.identityId, did);
  }
  @Get(':id/deadlines')
  async listDeadlines(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list deadlines (m13)');
    return { deadlines: (await this.service.listDeadlines(s.ctx, id)).map(deadlineView) };
  }

  // --- hearings ---------------------------------------------------------------------------------
  @Endpoint({
    permission: M13_PERMISSIONS.hearingManage,
    auditCode: M13_AUDIT_CODES.hearingScheduled,
    description: 'Schedule a hearing.',
  })
  @Post(':id/hearings')
  async scheduleHearing(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'schedule hearing (m13)');
    return hearingView(
      await this.service.scheduleHearing(s.ctx, s.actor.identityId, id, {
        hearingType: requireString(b['hearingType'], 'hearingType', s.correlationId),
        ...optStr(b['title'], 'title'),
        ...optStr(b['scheduledAt'], 'scheduledAt'),
        ...optStr(b['venue'], 'venue'),
        ...optStr(b['court'], 'court'),
        ...optStr(b['presidingRef'], 'presidingRef'),
        ...optStr(b['attendanceRequirement'], 'attendanceRequirement'),
      }),
    );
  }
  @Endpoint({
    permission: M13_PERMISSIONS.hearingManage,
    auditCode: M13_AUDIT_CODES.hearingUpdated,
    description: 'Update a hearing.',
  })
  @Post('hearings/:hid')
  async updateHearing(
    @Param('hid') hid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update hearing (m13)');
    return hearingView(
      await this.service.updateHearing(s.ctx, s.actor.identityId, hid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['scheduledAt'], 'scheduledAt'),
        ...optStr(b['status'], 'status'),
        ...optStr(b['adjournmentReason'], 'adjournmentReason'),
        ...optStr(b['nextAt'], 'nextAt'),
      }),
    );
  }
  @Endpoint({
    permission: M13_PERMISSIONS.hearingManage,
    auditCode: M13_AUDIT_CODES.hearingCompleted,
    description: 'Complete a hearing.',
  })
  @Post('hearings/:hid/complete')
  async completeHearing(
    @Param('hid') hid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'complete hearing (m13)');
    return hearingView(
      await this.service.completeHearing(s.ctx, s.actor.identityId, hid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['outcome'], 'outcome'),
        ...optStr(b['nextAction'], 'nextAction'),
        ...optStr(b['nextAt'], 'nextAt'),
      }),
    );
  }
  @Get(':id/hearings')
  async listHearings(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list hearings (m13)');
    return { hearings: (await this.service.listHearings(s.ctx, id)).map(hearingView) };
  }

  // --- notes ------------------------------------------------------------------------------------
  @Endpoint({
    permission: M13_PERMISSIONS.activityCreate,
    auditCode: M13_AUDIT_CODES.noteCreated,
    description: 'Add a case note (privileged notes need cases.privileged_notes.create).',
  })
  @Post(':id/notes')
  async addNote(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add note (m13)');
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
  @Get(':id/notes')
  async listNotes(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list notes (m13)');
    const { notes, canReadPrivileged } = await this.service.listNotes(s.ctx, id);
    return { notes: notes.map((n) => noteView(n, canReadPrivileged)) };
  }
}
