import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { MatterWorkService, M14_AUDIT_CODES, M14_PERMISSIONS, type DeadlineRule } from '@finapp/m14-legal';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import {
  partyView,
  activityView,
  taskView,
  issueView,
  researchView,
  pleadingView,
  courtEventView,
  deadlineView,
  noteView,
} from './views.ts';

/**
 * Legal matter working entities — parties, activities (incl. correspondence), tasks, issues, research references,
 * pleadings/filings, court diary, deadlines/limitation and notes, under `/api/v1/legal`. Party contacts +
 * privileged notes are redacted/filtered. Permission enforced in MatterWorkService (default deny).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('legal')
export class LegalWorkController {
  private readonly service: MatterWorkService;
  private readonly actors: ActorContextFactory;
  constructor(service: MatterWorkService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- parties ----------------------------------------------------------------------------------
  @Endpoint({
    permission: M14_PERMISSIONS.partyManage,
    auditCode: M14_AUDIT_CODES.partyAdded,
    description: 'Add a party.',
  })
  @Post('matters/:id/parties')
  async addParty(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add party (m14)');
    return partyView(
      await this.service.addParty(s.ctx, s.actor.identityId, id, {
        partyRole: requireString(b['partyRole'], 'partyRole', s.correlationId),
        ...optStr(b['entityRef'], 'entityRef'),
        ...optStr(b['displayLabel'], 'displayLabel'),
        ...optStr(b['advocateRef'], 'advocateRef'),
        ...optStr(b['lawFirmRef'], 'lawFirmRef'),
        ...optStr(b['contactRef'], 'contactRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
        ...optStr(b['relationship'], 'relationship'),
      }),
      true,
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.partyManage,
    auditCode: M14_AUDIT_CODES.partyRemoved,
    description: 'Remove (deactivate) a party.',
  })
  @Post('parties/:pid/remove')
  async removeParty(
    @Param('pid') pid: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'remove party (m14)');
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
  @Get('matters/:id/parties')
  async listParties(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list parties (m14)');
    const { parties, canReadContact } = await this.service.listParties(s.ctx, id);
    return { parties: parties.map((p) => partyView(p, canReadContact)) };
  }

  // --- activities -------------------------------------------------------------------------------
  @Endpoint({
    permission: M14_PERMISSIONS.activityCreate,
    auditCode: M14_AUDIT_CODES.activityCreated,
    description: 'Add an activity.',
  })
  @Post('matters/:id/activities')
  async addActivity(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add activity (m14)');
    return activityView(
      await this.service.addActivity(s.ctx, s.actor.identityId, id, {
        activityType: requireString(b['activityType'], 'activityType', s.correlationId),
        headline: requireString(b['headline'], 'headline', s.correlationId),
        ...optStr(b['description'], 'description'),
        ...optStr(b['direction'], 'direction'),
        ...optStr(b['confidentiality'], 'confidentiality'),
        privileged: b['privileged'] === true,
        ...(b['documentRefs'] !== undefined ? { documentRefs: b['documentRefs'] } : {}),
        correspondence: b['correspondence'] === true,
      }),
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.activityComplete,
    auditCode: M14_AUDIT_CODES.activityCompleted,
    description: 'Complete an activity.',
  })
  @Post('activities/:aid/complete')
  async completeActivity(
    @Param('aid') aid: string,
    @Body() b: { expectedVersion?: unknown; outcome?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'complete activity (m14)');
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
  @Get('matters/:id/activities')
  async listActivities(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list activities (m14)');
    return { activities: (await this.service.listActivities(s.ctx, id)).map(activityView) };
  }

  // --- tasks ------------------------------------------------------------------------------------
  @Endpoint({
    permission: M14_PERMISSIONS.taskManage,
    auditCode: M14_AUDIT_CODES.taskCreated,
    description: 'Add a task.',
  })
  @Post('matters/:id/tasks')
  async addTask(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add task (m14)');
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
    permission: M14_PERMISSIONS.taskManage,
    auditCode: M14_AUDIT_CODES.taskCompleted,
    description: 'Complete a task.',
  })
  @Post('tasks/:tid/complete')
  async completeTask(
    @Param('tid') tid: string,
    @Body() b: { expectedVersion?: unknown; outcome?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'complete task (m14)');
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
  @Get('matters/:id/tasks')
  async listTasks(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list tasks (m14)');
    return { tasks: (await this.service.listTasks(s.ctx, id)).map(taskView) };
  }

  // --- issues -----------------------------------------------------------------------------------
  @Endpoint({
    permission: M14_PERMISSIONS.issueManage,
    auditCode: M14_AUDIT_CODES.issueCreated,
    description: 'Add a legal issue.',
  })
  @Post('matters/:id/issues')
  async addIssue(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add issue (m14)');
    return issueView(
      await this.service.addIssue(s.ctx, s.actor.identityId, id, {
        statement: requireString(b['statement'], 'statement', s.correlationId),
        ...optStr(b['issueCode'], 'issueCode'),
        ...optStr(b['category'], 'category'),
        ...optStr(b['causeOfAction'], 'causeOfAction'),
        ...optStr(b['defence'], 'defence'),
        ...optStr(b['legalBasisReference'], 'legalBasisReference'),
        ...optStr(b['risk'], 'risk'),
        mandatory: b['mandatory'] === true,
      }),
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.issueManage,
    auditCode: M14_AUDIT_CODES.issueCreated,
    description: 'Update an issue.',
  })
  @Post('issues/:iid')
  async patchIssue(
    @Param('iid') iid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'patch issue (m14)');
    return issueView(
      await this.service.patchIssue(s.ctx, s.actor.identityId, iid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['position'], 'position'),
        ...optStr(b['outcome'], 'outcome'),
        ...optStr(b['status'], 'status'),
      }),
    );
  }
  @Get('matters/:id/issues')
  async listIssues(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list issues (m14)');
    return { issues: (await this.service.listIssues(s.ctx, id)).map(issueView) };
  }

  // --- research ---------------------------------------------------------------------------------
  @Endpoint({
    permission: M14_PERMISSIONS.researchManage,
    auditCode: M14_AUDIT_CODES.researchAdded,
    description: 'Add a research reference.',
  })
  @Post('matters/:id/research')
  async addResearch(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add research (m14)');
    return researchView(
      await this.service.addResearch(s.ctx, s.actor.identityId, id, {
        referenceType: requireString(b['referenceType'], 'referenceType', s.correlationId),
        ...optStr(b['citation'], 'citation'),
        ...optStr(b['title'], 'title'),
        ...optStr(b['jurisdiction'], 'jurisdiction'),
        ...optStr(b['source'], 'source'),
        ...optStr(b['relevanceSummary'], 'relevanceSummary'),
        ...optStr(b['documentRef'], 'documentRef'),
      }),
    );
  }
  @Get('matters/:id/research')
  async listResearch(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list research (m14)');
    return { research: (await this.service.listResearch(s.ctx, id)).map(researchView) };
  }

  // --- pleadings + documents --------------------------------------------------------------------
  @Endpoint({
    permission: M14_PERMISSIONS.pleadingManage,
    auditCode: M14_AUDIT_CODES.pleadingRegistered,
    description: 'Register a pleading.',
  })
  @Post('matters/:id/pleadings')
  async registerPleading(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'register pleading (m14)');
    return pleadingView(
      await this.service.registerPleading(s.ctx, s.actor.identityId, id, {
        documentRole: requireString(b['documentRole'], 'documentRole', s.correlationId),
        ...optStr(b['documentRef'], 'documentRef'),
        ...optStr(b['confidentiality'], 'confidentiality'),
        privileged: b['privileged'] === true,
      }),
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.pleadingManage,
    auditCode: M14_AUDIT_CODES.pleadingFiled,
    description: 'File a pleading.',
  })
  @Post('pleadings/:pid/file')
  async filePleading(
    @Param('pid') pid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'file pleading (m14)');
    return pleadingView(
      await this.service.filePleading(s.ctx, s.actor.identityId, pid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['courtStampReference'], 'courtStampReference'),
      }),
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.documentLink,
    auditCode: M14_AUDIT_CODES.documentLinked,
    description: 'Link an m09 document.',
  })
  @Post('matters/:id/documents')
  async linkDocument(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'link document (m14)');
    return pleadingView(
      await this.service.linkDocument(s.ctx, s.actor.identityId, id, {
        documentRef: requireString(b['documentRef'], 'documentRef', s.correlationId),
        ...optStr(b['documentRole'], 'documentRole'),
        ...optStr(b['confidentiality'], 'confidentiality'),
        privileged: b['privileged'] === true,
      }),
    );
  }
  @Get('matters/:id/pleadings')
  async listPleadings(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list pleadings (m14)');
    return { pleadings: (await this.service.listPleadings(s.ctx, id)).map(pleadingView) };
  }

  // --- court events -----------------------------------------------------------------------------
  @Endpoint({
    permission: M14_PERMISSIONS.courtEventManage,
    auditCode: M14_AUDIT_CODES.courtEventScheduled,
    description: 'Schedule a court event.',
  })
  @Post('matters/:id/court-events')
  async scheduleCourtEvent(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'schedule court event (m14)');
    return courtEventView(
      await this.service.scheduleCourtEvent(s.ctx, s.actor.identityId, id, {
        eventType: requireString(b['eventType'], 'eventType', s.correlationId),
        ...optStr(b['title'], 'title'),
        ...optStr(b['scheduledAt'], 'scheduledAt'),
        ...optStr(b['forum'], 'forum'),
        ...optStr(b['venue'], 'venue'),
        ...optStr(b['presidingRef'], 'presidingRef'),
      }),
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.courtEventManage,
    auditCode: M14_AUDIT_CODES.courtEventUpdated,
    description: 'Update a court event.',
  })
  @Post('court-events/:cid')
  async updateCourtEvent(
    @Param('cid') cid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update court event (m14)');
    return courtEventView(
      await this.service.updateCourtEvent(s.ctx, s.actor.identityId, cid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['scheduledAt'], 'scheduledAt'),
        ...optStr(b['status'], 'status'),
        ...optStr(b['adjournmentReason'], 'adjournmentReason'),
        ...optStr(b['nextAt'], 'nextAt'),
      }),
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.courtEventManage,
    auditCode: M14_AUDIT_CODES.courtEventCompleted,
    description: 'Complete a court event.',
  })
  @Post('court-events/:cid/complete')
  async completeCourtEvent(
    @Param('cid') cid: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'complete court event (m14)');
    return courtEventView(
      await this.service.completeCourtEvent(s.ctx, s.actor.identityId, cid, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['outcome'], 'outcome'),
        ...optStr(b['orderDirection'], 'orderDirection'),
        ...optStr(b['nextAction'], 'nextAction'),
        ...optStr(b['nextAt'], 'nextAt'),
      }),
    );
  }
  @Get('matters/:id/court-events')
  async listCourtEvents(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list court events (m14)');
    return { courtEvents: (await this.service.listCourtEvents(s.ctx, id)).map(courtEventView) };
  }

  // --- deadlines --------------------------------------------------------------------------------
  @Endpoint({
    permission: M14_PERMISSIONS.deadlineManage,
    auditCode: M14_AUDIT_CODES.deadlineCreated,
    description: 'Add a deadline.',
  })
  @Post('matters/:id/deadlines')
  async addDeadline(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add deadline (m14)');
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
    permission: M14_PERMISSIONS.deadlineManage,
    auditCode: M14_AUDIT_CODES.deadlineExtended,
    description: 'Extend a deadline.',
  })
  @Post('deadlines/:did/extend')
  async extendDeadline(
    @Param('did') did: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'extend deadline (m14)');
    return deadlineView(
      await this.service.extendDeadline(s.ctx, s.actor.identityId, did, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        extensionTo: requireString(b['extensionTo'], 'extensionTo', s.correlationId),
        ...optStr(b['reason'], 'reason'),
      }),
    );
  }
  @Endpoint({
    permission: M14_PERMISSIONS.deadlineManage,
    auditCode: M14_AUDIT_CODES.deadlineBreached,
    description: 'Evaluate a deadline.',
  })
  @Post('deadlines/:did/evaluate')
  async evaluateDeadline(@Param('did') did: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'evaluate deadline (m14)');
    return this.service.evaluateDeadline(s.ctx, s.actor.identityId, did);
  }
  @Get('matters/:id/deadlines')
  async listDeadlines(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list deadlines (m14)');
    return { deadlines: (await this.service.listDeadlines(s.ctx, id)).map(deadlineView) };
  }

  // --- notes ------------------------------------------------------------------------------------
  @Endpoint({
    permission: M14_PERMISSIONS.activityCreate,
    auditCode: M14_AUDIT_CODES.noteCreated,
    description: 'Add a note (privileged notes need legal.privileged.create).',
  })
  @Post('matters/:id/notes')
  async addNote(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add note (m14)');
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
  @Get('matters/:id/notes')
  async listNotes(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list notes (m14)');
    const { notes, canReadPrivileged } = await this.service.listNotes(s.ctx, id);
    return { notes: notes.map((n) => noteView(n, canReadPrivileged)) };
  }
}
