/**
 * FeedbackService — ingestion, the contact queue, and the full feedback-record lifecycle (F1-F17). Every
 * mutating method enforces its permission (default deny, the single choke point), runs inside `db.withTenant`,
 * records audit + a feedback.lifecycle outbox event in the SAME transaction, and is optimistic-lock guarded.
 * Lifecycle transitions go through the PURE `checkFeedbackTransition` choke point. Positive feedback closes after
 * a light review; negative/high-risk feedback enters controlled analysis. Customer contacts + narratives are
 * SENSITIVE — redacted on read unless the caller holds `feedback.customer_contact.read` (ADR-055).
 */
import { randomUUID } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M12_PERMISSIONS } from './permissions.ts';
import { M12_AUDIT_CODES } from './audit-codes.ts';
import { checkFeedbackTransition, isFeedbackTerminal } from './domain/lifecycles.ts';
import {
  isChannel,
  isSentiment,
  isSeverity,
  isFeedbackType,
  isPositiveType,
  FEEDBACK_LIMITS,
  type FeedbackType,
} from './domain/limits.ts';
import { validateAnswers, computeScores, type QuestionnaireSpec } from './domain/questionnaire.ts';
import { evaluateClosure, type ClosureCriteria } from './domain/closure.ts';
import {
  FeedbackRepository,
  type FeedbackRow,
  type ActivityRow,
  type ResolutionRow,
  type ContactAttemptRow,
  type QueueItemRow,
} from './repository.ts';
import type { M12Emitter } from './emit.ts';
import { badRequest } from './errors.ts';

/** Default closure criteria for negative feedback (a full impl consults an M07 rule set, ADR-053). */
const DEFAULT_CLOSURE_CRITERIA: ClosureCriteria = {
  requireCaptured: true,
  requireAssigned: true,
  requireResolution: true,
  requireCustomerInformed: true,
  requireSlaDisposition: true,
  requireNoOpenMandatoryActivity: true,
};

export class FeedbackService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M12Emitter;
  private readonly repo: FeedbackRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M12Emitter,
    repo: FeedbackRepository = new FeedbackRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  private code(prefix: string): string {
    return `${prefix}-${randomUUID().slice(0, 12)}`;
  }

  // --- ingestion --------------------------------------------------------------------------------
  async ingest(
    ctx: RequestContext,
    actor: string | null,
    input: {
      sourceSystem: string;
      externalTransactionId: string;
      transactionType: string;
      product: string;
      productCategory?: string | null;
      branch?: string | null;
      department?: string | null;
      relationshipOfficer?: string | null;
      transactionDate?: string | null;
      amountMinor?: number | null;
      currency?: string | null;
      customerRef: string;
      transactionStatus?: string | null;
      payloadHash?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<{ transactionId: string; queueItemId: string }> {
    await this.authz.require(ctx, M12_PERMISSIONS.sourceIngest);
    return this.db.withTenant(ctx, async (tx) => {
      const src = await this.repo.findSourceSystem(tx, input.sourceSystem);
      if (!src?.active) throw ProblemError.conflict('Unknown or inactive source system.', ctx.correlationId);
      const existing = await this.repo.findSourceTransactionByExternal(
        tx,
        input.sourceSystem,
        input.externalTransactionId,
      );
      if (existing !== null) {
        const q = await this.repo.listQueue(tx, { limit: 1, offset: 0 });
        return { transactionId: existing.id, queueItemId: q[0]?.id ?? '' };
      }
      const txn = await this.repo.insertSourceTransaction(tx, {
        tenantId: ctx.tenantId,
        sourceSystem: input.sourceSystem,
        externalTransactionId: input.externalTransactionId,
        transactionType: input.transactionType,
        product: input.product,
        productCategory: input.productCategory ?? null,
        branch: input.branch ?? null,
        department: input.department ?? null,
        relationshipOfficer: input.relationshipOfficer ?? null,
        transactionDate: input.transactionDate ?? null,
        amountMinor: input.amountMinor ?? null,
        currency: input.currency ?? null,
        customerRef: input.customerRef,
        transactionStatus: input.transactionStatus ?? null,
        payloadHash: input.payloadHash ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      const queue = await this.repo.insertQueueItem(tx, {
        tenantId: ctx.tenantId,
        sourceTransactionId: txn.id,
        product: input.product,
        branch: input.branch ?? null,
        department: input.department ?? null,
        priority: 'normal',
        preferredChannel: 'phone',
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.setSourceTransactionStatus(tx, txn.id, 'queued');
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.transactionIngested,
        entityType: 'feedback_source_transaction',
        entityId: txn.id,
        detail: { sourceSystem: input.sourceSystem, product: input.product },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.queueCreated,
        entityType: 'feedback_queue_item',
        entityId: queue.id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'TransactionIngested',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          sourceTransactionId: txn.id,
          sourceSystem: input.sourceSystem,
          transactionType: input.transactionType,
          product: input.product,
          status: 'queued',
        },
      });
      await this.emitter.publish(tx, {
        type: 'QueueItemCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        payload: { feedbackId: queue.id, product: input.product, toStatus: 'open' },
      });
      return { transactionId: txn.id, queueItemId: queue.id };
    });
  }

  // --- queue + contact --------------------------------------------------------------------------
  async claimQueueItem(
    ctx: RequestContext,
    actor: string | null,
    queueItemId: string,
  ): Promise<QueueItemRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.queueClaim);
    if (actor === null) throw badRequest('an actor is required to claim', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const claimed = await this.repo.claimQueueItem(tx, queueItemId, actor);
      if (claimed === null)
        throw ProblemError.conflict('Queue item is already claimed or not open.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.queueClaimed,
        entityType: 'feedback_queue_item',
        entityId: queueItemId,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'QueueItemClaimed',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor, // claimQueueItem guarantees a non-null actor above
        payload: { feedbackId: queueItemId, toStatus: 'claimed' },
      });
      return claimed;
    });
  }

  async recordContact(
    ctx: RequestContext,
    actor: string | null,
    queueItemId: string,
    input: {
      expectedVersion: number;
      channel?: string;
      outcome: string;
      reached?: boolean;
      callbackRequested?: boolean;
      nextContactAt?: string | null;
      failureCategory?: string | null;
      identityVerified?: boolean | null;
      notes?: string | null;
    },
  ): Promise<ContactAttemptRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.queueClaim);
    return this.db.withTenant(ctx, async (tx) => {
      const item = await this.repo.findQueueItem(tx, queueItemId);
      if (item === null) throw ProblemError.notFound('Queue item not found.', ctx.correlationId);
      const attemptNumber = await this.repo.nextAttemptNumber(tx, queueItemId);
      const attempt = await this.repo.insertContactAttempt(tx, {
        tenantId: ctx.tenantId,
        queueItemId,
        feedbackId: item.feedback_id,
        attemptNumber,
        officer: actor,
        channel: input.channel ?? item.priority,
        outcome: input.outcome,
        reached: input.reached === true,
        callbackRequested: input.callbackRequested === true,
        nextContactAt: input.nextContactAt ?? null,
        failureCategory: input.failureCategory ?? null,
        identityVerified: input.identityVerified ?? null,
        notes: input.notes ?? null,
        correlationId: ctx.correlationId,
      });
      await this.repo.bumpQueueAttempt(tx, queueItemId, input.expectedVersion, input.outcome);
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.contactAttempted,
        entityType: 'feedback_contact_attempt',
        entityId: attempt.id,
        detail: { attempt: attemptNumber, outcome: input.outcome },
      });
      await this.emitter.publish(tx, {
        type: 'ContactAttempted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { feedbackId: queueItemId, reasonCode: input.outcome },
      });
      return attempt;
    });
  }

  // --- feedback record --------------------------------------------------------------------------
  async create(
    ctx: RequestContext,
    actor: string | null,
    input: {
      sourceTransactionId?: string | null;
      customerRef?: string | null;
      customerContact?: string | null;
      product?: string | null;
      branch?: string | null;
      department?: string | null;
      responsibleOfficer?: string | null;
      channel?: string | null;
      feedbackType?: string;
      narrative?: string | null;
      idempotencyKey?: string | null;
      causationId?: string | null;
      originModule?: string | null;
    },
  ): Promise<FeedbackRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.recordCreate);
    const feedbackType = input.feedbackType ?? 'general';
    if (!isFeedbackType(feedbackType)) throw badRequest('invalid feedback type', ctx.correlationId);
    if (input.channel !== undefined && input.channel !== null && !isChannel(input.channel))
      throw badRequest('invalid channel', ctx.correlationId);
    if (input.narrative != null && input.narrative.length > FEEDBACK_LIMITS.maxNarrativeChars)
      throw badRequest('narrative too long', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findFeedbackByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const fb = await this.repo.insertFeedback(tx, {
        tenantId: ctx.tenantId,
        code: this.code('FB'),
        sourceTransactionId: input.sourceTransactionId ?? null,
        customerRef: input.customerRef ?? null,
        customerContact: input.customerContact ?? null,
        product: input.product ?? null,
        branch: input.branch ?? null,
        department: input.department ?? null,
        responsibleOfficer: input.responsibleOfficer ?? null,
        channel: input.channel ?? null,
        feedbackType,
        narrative: input.narrative ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        causationId: input.causationId ?? null,
        originModule: input.originModule ?? null,
        by: actor,
      });
      if (input.sourceTransactionId != null)
        await this.repo.setSourceTransactionStatus(tx, input.sourceTransactionId, 'feedback_created');
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.recordCreated,
        entityType: 'feedback_record',
        entityId: fb.id,
        detail: { code: fb.code, feedbackType },
      });
      await this.emitter.publish(tx, {
        type: 'FeedbackCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          feedbackId: fb.id,
          feedbackType,
          ...(fb.product != null ? { product: fb.product } : {}),
          toStatus: fb.status,
        },
      });
      return fb;
    });
  }

  async capture(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      questionnaireCode?: string | null;
      answers?: Readonly<Record<string, unknown>>;
      rating?: number | null;
      ratingScale?: number | null;
      narrative?: string | null;
      channel?: string | null;
      feedbackType?: string;
    },
  ): Promise<FeedbackRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.recordCapture);
    const feedbackType = (input.feedbackType ?? 'general') as FeedbackType;
    if (!isFeedbackType(feedbackType)) throw badRequest('invalid feedback type', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const fb = await this.repo.findFeedback(tx, id);
      if (fb === null) throw ProblemError.notFound('Feedback not found.', ctx.correlationId);
      const check = checkFeedbackTransition(fb.status, 'feedback_captured');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot capture from ${fb.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      let csat: number | null = null;
      let nps: number | null = null;
      let questionnaireVersion: number | null = null;
      if (input.questionnaireCode != null && input.answers !== undefined) {
        const q = await this.repo.findActiveQuestionnaire(tx, input.questionnaireCode);
        if (q === null)
          throw ProblemError.conflict('No active questionnaire for that code.', ctx.correlationId);
        const spec = q.spec as QuestionnaireSpec;
        const ares = validateAnswers(spec, input.answers);
        if (!ares.ok)
          throw badRequest(`invalid answers (${String(ares.errors.length)} problems)`, ctx.correlationId);
        const scores = computeScores(spec, ares.values);
        csat = scores.csat ?? null;
        nps = scores.nps ?? null;
        questionnaireVersion = q.version_number;
        for (const [key, value] of Object.entries(ares.values)) {
          await this.repo.insertAnswer(tx, {
            tenantId: ctx.tenantId,
            feedbackId: id,
            questionKey: key,
            answerType:
              typeof value === 'number'
                ? 'numeric'
                : typeof value === 'boolean'
                  ? 'yes_no'
                  : Array.isArray(value)
                    ? 'multiple_choice'
                    : 'short_text',
            valueText: typeof value === 'string' ? value : null,
            valueNumber: typeof value === 'number' ? value : null,
            valueBool: typeof value === 'boolean' ? value : null,
            valueChoices: Array.isArray(value) ? value : null,
            questionnaireCode: input.questionnaireCode,
            questionnaireVersion: q.version_number,
          });
        }
      }
      const updated = await this.repo.captureFeedback(tx, {
        id,
        expectedVersion: input.expectedVersion,
        rating: input.rating ?? null,
        ratingScale: input.ratingScale ?? null,
        csat,
        nps,
        questionnaireCode: input.questionnaireCode ?? null,
        questionnaireVersion,
        narrative: input.narrative ?? null,
        channel: input.channel ?? null,
        feedbackType,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Feedback modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.recordCaptured,
        entityType: 'feedback_record',
        entityId: id,
        detail: { feedbackType },
      });
      await this.emitter.publish(tx, {
        type: 'FeedbackCaptured',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { feedbackId: id, feedbackType, toStatus: 'feedback_captured' },
      });
      return updated;
    });
  }

  async classify(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      sentiment: string;
      category?: string | null;
      subcategory?: string | null;
      severity: string;
      ruleEvaluationId?: string | null;
    },
  ): Promise<FeedbackRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.recordClassify);
    if (!isSentiment(input.sentiment)) throw badRequest('invalid sentiment', ctx.correlationId);
    if (!isSeverity(input.severity)) throw badRequest('invalid severity', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const fb = await this.repo.findFeedback(tx, id);
      if (fb === null) throw ProblemError.notFound('Feedback not found.', ctx.correlationId);
      const updated = await this.repo.classifyFeedback(tx, {
        id,
        expectedVersion: input.expectedVersion,
        sentiment: input.sentiment,
        category: input.category ?? null,
        subcategory: input.subcategory ?? null,
        severity: input.severity,
        ruleEvalId: input.ruleEvaluationId ?? null,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Feedback modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.recordClassified,
        entityType: 'feedback_record',
        entityId: id,
        ...(input.ruleEvaluationId != null ? {} : {}),
        detail: { sentiment: input.sentiment, severity: input.severity },
      });
      await this.emitter.publish(tx, {
        type: 'FeedbackClassified',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          feedbackId: id,
          sentiment: input.sentiment,
          severity: input.severity,
          ...(input.category != null ? { category: input.category } : {}),
          ...(input.ruleEvaluationId != null ? { ruleEvaluationId: input.ruleEvaluationId } : {}),
        },
      });
      return updated;
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
      reason?: string | null;
      ruleEvaluationId?: string | null;
    },
  ): Promise<FeedbackRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.assignmentManage);
    return this.db.withTenant(ctx, async (tx) => {
      const fb = await this.repo.findFeedback(tx, id);
      if (fb === null) throw ProblemError.notFound('Feedback not found.', ctx.correlationId);
      const to = checkFeedbackTransition(fb.status, 'assigned').ok ? 'assigned' : fb.status;
      const updated = await this.repo.assignFeedback(tx, {
        id,
        expectedVersion: input.expectedVersion,
        owner: input.owner,
        toStatus: to,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Feedback modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertAssignment(tx, {
        tenantId: ctx.tenantId,
        feedbackId: id,
        kind: input.kind ?? 'officer',
        ref: input.owner,
        by: actor,
        reason: input.reason ?? null,
        ruleEvalId: input.ruleEvaluationId ?? null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.recordAssigned,
        entityType: 'feedback_record',
        entityId: id,
        detail: { owner: input.owner },
      });
      await this.emitter.publish(tx, {
        type: 'FeedbackAssigned',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { feedbackId: id, toStatus: to },
      });
      return updated;
    });
  }

  // --- activities -------------------------------------------------------------------------------
  async addActivity(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      activityType: string;
      headline: string;
      description?: string | null;
      dueAt?: string | null;
      assignedTo?: string | null;
      mandatory?: boolean;
      confidentiality?: string;
      documentRefs?: unknown;
    },
  ): Promise<ActivityRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.activityCreate);
    return this.db.withTenant(ctx, async (tx) => {
      const fb = await this.repo.findFeedback(tx, id);
      if (fb === null) throw ProblemError.notFound('Feedback not found.', ctx.correlationId);
      const conf = input.confidentiality ?? 'internal';
      if (!['internal', 'confidential', 'customer_facing'].includes(conf))
        throw badRequest('invalid confidentiality', ctx.correlationId);
      const act = await this.repo.insertActivity(tx, {
        tenantId: ctx.tenantId,
        feedbackId: id,
        activityType: input.activityType,
        headline: input.headline,
        description: input.description ?? null,
        dueAt: input.dueAt ?? null,
        assignedTo: input.assignedTo ?? null,
        mandatory: input.mandatory === true,
        confidentiality: conf,
        documentRefs: input.documentRefs ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.activityCreated,
        entityType: 'feedback_activity',
        entityId: act.id,
        detail: { activityType: input.activityType },
      });
      await this.emitter.publish(tx, {
        type: 'ActivityCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { feedbackId: id },
      });
      return act;
    });
  }
  async completeActivity(
    ctx: RequestContext,
    actor: string | null,
    activityId: string,
    expectedVersion: number,
    outcome: string | null = null,
  ): Promise<ActivityRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.activityComplete);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.completeActivity(tx, { id: activityId, expectedVersion, outcome });
      if (upd === null)
        throw ProblemError.conflict('Activity already complete or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.activityCompleted,
        entityType: 'feedback_activity',
        entityId: activityId,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'ActivityCompleted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { feedbackId: upd.feedback_id },
      });
      return upd;
    });
  }

  // --- resolution + confirmation ----------------------------------------------------------------
  async submitResolution(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      resolutionType?: string | null;
      summary?: string | null;
      actionTaken?: string | null;
      responsibleParty?: string | null;
      responsibleDepartment?: string | null;
      investigationFindings?: string | null;
      rootCauseCategory?: string | null;
      correctiveAction?: string | null;
      preventiveAction?: string | null;
      responseConfidential?: string | null;
      responseCustomerFacing?: string | null;
    },
  ): Promise<ResolutionRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.resolutionSubmit);
    return this.db.withTenant(ctx, async (tx) => {
      const fb = await this.repo.findFeedback(tx, id);
      if (fb === null) throw ProblemError.notFound('Feedback not found.', ctx.correlationId);
      const res = await this.repo.upsertResolution(tx, {
        tenantId: ctx.tenantId,
        feedbackId: id,
        resolutionType: input.resolutionType ?? null,
        summary: input.summary ?? null,
        actionTaken: input.actionTaken ?? null,
        responsibleParty: input.responsibleParty ?? null,
        responsibleDepartment: input.responsibleDepartment ?? null,
        investigationFindings: input.investigationFindings ?? null,
        rootCauseCategory: input.rootCauseCategory ?? null,
        correctiveAction: input.correctiveAction ?? null,
        preventiveAction: input.preventiveAction ?? null,
        responseConfidential: input.responseConfidential ?? null,
        responseCustomerFacing: input.responseCustomerFacing ?? null,
        submittedBy: actor,
      });
      await this.repo.patchFeedback(tx, {
        id,
        expectedVersion: fb.version,
        resolutionStatus: 'proposed',
        by: actor,
      });
      if (input.rootCauseCategory != null)
        await this.emitter.recordAudit(tx, ctx, {
          code: M12_AUDIT_CODES.rootCauseRecorded,
          entityType: 'feedback_resolution',
          entityId: res.id,
          detail: { category: input.rootCauseCategory },
        });
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.resolutionSubmitted,
        entityType: 'feedback_resolution',
        entityId: res.id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'ResolutionProposed',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { feedbackId: id, toStatus: 'proposed' },
      });
      return res;
    });
  }

  async approveResolution(ctx: RequestContext, actor: string | null, id: string): Promise<FeedbackRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.resolutionApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const fb = await this.repo.findFeedback(tx, id);
      if (fb === null) throw ProblemError.notFound('Feedback not found.', ctx.correlationId);
      const res = await this.repo.findResolution(tx, id);
      if (res === null) throw ProblemError.conflict('No resolution to approve.', ctx.correlationId);
      // Segregation of duties: the submitter cannot approve their own resolution.
      if (res.submitted_by !== null && actor !== null && res.submitted_by === actor)
        throw ProblemError.conflict(
          'The resolution submitter cannot approve it (segregation of duties).',
          ctx.correlationId,
        );
      const upd = await this.repo.setResolutionApproval(tx, {
        id: res.id,
        expectedVersion: res.version,
        approval: 'approved',
        approvedBy: actor,
      });
      if (upd === null) throw ProblemError.conflict('Resolution modified concurrently.', ctx.correlationId);
      const check = checkFeedbackTransition(fb.status, 'resolved');
      const to = check.ok ? 'resolved' : fb.status;
      const updated = await this.repo.updateFeedbackStatus(tx, {
        id,
        expectedVersion: fb.version,
        toStatus: to,
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Feedback modified concurrently.', ctx.correlationId);
      // Return the row AFTER the resolution_status patch so the caller holds the current version — otherwise
      // the next mutation (confirmation, close) would present a stale expectedVersion and lose its update.
      const patched = await this.repo.patchFeedback(tx, {
        id,
        expectedVersion: updated.version,
        resolutionStatus: 'approved',
        by: actor,
      });
      if (patched === null) throw ProblemError.conflict('Feedback modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.resolutionApproved,
        entityType: 'feedback_resolution',
        entityId: res.id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'FeedbackResolved',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { feedbackId: id, toStatus: to },
      });
      return patched;
    });
  }

  async recordConfirmation(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { expectedVersion: number; satisfied: boolean; remainingConcern?: string | null },
  ): Promise<FeedbackRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.confirmationRecord);
    return this.db.withTenant(ctx, async (tx) => {
      const fb = await this.repo.findFeedback(tx, id);
      if (fb === null) throw ProblemError.notFound('Feedback not found.', ctx.correlationId);
      const confirmed = await this.repo.patchFeedback(tx, {
        id,
        expectedVersion: input.expectedVersion,
        customerConfirmed: input.satisfied,
        customerInformed: true,
        by: actor,
      });
      if (confirmed === null)
        throw ProblemError.conflict('Feedback modified concurrently (stale version).', ctx.correlationId);
      // If dissatisfied, reopen for further work (policy: reopen; escalation/case-handoff are explicit follow-ons).
      let result = await this.repo.findFeedback(tx, id);
      if (!input.satisfied && result !== null && checkFeedbackTransition(result.status, 'reopened').ok) {
        result = await this.repo.updateFeedbackStatus(tx, {
          id,
          expectedVersion: result.version,
          toStatus: 'reopened',
          by: actor,
        });
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.confirmationRecorded,
        entityType: 'feedback_record',
        entityId: id,
        detail: { satisfied: input.satisfied },
      });
      await this.emitter.publish(tx, {
        type: 'CustomerConfirmationRecorded',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { feedbackId: id, reasonCode: input.satisfied ? 'satisfied' : 'dissatisfied' },
      });
      if (result === null) throw ProblemError.conflict('Feedback modified concurrently.', ctx.correlationId);
      return result;
    });
  }

  // --- closure + reopen -------------------------------------------------------------------------
  async close(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { expectedVersion: number; waiveCustomerConfirmation?: boolean; notes?: string | null },
  ): Promise<FeedbackRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.recordClose);
    return this.db.withTenant(ctx, async (tx) => {
      const fb = await this.repo.findFeedback(tx, id);
      if (fb === null) throw ProblemError.notFound('Feedback not found.', ctx.correlationId);
      if (isFeedbackTerminal(fb.status))
        throw ProblemError.conflict(`Feedback is ${fb.status}.`, ctx.correlationId);
      const res = await this.repo.findResolution(tx, id);
      const sla = await this.repo.findSlaInstance(tx, id);
      const openMandatory = await this.repo.countOpenMandatoryActivities(tx, id);
      // Positive feedback (compliment) closes after a light review; negative uses the full criteria.
      const positive = isPositiveType(fb.feedback_type as FeedbackType) || fb.sentiment === 'positive';
      const criteria: ClosureCriteria = positive
        ? { requireCaptured: true, requireNoOpenMandatoryActivity: true }
        : DEFAULT_CLOSURE_CRITERIA;
      const state = {
        captured: fb.status !== 'pending_contact' && fb.status !== 'contact_attempted',
        assigned: fb.current_owner !== null,
        responseComplete: res !== null,
        resolutionRecorded: res !== null && res.approval_status === 'approved',
        customerInformed: fb.customer_informed,
        customerConfirmed: fb.customer_confirmed,
        customerConfirmationWaived: input.waiveCustomerConfirmation === true,
        slaDispositionRecorded: sla === null || sla.disposition_recorded,
        rootCauseRecorded: res !== null && res.root_cause_category !== null,
        openMandatoryActivities: openMandatory,
        unresolvedCriticalEscalations: 0,
      };
      const eligibility = evaluateClosure(criteria, state);
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.closureEvaluated,
        entityType: 'feedback_record',
        entityId: id,
        detail: { eligible: eligibility.eligible, reasons: eligibility.reasonCodes.length },
      });
      if (!eligibility.eligible)
        throw ProblemError.conflict(
          `Not eligible for closure: ${eligibility.reasonCodes.join(', ')}`,
          ctx.correlationId,
        );
      const check = checkFeedbackTransition(fb.status, 'closed');
      if (!check.ok) {
        // allow closing from resolved/feedback_captured (positive); if not directly allowed, route via resolved
        if (fb.status !== 'resolved')
          throw ProblemError.conflict(
            `Cannot close from ${fb.status}: ${check.reason ?? ''}`,
            ctx.correlationId,
          );
      }
      const updated = await this.repo.updateFeedbackStatus(tx, {
        id,
        expectedVersion: input.expectedVersion,
        toStatus: 'closed',
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Feedback modified concurrently (stale version).', ctx.correlationId);
      if (sla !== null) await this.repo.setSlaDisposition(tx, id);
      const patched = await this.repo.patchFeedback(tx, {
        id,
        expectedVersion: updated.version,
        closureStatus: 'closed',
        by: actor,
      });
      if (patched === null)
        throw ProblemError.conflict('Feedback modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.recordClosed,
        entityType: 'feedback_record',
        entityId: id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'FeedbackClosed',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { feedbackId: id, toStatus: 'closed' },
      });
      return patched;
    });
  }

  async reopen(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<FeedbackRow> {
    await this.authz.require(ctx, M12_PERMISSIONS.recordReopen);
    if (input.reason.trim() === '') throw badRequest('a reason is required to reopen', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const fb = await this.repo.findFeedback(tx, id);
      if (fb === null) throw ProblemError.notFound('Feedback not found.', ctx.correlationId);
      const check = checkFeedbackTransition(fb.status, 'reopened');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot reopen from ${fb.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const updated = await this.repo.updateFeedbackStatus(tx, {
        id,
        expectedVersion: input.expectedVersion,
        toStatus: 'reopened',
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Feedback modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.recordReopened,
        entityType: 'feedback_record',
        entityId: id,
        reason: input.reason,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'FeedbackReopened',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { feedbackId: id, toStatus: 'reopened' },
      });
      return updated;
    });
  }

  async recognizePositive(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { staff?: string | null; consentForTestimonial?: boolean },
  ): Promise<void> {
    await this.authz.require(ctx, M12_PERMISSIONS.recordUpdate);
    await this.db.withTenant(ctx, async (tx) => {
      const fb = await this.repo.findFeedback(tx, id);
      if (fb === null) throw ProblemError.notFound('Feedback not found.', ctx.correlationId);
      await this.repo.insertActivity(tx, {
        tenantId: ctx.tenantId,
        feedbackId: id,
        activityType: 'recognition',
        headline: 'Positive feedback recognized',
        description: input.staff ?? null,
        dueAt: null,
        assignedTo: null,
        mandatory: false,
        confidentiality: 'internal',
        documentRefs: null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.positiveRecognized,
        entityType: 'feedback_record',
        entityId: id,
        detail: { consent: input.consentForTestimonial === true },
      });
      await this.emitter.publish(tx, {
        type: 'PositiveFeedbackRecognized',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { feedbackId: id, feedbackType: fb.feedback_type },
      });
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async get(ctx: RequestContext, id: string): Promise<{ feedback: FeedbackRow; canReadContact: boolean }> {
    await this.authz.require(ctx, M12_PERMISSIONS.recordRead);
    const canReadContact = await this.authz.can(ctx, M12_PERMISSIONS.customerContactRead);
    const feedback = await this.db.withTenant(ctx, async (tx) => {
      const f = await this.repo.findFeedback(tx, id);
      if (f !== null && canReadContact)
        await this.emitter.recordAudit(tx, ctx, {
          code: M12_AUDIT_CODES.contactAccessed,
          entityType: 'feedback_record',
          entityId: id,
          detail: {},
        });
      return f;
    });
    if (feedback === null) throw ProblemError.notFound('Feedback not found.', ctx.correlationId);
    return { feedback, canReadContact };
  }
  async listActivities(ctx: RequestContext, id: string): Promise<ActivityRow[]> {
    await this.authz.require(ctx, M12_PERMISSIONS.activityRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listActivities(tx, id));
  }
  async getResolution(
    ctx: RequestContext,
    id: string,
  ): Promise<{ resolution: ResolutionRow | null; canReadConfidential: boolean }> {
    await this.authz.require(ctx, M12_PERMISSIONS.responseRead);
    const canReadConfidential = await this.authz.can(ctx, M12_PERMISSIONS.responseSubmit);
    const resolution = await this.db.withTenant(ctx, (tx) => this.repo.findResolution(tx, id));
    return { resolution, canReadConfidential };
  }
  async search(
    ctx: RequestContext,
    filters: {
      product?: string;
      branch?: string;
      department?: string;
      status?: string;
      sentiment?: string;
      severity?: string;
      category?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<FeedbackRow[]> {
    await this.authz.require(ctx, M12_PERMISSIONS.recordRead);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.searchFeedback(tx, {
        ...filters,
        limit: Math.min(filters.limit ?? 50, FEEDBACK_LIMITS.maxSearchLimit),
        offset: filters.offset ?? 0,
      }),
    );
  }
  async analytics(
    ctx: RequestContext,
    dimension: 'product' | 'branch' | 'department' | 'sentiment' | 'severity' | 'category' | 'status',
  ): Promise<{ dim: string | null; count: string }[]> {
    await this.authz.require(ctx, M12_PERMISSIONS.analyticsRead);
    return this.db.withTenant(ctx, (tx) => this.repo.analyticsByDimension(tx, dimension));
  }
}
