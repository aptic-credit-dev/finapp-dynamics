import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { FeedbackService, M12_AUDIT_CODES, M12_PERMISSIONS } from '@finapp/m12-feedback';
import { ActorContextFactory } from '@finapp/m02-identity';
import {
  optionalLimit,
  optionalOffset,
  requireString,
  requireTenantScope,
  requireVersion,
} from '../identity/http.ts';
import { feedbackView, queueView, attemptView, activityView, resolutionView } from './views.ts';

/**
 * Feedback ingestion, queue, and the record lifecycle, under `/api/v1/feedback`. Idempotency by the
 * `idempotency-key` header. Views redact customer contact + confidential responses. Permission enforced in
 * FeedbackService.
 */
interface IngestBody {
  sourceSystem?: unknown;
  externalTransactionId?: unknown;
  transactionType?: unknown;
  product?: unknown;
  branch?: unknown;
  department?: unknown;
  customerRef?: unknown;
  payloadHash?: unknown;
}
interface CreateBody {
  sourceTransactionId?: unknown;
  customerRef?: unknown;
  customerContact?: unknown;
  product?: unknown;
  branch?: unknown;
  department?: unknown;
  channel?: unknown;
  feedbackType?: unknown;
  narrative?: unknown;
}
interface CaptureBody {
  expectedVersion?: unknown;
  questionnaireCode?: unknown;
  answers?: unknown;
  rating?: unknown;
  ratingScale?: unknown;
  narrative?: unknown;
  channel?: unknown;
  feedbackType?: unknown;
}
interface ClassifyBody {
  expectedVersion?: unknown;
  sentiment?: unknown;
  category?: unknown;
  subcategory?: unknown;
  severity?: unknown;
  ruleEvaluationId?: unknown;
}
interface AssignBody {
  expectedVersion?: unknown;
  owner?: unknown;
  kind?: unknown;
  reason?: unknown;
}
interface ActivityBody {
  activityType?: unknown;
  headline?: unknown;
  description?: unknown;
  mandatory?: unknown;
  confidentiality?: unknown;
}
interface ResolutionBody {
  summary?: unknown;
  resolutionType?: unknown;
  rootCauseCategory?: unknown;
  responseConfidential?: unknown;
  responseCustomerFacing?: unknown;
}
interface ConfirmBody {
  expectedVersion?: unknown;
  satisfied?: unknown;
  remainingConcern?: unknown;
}
interface CloseBody {
  expectedVersion?: unknown;
  waiveCustomerConfirmation?: unknown;
  notes?: unknown;
}
interface ContactBody {
  expectedVersion?: unknown;
  channel?: unknown;
  outcome?: unknown;
  reached?: unknown;
  callbackRequested?: unknown;
  notes?: unknown;
}
interface ActionBody {
  expectedVersion?: unknown;
  reason?: unknown;
  outcome?: unknown;
}

@Controller('feedback')
export class FeedbackController {
  private readonly service: FeedbackService;
  private readonly actors: ActorContextFactory;
  constructor(service: FeedbackService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M12_PERMISSIONS.sourceIngest,
    auditCode: M12_AUDIT_CODES.transactionIngested,
    description: 'Ingest a feedback-eligible source transaction.',
  })
  @Post('ingest')
  async ingest(@Body() b: IngestBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'ingest transaction (m12)');
    const idem = h['idempotency-key'];
    const r = await this.service.ingest(s.ctx, s.actor.identityId, {
      sourceSystem: requireString(b.sourceSystem, 'sourceSystem', s.correlationId),
      externalTransactionId: requireString(b.externalTransactionId, 'externalTransactionId', s.correlationId),
      transactionType: requireString(b.transactionType, 'transactionType', s.correlationId),
      product: requireString(b.product, 'product', s.correlationId),
      customerRef: requireString(b.customerRef, 'customerRef', s.correlationId),
      ...(typeof b.branch === 'string' ? { branch: b.branch } : {}),
      ...(typeof b.department === 'string' ? { department: b.department } : {}),
      ...(typeof b.payloadHash === 'string' ? { payloadHash: b.payloadHash } : {}),
      ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
    });
    return r;
  }

  @Endpoint({
    permission: M12_PERMISSIONS.queueClaim,
    auditCode: M12_AUDIT_CODES.queueClaimed,
    description: 'Claim a queue item (single-winner).',
  })
  @Post('queue/:id/claim')
  async claim(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'claim queue item (m12)');
    return queueView(await this.service.claimQueueItem(s.ctx, s.actor.identityId, id));
  }

  @Endpoint({
    permission: M12_PERMISSIONS.queueClaim,
    auditCode: M12_AUDIT_CODES.contactAttempted,
    description: 'Record a contact attempt.',
  })
  @Post('queue/:id/contact')
  async contact(@Param('id') id: string, @Body() b: ContactBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'record contact (m12)');
    return attemptView(
      await this.service.recordContact(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
        outcome: requireString(b.outcome, 'outcome', s.correlationId),
        ...(typeof b.channel === 'string' ? { channel: b.channel } : {}),
        reached: b.reached === true,
        callbackRequested: b.callbackRequested === true,
        ...(typeof b.notes === 'string' ? { notes: b.notes } : {}),
      }),
    );
  }

  @Endpoint({
    permission: M12_PERMISSIONS.recordCreate,
    auditCode: M12_AUDIT_CODES.recordCreated,
    description: 'Create a feedback record.',
  })
  @Post('records')
  async create(@Body() b: CreateBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create feedback (m12)');
    const idem = h['idempotency-key'];
    const fb = await this.service.create(s.ctx, s.actor.identityId, {
      ...(typeof b.sourceTransactionId === 'string' ? { sourceTransactionId: b.sourceTransactionId } : {}),
      ...(typeof b.customerRef === 'string' ? { customerRef: b.customerRef } : {}),
      ...(typeof b.customerContact === 'string' ? { customerContact: b.customerContact } : {}),
      ...(typeof b.product === 'string' ? { product: b.product } : {}),
      ...(typeof b.branch === 'string' ? { branch: b.branch } : {}),
      ...(typeof b.department === 'string' ? { department: b.department } : {}),
      ...(typeof b.channel === 'string' ? { channel: b.channel } : {}),
      ...(typeof b.feedbackType === 'string' ? { feedbackType: b.feedbackType } : {}),
      ...(typeof b.narrative === 'string' ? { narrative: b.narrative } : {}),
      ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
    });
    return feedbackView(fb, false);
  }

  @Endpoint({
    permission: M12_PERMISSIONS.recordCapture,
    auditCode: M12_AUDIT_CODES.recordCaptured,
    description: 'Capture feedback content (answers + rating).',
  })
  @Post('records/:id/capture')
  async capture(@Param('id') id: string, @Body() b: CaptureBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'capture feedback (m12)');
    const fb = await this.service.capture(s.ctx, s.actor.identityId, id, {
      expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
      ...(typeof b.questionnaireCode === 'string' ? { questionnaireCode: b.questionnaireCode } : {}),
      ...(typeof b.answers === 'object' && b.answers !== null
        ? { answers: b.answers as Record<string, unknown> }
        : {}),
      ...(typeof b.rating === 'number' ? { rating: b.rating } : {}),
      ...(typeof b.ratingScale === 'number' ? { ratingScale: b.ratingScale } : {}),
      ...(typeof b.narrative === 'string' ? { narrative: b.narrative } : {}),
      ...(typeof b.feedbackType === 'string' ? { feedbackType: b.feedbackType } : {}),
    });
    return feedbackView(fb, false);
  }

  @Endpoint({
    permission: M12_PERMISSIONS.recordClassify,
    auditCode: M12_AUDIT_CODES.recordClassified,
    description: 'Classify feedback (sentiment + severity).',
  })
  @Post('records/:id/classify')
  async classify(@Param('id') id: string, @Body() b: ClassifyBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'classify feedback (m12)');
    const fb = await this.service.classify(s.ctx, s.actor.identityId, id, {
      expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
      sentiment: requireString(b.sentiment, 'sentiment', s.correlationId),
      severity: requireString(b.severity, 'severity', s.correlationId),
      ...(typeof b.category === 'string' ? { category: b.category } : {}),
      ...(typeof b.subcategory === 'string' ? { subcategory: b.subcategory } : {}),
      ...(typeof b.ruleEvaluationId === 'string' ? { ruleEvaluationId: b.ruleEvaluationId } : {}),
    });
    return feedbackView(fb, false);
  }

  @Endpoint({
    permission: M12_PERMISSIONS.assignmentManage,
    auditCode: M12_AUDIT_CODES.recordAssigned,
    description: 'Assign a feedback record to an owner.',
  })
  @Post('records/:id/assign')
  async assign(@Param('id') id: string, @Body() b: AssignBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'assign feedback (m12)');
    const fb = await this.service.assign(s.ctx, s.actor.identityId, id, {
      expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
      owner: requireString(b.owner, 'owner', s.correlationId),
      ...(typeof b.kind === 'string' ? { kind: b.kind } : {}),
      ...(typeof b.reason === 'string' ? { reason: b.reason } : {}),
    });
    return feedbackView(fb, false);
  }

  @Endpoint({
    permission: M12_PERMISSIONS.activityCreate,
    auditCode: M12_AUDIT_CODES.activityCreated,
    description: 'Add an activity to a feedback record.',
  })
  @Post('records/:id/activities')
  async addActivity(@Param('id') id: string, @Body() b: ActivityBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'add activity (m12)');
    return activityView(
      await this.service.addActivity(s.ctx, s.actor.identityId, id, {
        activityType: requireString(b.activityType, 'activityType', s.correlationId),
        headline: requireString(b.headline, 'headline', s.correlationId),
        ...(typeof b.description === 'string' ? { description: b.description } : {}),
        mandatory: b.mandatory === true,
        ...(typeof b.confidentiality === 'string' ? { confidentiality: b.confidentiality } : {}),
      }),
    );
  }
  @Endpoint({
    permission: M12_PERMISSIONS.activityComplete,
    auditCode: M12_AUDIT_CODES.activityCompleted,
    description: 'Complete an activity.',
  })
  @Post('activities/:id/complete')
  async completeActivity(
    @Param('id') id: string,
    @Body() b: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'complete activity (m12)');
    return activityView(
      await this.service.completeActivity(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
        typeof b.outcome === 'string' ? b.outcome : null,
      ),
    );
  }

  @Endpoint({
    permission: M12_PERMISSIONS.resolutionSubmit,
    auditCode: M12_AUDIT_CODES.resolutionSubmitted,
    description: 'Submit a resolution.',
  })
  @Post('records/:id/resolution')
  async submitResolution(
    @Param('id') id: string,
    @Body() b: ResolutionBody,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'submit resolution (m12)');
    const res = await this.service.submitResolution(s.ctx, s.actor.identityId, id, {
      ...(typeof b.summary === 'string' ? { summary: b.summary } : {}),
      ...(typeof b.resolutionType === 'string' ? { resolutionType: b.resolutionType } : {}),
      ...(typeof b.rootCauseCategory === 'string' ? { rootCauseCategory: b.rootCauseCategory } : {}),
      ...(typeof b.responseConfidential === 'string' ? { responseConfidential: b.responseConfidential } : {}),
      ...(typeof b.responseCustomerFacing === 'string'
        ? { responseCustomerFacing: b.responseCustomerFacing }
        : {}),
    });
    return resolutionView(res, true);
  }
  @Endpoint({
    permission: M12_PERMISSIONS.resolutionApprove,
    auditCode: M12_AUDIT_CODES.resolutionApproved,
    description: 'Approve a resolution (not the submitter).',
  })
  @Post('records/:id/resolution/approve')
  async approveResolution(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'approve resolution (m12)');
    return feedbackView(await this.service.approveResolution(s.ctx, s.actor.identityId, id), false);
  }

  @Endpoint({
    permission: M12_PERMISSIONS.confirmationRecord,
    auditCode: M12_AUDIT_CODES.confirmationRecorded,
    description: 'Record customer confirmation.',
  })
  @Post('records/:id/confirmation')
  async confirm(@Param('id') id: string, @Body() b: ConfirmBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'record confirmation (m12)');
    return feedbackView(
      await this.service.recordConfirmation(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
        satisfied: b.satisfied === true,
      }),
      false,
    );
  }

  @Endpoint({
    permission: M12_PERMISSIONS.recordClose,
    auditCode: M12_AUDIT_CODES.recordClosed,
    description: 'Close a feedback record (rule-gated).',
  })
  @Post('records/:id/close')
  async close(@Param('id') id: string, @Body() b: CloseBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'close feedback (m12)');
    return feedbackView(
      await this.service.close(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
        waiveCustomerConfirmation: b.waiveCustomerConfirmation === true,
      }),
      false,
    );
  }
  @Endpoint({
    permission: M12_PERMISSIONS.recordReopen,
    auditCode: M12_AUDIT_CODES.recordReopened,
    description: 'Reopen a feedback record.',
  })
  @Post('records/:id/reopen')
  async reopen(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'reopen feedback (m12)');
    return feedbackView(
      await this.service.reopen(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
        reason: requireString(b.reason, 'reason', s.correlationId),
      }),
      false,
    );
  }

  @Endpoint({
    permission: M12_PERMISSIONS.recordUpdate,
    auditCode: M12_AUDIT_CODES.positiveRecognized,
    description: 'Recognize positive feedback.',
  })
  @Post('records/:id/recognize')
  async recognize(
    @Param('id') id: string,
    @Body() b: { staff?: unknown; consentForTestimonial?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'recognize positive feedback (m12)');
    await this.service.recognizePositive(s.ctx, s.actor.identityId, id, {
      ...(typeof b.staff === 'string' ? { staff: b.staff } : {}),
      consentForTestimonial: b.consentForTestimonial === true,
    });
    return { ok: true };
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('records/:id')
  async get(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get feedback (m12)');
    const { feedback, canReadContact } = await this.service.get(s.ctx, id);
    return feedbackView(feedback, canReadContact);
  }
  @Get('records/:id/activities')
  async listActivities(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list activities (m12)');
    return { activities: (await this.service.listActivities(s.ctx, id)).map(activityView) };
  }
  @Get('records/:id/resolution')
  async getResolution(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get resolution (m12)');
    const { resolution, canReadConfidential } = await this.service.getResolution(s.ctx, id);
    return { resolution: resolution === null ? null : resolutionView(resolution, canReadConfidential) };
  }
  @Get('records')
  async search(
    @Headers() h: Record<string, string>,
    @Query('product') product?: string,
    @Query('status') status?: string,
    @Query('sentiment') sentiment?: string,
    @Query('severity') severity?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const s = await this.scoped(h, 'search feedback (m12)');
    const rows = await this.service.search(s.ctx, {
      ...(typeof product === 'string' ? { product } : {}),
      ...(typeof status === 'string' ? { status } : {}),
      ...(typeof sentiment === 'string' ? { sentiment } : {}),
      ...(typeof severity === 'string' ? { severity } : {}),
      limit: optionalLimit(limit, s.correlationId).limit ?? 50,
      offset: optionalOffset(offset, s.correlationId).offset ?? 0,
    });
    return { records: rows.map((r) => feedbackView(r, false)) };
  }
  @Get('analytics')
  async analytics(@Headers() h: Record<string, string>, @Query('dimension') dimension?: string) {
    const s = await this.scoped(h, 'feedback analytics (m12)');
    const dims = ['product', 'branch', 'department', 'sentiment', 'severity', 'category', 'status'];
    const dim =
      typeof dimension === 'string' && dims.includes(dimension) ? (dimension as 'product') : 'sentiment';
    return { dimension: dim, buckets: await this.service.analytics(s.ctx, dim) };
  }
}
