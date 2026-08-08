/**
 * CopilotResponseService — reads a query's CITED response and its citations, and handles human-reviewed EXPORT. A
 * response and its citations are read under ai.copilot.read; requesting an EXPORT requires the privileged
 * ai.copilot.export and is only permitted for a COMPLETE (cited, policy-cleared) response — a review_required/rejected
 * answer can never be exported as a finished executive artefact. Every citation access under export and every export
 * request is audited (AI_COPILOT_CITATION_ACCESSED / AI_COPILOT_EXPORT_REQUESTED). The copilot returns citation
 * REFERENCES only — never copied restricted content — and never mutates a business record.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M28_PERMISSIONS } from './permissions.ts';
import { M28_AUDIT_CODES } from './audit-codes.ts';
import { governanceForbidden } from './errors.ts';
import { REASON_CODES } from './domain.ts';
import { ExecutiveAiRepository, type CitationRow, type ResponseRow } from './repository.ts';
import type { M28Emitter } from './emit.ts';

export class CopilotResponseService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M28Emitter;
  private readonly repo: ExecutiveAiRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M28Emitter,
    repo: ExecutiveAiRepository = new ExecutiveAiRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async getResponseForQuery(ctx: RequestContext, queryId: string): Promise<ResponseRow> {
    await this.authz.require(ctx, M28_PERMISSIONS.copilotRead);
    const response = await this.db.withTenant(ctx, (tx) => this.repo.findResponseByQuery(tx, queryId));
    if (response === null) throw ProblemError.notFound('Response not found.', ctx.correlationId);
    return response;
  }

  async listCitationsForQuery(ctx: RequestContext, queryId: string): Promise<CitationRow[]> {
    await this.authz.require(ctx, M28_PERMISSIONS.copilotRead);
    return this.db.withTenant(ctx, async (tx) => {
      const response = await this.repo.findResponseByQuery(tx, queryId);
      if (response === null) throw ProblemError.notFound('Response not found.', ctx.correlationId);
      return this.repo.listCitations(tx, response.id);
    });
  }

  /**
   * Request a human-reviewed EXPORT of a response. Privileged (ai.copilot.export). Only a COMPLETE response may be
   * exported; the citations are returned by REFERENCE and the access is audited. This performs NO business mutation and
   * does not "finalise" anything beyond recording the export request.
   */
  async requestExport(
    ctx: RequestContext,
    queryId: string,
  ): Promise<{ response: ResponseRow; citations: CitationRow[] }> {
    await this.authz.require(ctx, M28_PERMISSIONS.copilotExport);
    return this.db.withTenant(ctx, async (tx) => {
      const response = await this.repo.findResponseByQuery(tx, queryId);
      if (response === null) throw ProblemError.notFound('Response not found.', ctx.correlationId);
      if (response.status !== 'complete')
        throw governanceForbidden(REASON_CODES.exportHumanReviewRequired, ctx.correlationId);
      const citations = await this.repo.listCitations(tx, response.id);
      await this.emitter.recordAudit(tx, ctx, {
        code: M28_AUDIT_CODES.exportRequested,
        entityType: 'copilot_response',
        entityId: response.id,
        detail: { citationCount: citations.length, confidenceBps: response.confidence_bps },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M28_AUDIT_CODES.citationAccessed,
        entityType: 'copilot_response',
        entityId: response.id,
        detail: { citationCount: citations.length },
      });
      return { response, citations };
    });
  }
}
