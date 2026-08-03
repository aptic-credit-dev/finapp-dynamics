/**
 * PostingService — PREPARES approval-gated posting requests for SUBMITTED (approved) drafts and records posting-result
 * evidence. DRAFT-first MVP: m21 NEVER pushes to a core banking/accounting system (that is m23/m33, post-MVP), NEVER
 * approves (m22 owns maker-checker + SoD). The absolute posting controls are enforced here AND at the DB:
 *   - no posting without approval — a request cannot leave 'prepared' without an opaque m22 approval_ref;
 *   - no posting into a closed/locked period — a request can only become postable while the period is open (ADR-078);
 *   - maker != checker — the recorded approver is never the requester (SoD, DB CHECK);
 *   - no duplicate posting — a per-key idempotency ledger + terminal 'succeeded' state.
 * Money is INTEGER MINOR UNITS — never float (ADR-007).
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M21_PERMISSIONS } from './permissions.ts';
import { M21_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { checkPostingRequestTransition } from './domain/lifecycles.ts';
import { POSTING_RESULT_STATUSES } from './domain/lifecycles.ts';
import { JournalRepository, type PostingRequestRow, type PostingResultRow } from './repository.ts';
import type { M21Emitter } from './emit.ts';

export class PostingService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M21Emitter;
  private readonly repo: JournalRepository;
  constructor(db: Db, authz: Authz, emitter: M21Emitter, repo: JournalRepository = new JournalRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  /** Prepare a posting request for a SUBMITTED (approval-bound) draft. Idempotent per idempotency key. */
  async createPostingRequest(
    ctx: RequestContext,
    actor: string | null,
    draftId: string,
    input: { idempotencyKey?: string | null; externalSystem?: string | null },
  ): Promise<PostingRequestRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.postingRequestCreate);
    return this.db.withTenant(ctx, async (tx) => {
      const draft = await this.repo.findDraft(tx, draftId);
      if (draft === null) throw ProblemError.notFound('Draft not found.', ctx.correlationId);
      if (draft.status !== 'submitted')
        throw badRequest('a posting request can only be prepared for a submitted draft.', ctx.correlationId);
      if (!draft.is_balanced)
        throw badRequest('a draft must be balanced before a posting request.', ctx.correlationId);
      if (draft.period_status !== 'open')
        throw badRequest('cannot prepare a posting request for a closed/locked period.', ctx.correlationId);
      if (await this.repo.draftHasSuccessfulPosting(tx, draftId))
        throw ProblemError.conflict(
          'this draft has already posted (no duplicate posting).',
          ctx.correlationId,
        );

      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existingReq = await this.repo.findPostingRequestByIdempotencyKey(tx, input.idempotencyKey);
        if (existingReq !== null) return existingReq; // idempotent create
      }
      const req = await this.repo.insertPostingRequest(tx, {
        tenantId: ctx.tenantId,
        draftId,
        requestedBy: actor,
        periodStatus: draft.period_status,
        amountMinor: Number(draft.total_debits_minor),
        externalSystem: input.externalSystem ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        await this.repo.insertPostingIdempotency(tx, {
          tenantId: ctx.tenantId,
          idempotencyKey: input.idempotencyKey,
          postingRequestId: req.id,
          draftId,
          correlationId: ctx.correlationId,
          by: actor,
        });
      }
      await this.repo.insertPostingRequestHistory(tx, {
        tenantId: ctx.tenantId,
        postingRequestId: req.id,
        fromStatus: null,
        toStatus: 'prepared',
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.postingRequestCreated,
        entityType: 'posting_request',
        entityId: req.id,
        detail: { draftId },
      });
      await this.emitter.publishPostingRequest(tx, {
        type: 'PostingRequestCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: req.id,
          recordType: 'posting_request',
          draftId,
          postingRequestId: req.id,
          amountMinor: req.amount_minor,
          toStatus: 'prepared',
          isDraft: true,
        },
      });
      return req;
    });
  }

  /**
   * Record m22's approval on a prepared posting request and mark it 'ready'. m21 does NOT approve — it records the
   * opaque approval reference + approver. The DB enforces: an approval reference is present, the approver is not the
   * requester (SoD), and the period is open. Requires the privileged authorize permission.
   */
  async authorizePostingRequest(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    input: { approvalRef: string; approvedBy: string },
  ): Promise<PostingRequestRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.postingRequestAuthorize);
    if (input.approvalRef.trim() === '')
      throw badRequest('an approval reference (from m22) is required.', ctx.correlationId);
    if (input.approvedBy.trim() === '')
      throw badRequest('the approver identity is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const req = await this.repo.findPostingRequest(tx, id);
      if (req === null) throw ProblemError.notFound('Posting request not found.', ctx.correlationId);
      const t = checkPostingRequestTransition(req.status, 'ready');
      if (!t.ok) throw badRequest(`A ${req.status} posting request cannot be authorized.`, ctx.correlationId);
      if (req.period_status !== 'open')
        throw badRequest('cannot authorize posting into a closed/locked period.', ctx.correlationId);
      // MAKER != CHECKER: the approver must not be the requester (also a DB CHECK; fail closed early).
      if (req.requested_by !== null && input.approvedBy === req.requested_by)
        throw ProblemError.forbidden(
          'the approver must not be the requester (segregation of duties).',
          ctx.correlationId,
        );
      const updated = await this.repo.setPostingRequestStatus(tx, {
        id,
        expectedVersion,
        status: 'ready',
        approvalRef: input.approvalRef,
        approvedBy: input.approvedBy,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Posting request modified concurrently.', ctx.correlationId);
      await this.repo.insertPostingRequestHistory(tx, {
        tenantId: ctx.tenantId,
        postingRequestId: id,
        fromStatus: req.status,
        toStatus: 'ready',
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.postingRequestAuthorized,
        entityType: 'posting_request',
        entityId: id,
        detail: { draftId: req.draft_id },
      });
      await this.emitter.publishPostingRequest(tx, {
        type: 'PostingRequestAuthorized',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: id,
          recordType: 'posting_request',
          draftId: req.draft_id,
          postingRequestId: id,
          approvalRef: input.approvalRef,
          fromStatus: req.status,
          toStatus: 'ready',
          isDraft: true,
        },
      });
      return updated;
    });
  }

  async cancelPostingRequest(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    reason: string,
  ): Promise<PostingRequestRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.postingRequestCancel);
    if (reason.trim() === '') throw badRequest('a cancellation reason is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const req = await this.repo.findPostingRequest(tx, id);
      if (req === null) throw ProblemError.notFound('Posting request not found.', ctx.correlationId);
      const t = checkPostingRequestTransition(req.status, 'cancelled');
      if (!t.ok) throw badRequest(`A ${req.status} posting request cannot be cancelled.`, ctx.correlationId);
      const updated = await this.repo.setPostingRequestStatus(tx, {
        id,
        expectedVersion,
        status: 'cancelled',
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Posting request modified concurrently.', ctx.correlationId);
      await this.repo.insertPostingRequestHistory(tx, {
        tenantId: ctx.tenantId,
        postingRequestId: id,
        fromStatus: req.status,
        toStatus: 'cancelled',
        reason,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.postingRequestCancelled,
        entityType: 'posting_request',
        entityId: id,
        detail: { reason },
      });
      await this.emitter.publishPostingRequest(tx, {
        type: 'PostingRequestCancelled',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: id,
          recordType: 'posting_request',
          draftId: req.draft_id,
          postingRequestId: id,
          fromStatus: req.status,
          toStatus: 'cancelled',
          isDraft: true,
        },
      });
      return updated;
    });
  }

  /**
   * Record posting-result evidence against a 'ready' (authorized) request. DRAFT-first: this records the outcome of a
   * (future, m23/m33) posting attempt — it does NOT itself push. A 'succeeded' outcome moves the request terminal and
   * is guarded against duplicate posting; a 'failed' outcome allows a later retry.
   */
  async recordPostingResult(
    ctx: RequestContext,
    actor: string | null,
    postingRequestId: string,
    input: {
      status: string;
      externalSystem?: string | null;
      externalRef?: string | null;
      idempotencyKey?: string | null;
      message?: string | null;
      reasonCode?: string | null;
    },
  ): Promise<{ request: PostingRequestRow; result: PostingResultRow }> {
    await this.authz.require(ctx, M21_PERMISSIONS.postingResultRecord);
    if (!(POSTING_RESULT_STATUSES as readonly string[]).includes(input.status))
      throw badRequest('unknown posting result status.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const req = await this.repo.findPostingRequest(tx, postingRequestId);
      if (req === null) throw ProblemError.notFound('Posting request not found.', ctx.correlationId);
      if (req.status !== 'ready' && req.status !== 'submitted')
        throw badRequest(`cannot record a result for a ${req.status} posting request.`, ctx.correlationId);
      if (req.approval_ref === null)
        throw ProblemError.forbidden(
          'cannot post without an approval reference (no posting without approval).',
          ctx.correlationId,
        );

      // No duplicate posting — a succeeded result may only be recorded once.
      if (input.status === 'succeeded' && (await this.repo.draftHasSuccessfulPosting(tx, req.draft_id)))
        throw ProblemError.conflict(
          'this draft has already posted (no duplicate posting).',
          ctx.correlationId,
        );

      // Move the request through submitted on the way to a terminal result.
      let current = req;
      if (current.status === 'ready') {
        const submitted = await this.repo.setPostingRequestStatus(tx, {
          id: postingRequestId,
          expectedVersion: current.version,
          status: 'submitted',
          by: actor,
        });
        if (submitted === null)
          throw ProblemError.conflict('Posting request modified concurrently.', ctx.correlationId);
        await this.repo.insertPostingRequestHistory(tx, {
          tenantId: ctx.tenantId,
          postingRequestId,
          fromStatus: 'ready',
          toStatus: 'submitted',
          reason: null,
          reasonCode: null,
          by: actor,
          correlationId: ctx.correlationId,
        });
        current = submitted;
      }

      const result = await this.repo.insertPostingResult(tx, {
        tenantId: ctx.tenantId,
        postingRequestId,
        status: input.status,
        externalSystem: input.externalSystem ?? req.external_system,
        externalRef: input.externalRef ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        message: input.message ?? null,
        reasonCode: input.reasonCode ?? null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertPostingResultHistory(tx, {
        tenantId: ctx.tenantId,
        postingResultId: result.id,
        fromStatus: null,
        toStatus: input.status,
        reason: input.message ?? null,
        by: actor,
        correlationId: ctx.correlationId,
      });

      if (input.status === 'succeeded') {
        if (input.idempotencyKey != null && input.idempotencyKey !== '') {
          await this.repo.insertPostingIdempotency(tx, {
            tenantId: ctx.tenantId,
            idempotencyKey: input.idempotencyKey,
            postingRequestId,
            draftId: req.draft_id,
            correlationId: ctx.correlationId,
            by: actor,
          });
        }
        const done = await this.repo.setPostingRequestStatus(tx, {
          id: postingRequestId,
          expectedVersion: current.version,
          status: 'succeeded',
          by: actor,
        });
        if (done === null)
          throw ProblemError.conflict('Posting request modified concurrently.', ctx.correlationId);
        await this.repo.insertPostingRequestHistory(tx, {
          tenantId: ctx.tenantId,
          postingRequestId,
          fromStatus: 'submitted',
          toStatus: 'succeeded',
          reason: null,
          reasonCode: null,
          by: actor,
          correlationId: ctx.correlationId,
        });
        // Mark the draft posted (post-MVP terminal), recording the transition.
        const draft = await this.repo.findDraft(tx, req.draft_id);
        if (draft !== null && draft.status === 'submitted') {
          const posted = await this.repo.setDraftStatus(tx, {
            id: draft.id,
            expectedVersion: draft.version,
            status: 'posted',
            by: actor,
          });
          if (posted !== null) {
            await this.repo.insertStatusHistory(tx, {
              tenantId: ctx.tenantId,
              draftId: draft.id,
              fromStatus: 'submitted',
              toStatus: 'posted',
              reason: null,
              reasonCode: null,
              by: actor,
              correlationId: ctx.correlationId,
            });
            await this.emitter.recordAudit(tx, ctx, {
              code: M21_AUDIT_CODES.draftPosted,
              entityType: 'journal_draft',
              entityId: draft.id,
              detail: { postingRequestId },
            });
            await this.emitter.publishJournal(tx, {
              type: 'DraftPosted',
              tenantId: ctx.tenantId,
              correlationId: ctx.correlationId,
              ...(actor !== null ? { actor } : {}),
              payload: {
                recordId: draft.id,
                recordType: 'draft',
                fromStatus: 'submitted',
                toStatus: 'posted',
                isDraft: true,
              },
            });
          }
        }
        current = done;
      } else if (input.status === 'failed') {
        const failed = await this.repo.setPostingRequestStatus(tx, {
          id: postingRequestId,
          expectedVersion: current.version,
          status: 'failed',
          by: actor,
        });
        if (failed === null)
          throw ProblemError.conflict('Posting request modified concurrently.', ctx.correlationId);
        await this.repo.insertPostingRequestHistory(tx, {
          tenantId: ctx.tenantId,
          postingRequestId,
          fromStatus: 'submitted',
          toStatus: 'failed',
          reason: input.message ?? null,
          reasonCode: input.reasonCode ?? null,
          by: actor,
          correlationId: ctx.correlationId,
        });
        current = failed;
      }

      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.postingResultRecorded,
        entityType: 'posting_result',
        entityId: result.id,
        detail: { postingRequestId, status: input.status },
      });
      await this.emitter.publishPostingRequest(tx, {
        type: 'PostingResultRecorded',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: result.id,
          recordType: 'posting_result',
          postingRequestId,
          draftId: req.draft_id,
          toStatus: input.status,
          ...(input.reasonCode != null ? { reasonCode: input.reasonCode } : {}),
          isDraft: true,
        },
      });
      if (input.status === 'succeeded' || input.status === 'failed') {
        await this.emitter.publishPostingRequest(tx, {
          type: input.status === 'succeeded' ? 'PostingSucceeded' : 'PostingFailed',
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            recordId: postingRequestId,
            recordType: 'posting_request',
            draftId: req.draft_id,
            postingRequestId,
            toStatus: input.status,
            ...(input.externalRef != null ? { externalRef: input.externalRef } : {}),
            isDraft: true,
          },
        });
      }
      return { request: current, result };
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getPostingRequest(
    ctx: RequestContext,
    id: string,
  ): Promise<{ request: PostingRequestRow; results: PostingResultRow[] }> {
    await this.authz.require(ctx, M21_PERMISSIONS.postingRequestRead);
    return this.db.withTenant(ctx, async (tx) => {
      const request = await this.repo.findPostingRequest(tx, id);
      if (request === null) throw ProblemError.notFound('Posting request not found.', ctx.correlationId);
      const results = await this.repo.listPostingResults(tx, id);
      return { request, results };
    });
  }
  async listPostingRequests(ctx: RequestContext, draftId: string): Promise<PostingRequestRow[]> {
    await this.authz.require(ctx, M21_PERMISSIONS.postingRequestRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listPostingRequests(tx, draftId));
  }
  async listPostingResults(ctx: RequestContext, postingRequestId: string): Promise<PostingResultRow[]> {
    await this.authz.require(ctx, M21_PERMISSIONS.postingResultRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listPostingResults(tx, postingRequestId));
  }
}
