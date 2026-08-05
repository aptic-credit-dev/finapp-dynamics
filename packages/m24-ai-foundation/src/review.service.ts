/**
 * ReviewService — the HUMAN accountability gate. An AI output is a RECOMMENDATION; it can only be APPROVED by a HUMAN
 * reviewer (the DB `ai_output_human_ck` CHECK is the last line of defence), and — where the output requires citations —
 * only with at least one source citation (`ai_output_cite_ck`). The pure `evaluateApprovalGate` fails CLOSED (no
 * autonomous approval). Approving an output completes its request; rejecting rejects both. Every review is recorded in
 * the append-only `ai_human_review` ledger and audited. AI never approves itself — a person does.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M24_PERMISSIONS } from './permissions.ts';
import { M24_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden } from './errors.ts';
import {
  checkOutputTransition,
  checkRequestTransition,
  evaluateApprovalGate,
  isConfidenceBps,
  REASON_CODES,
} from './domain.ts';
import { AiRepository, type OutputRow, type CitationRow } from './repository.ts';
import type { M24Emitter } from './emit.ts';

export class ReviewService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M24Emitter;
  private readonly repo: AiRepository;
  constructor(db: Db, authz: Authz, emitter: M24Emitter, repo: AiRepository = new AiRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  /** Record a source citation on an output (m09 document ref + span). Bumps the output's citation count. */
  async addCitation(
    ctx: RequestContext,
    actor: string | null,
    outputId: string,
    input: { documentRef?: string | null; span?: string | null; confidenceBps?: number },
  ): Promise<CitationRow> {
    await this.authz.require(ctx, M24_PERMISSIONS.citationAdd);
    const conf = input.confidenceBps ?? 0;
    if (!isConfidenceBps(conf))
      throw badRequest('confidence must be an integer 0..10000 basis points.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const output = await this.repo.findOutput(tx, outputId);
      if (output === null) throw ProblemError.notFound('Output not found.', ctx.correlationId);
      if (output.status === 'approved' || output.status === 'rejected')
        throw badRequest('cannot cite a terminal output.', ctx.correlationId);
      const citation = await this.repo.insertCitation(tx, {
        tenantId: ctx.tenantId,
        outputId,
        documentRef: input.documentRef ?? null,
        span: input.span ?? null,
        confidenceBps: conf,
        by: actor,
        correlationId: ctx.correlationId,
      });
      const count = await this.repo.countCitations(tx, outputId);
      await this.repo.updateOutput(tx, {
        id: outputId,
        expectedVersion: output.version,
        status: output.status,
        citationCount: count,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M24_AUDIT_CODES.citationRecorded,
        entityType: 'ai_citation',
        entityId: citation.id,
        detail: { outputId },
      });
      await this.emitter.publishOutput(tx, {
        type: 'CitationRecorded',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: citation.id,
          recordType: 'citation',
          outputId,
          citationCount: count,
          isAssistive: true,
        },
      });
      return citation;
    });
  }

  /**
   * A HUMAN reviews an AI output. Approving is gated by `evaluateApprovalGate` (a human reviewer + required citations)
   * and the DB CHECK — an output can NEVER be approved autonomously. Approval completes the request; rejection rejects it.
   */
  async reviewOutput(
    ctx: RequestContext,
    actor: string | null,
    outputId: string,
    expectedVersion: number,
    input: { decision: 'approved' | 'rejected'; reason?: string | null },
  ): Promise<OutputRow> {
    await this.authz.require(ctx, M24_PERMISSIONS.outputReview);
    if (actor === null || actor.trim() === '')
      throw badRequest('a human reviewer is required (no autonomous approval).', ctx.correlationId);
    if (input.decision !== 'approved' && input.decision !== 'rejected')
      throw badRequest('unknown review decision.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const output = await this.repo.findOutput(tx, outputId);
      if (output === null) throw ProblemError.notFound('Output not found.', ctx.correlationId);
      if (output.version !== expectedVersion)
        throw ProblemError.conflict('Output modified concurrently.', ctx.correlationId);
      const t = checkOutputTransition(output.status, input.decision);
      if (!t.ok)
        throw badRequest(`a ${output.status} output cannot be ${input.decision}.`, ctx.correlationId);

      if (input.decision === 'approved') {
        // THE no-autonomous-action gate: a human reviewer + (where required) citations. Fails closed.
        const gate = evaluateApprovalGate({
          reviewerId: actor,
          citationsRequired: output.citations_required,
          citationCount: output.citation_count,
        });
        if (!gate.allowed) {
          await this.repo.insertHumanReview(tx, {
            tenantId: ctx.tenantId,
            outputId,
            requestId: output.request_id,
            reviewer: actor,
            decision: 'rejected',
            reason: null,
            reasonCode: gate.reasonCode,
            correlationId: ctx.correlationId,
          });
          await this.emitter.recordAudit(tx, ctx, {
            code: M24_AUDIT_CODES.humanReviewRecorded,
            entityType: 'ai_output',
            entityId: outputId,
            detail: { blocked: true, reasonCode: gate.reasonCode },
          });
          throw governanceForbidden(gate.reasonCode, ctx.correlationId);
        }
      }

      const updated = await this.repo.updateOutput(tx, {
        id: outputId,
        expectedVersion,
        status: input.decision,
        reviewedBy: actor,
        reviewReasonCode:
          input.decision === 'approved' ? REASON_CODES.humanApproved : REASON_CODES.humanRejected,
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Output modified concurrently.', ctx.correlationId);
      await this.repo.insertOutputHistory(tx, {
        tenantId: ctx.tenantId,
        outputId,
        requestId: output.request_id,
        fromStatus: output.status,
        toStatus: input.decision,
        reason: input.reason ?? null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertHumanReview(tx, {
        tenantId: ctx.tenantId,
        outputId,
        requestId: output.request_id,
        reviewer: actor,
        decision: input.decision,
        reason: input.reason ?? null,
        reasonCode: null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M24_AUDIT_CODES.humanReviewRecorded,
        entityType: 'ai_human_review',
        entityId: outputId,
        detail: { decision: input.decision },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: input.decision === 'approved' ? M24_AUDIT_CODES.outputApproved : M24_AUDIT_CODES.outputRejected,
        entityType: 'ai_output',
        entityId: outputId,
        detail: {},
      });
      await this.emitter.publishOutput(tx, {
        type: input.decision === 'approved' ? 'OutputApproved' : 'OutputRejected',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor,
        payload: {
          recordId: outputId,
          recordType: 'output',
          requestId: output.request_id,
          outputId,
          reviewerId: actor,
          toStatus: input.decision,
          isAssistive: true,
        },
      });

      // complete/reject the parent request to match the human decision.
      const req = await this.repo.findRequest(tx, output.request_id);
      if (req !== null && req.status === 'review_pending') {
        const to = input.decision === 'approved' ? 'completed' : 'rejected';
        const rt = checkRequestTransition(req.status, to);
        if (rt.ok) {
          const doneReq = await this.repo.updateRequest(tx, {
            id: req.id,
            expectedVersion: req.version,
            status: to,
            by: actor,
          });
          if (doneReq !== null) {
            await this.repo.insertRequestHistory(tx, {
              tenantId: ctx.tenantId,
              requestId: req.id,
              fromStatus: 'review_pending',
              toStatus: to,
              reason: null,
              reasonCode:
                input.decision === 'approved' ? REASON_CODES.humanApproved : REASON_CODES.humanRejected,
              by: actor,
              correlationId: ctx.correlationId,
            });
            await this.emitter.recordAudit(tx, ctx, {
              code:
                input.decision === 'approved'
                  ? M24_AUDIT_CODES.requestCompleted
                  : M24_AUDIT_CODES.requestRejected,
              entityType: 'ai_request',
              entityId: req.id,
              detail: {},
            });
            await this.emitter.publishRequest(tx, {
              type: input.decision === 'approved' ? 'RequestCompleted' : 'RequestRejected',
              tenantId: ctx.tenantId,
              correlationId: ctx.correlationId,
              actor,
              payload: {
                recordId: req.id,
                recordType: 'request',
                requestId: req.id,
                toStatus: to,
                isAssistive: true,
              },
            });
          }
        }
      }
      return updated;
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getOutput(ctx: RequestContext, id: string): Promise<{ output: OutputRow; citations: CitationRow[] }> {
    await this.authz.require(ctx, M24_PERMISSIONS.outputRead);
    return this.db.withTenant(ctx, async (tx) => {
      const output = await this.repo.findOutput(tx, id);
      if (output === null) throw ProblemError.notFound('Output not found.', ctx.correlationId);
      const citations = await this.repo.listCitations(tx, id);
      return { output, citations };
    });
  }
}
