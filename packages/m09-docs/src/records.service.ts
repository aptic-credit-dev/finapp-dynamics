/**
 * RecordsService — legal hold and controlled disposition (prompt §E12-E14). The overriding invariant: an active
 * legal hold ALWAYS blocks disposal, and retention expiry can never override it (ADR-050). Disposal is never
 * automatic: it requires a request, then explicit PRIVILEGED approval by someone OTHER than the requester
 * (maker≠checker), then execution which purges the object bytes but leaves a TOMBSTONE (the document row is set
 * `disposed` and the disposition evidence row remains). Every step is permissioned, audited, and emits.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M09_PERMISSIONS } from './permissions.ts';
import { M09_AUDIT_CODES } from './audit-codes.ts';
import { checkDispositionTransition, isDocumentTerminal } from './domain/lifecycles.ts';
import { assertNotHeld, evaluateDisposition, type DispositionEligibility } from './domain/retention.ts';
import { DocError } from './domain/limits.ts';
import { type DocsRepository, type DispositionRow, type LegalHoldRow } from './repository.ts';
import type { M09Emitter } from './emit.ts';
import type { DocumentStorage } from './storage.ts';
import { badRequest } from './errors.ts';

const PG_UNIQUE_VIOLATION = '23505';
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === PG_UNIQUE_VIOLATION;
}

export class RecordsService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M09Emitter;
  private readonly repo: DocsRepository;
  private readonly storage: DocumentStorage;

  constructor(db: Db, authz: Authz, emitter: M09Emitter, repo: DocsRepository, storage: DocumentStorage) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.storage = storage;
  }

  // --- legal hold -------------------------------------------------------------------------------
  async placeLegalHold(
    ctx: RequestContext,
    actor: string | null,
    documentId: string,
    reason: string,
  ): Promise<LegalHoldRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.legalHoldManage);
    if (reason.trim() === '')
      throw badRequest('a reason is required to place a legal hold', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const doc = await this.repo.findDocument(tx, documentId);
      if (doc === null) throw ProblemError.notFound('Document not found.', ctx.correlationId);
      let hold: LegalHoldRow;
      try {
        hold = await this.repo.insertHold(tx, {
          tenantId: ctx.tenantId,
          documentId,
          reason,
          placedBy: actor,
        });
      } catch (e) {
        if (isUniqueViolation(e))
          throw ProblemError.conflict(
            'The document is already under an active legal hold.',
            ctx.correlationId,
          );
        throw e;
      }
      const upd = await this.repo.setLegalHold(tx, {
        id: documentId,
        expectedVersion: doc.version,
        legalHold: true,
        updatedBy: actor,
      });
      if (upd === null) throw ProblemError.conflict('Document changed concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.legalHoldPlaced,
        entityType: 'document_legal_hold',
        entityId: hold.id,
        reason,
        detail: { documentId },
      });
      await this.emitter.publish(tx, {
        type: 'DocumentLegalHoldPlaced',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { documentId, reason },
      });
      return hold;
    });
  }

  async releaseLegalHold(
    ctx: RequestContext,
    actor: string | null,
    holdId: string,
    expectedVersion: number,
    reason: string | null = null,
  ): Promise<LegalHoldRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.legalHoldManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.releaseHold(tx, {
        id: holdId,
        expectedVersion,
        releasedBy: actor,
        releaseReason: reason,
      });
      if (upd === null)
        throw ProblemError.conflict('Hold already released or modified concurrently.', ctx.correlationId);
      // Clear the document flag only if no other active hold remains.
      const other = await this.repo.findActiveHold(tx, upd.document_id);
      if (other === null) {
        const doc = await this.repo.findDocument(tx, upd.document_id);
        if (doc !== null)
          await this.repo.setLegalHold(tx, {
            id: doc.id,
            expectedVersion: doc.version,
            legalHold: false,
            updatedBy: actor,
          });
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.legalHoldReleased,
        entityType: 'document_legal_hold',
        entityId: holdId,
        ...(reason !== null ? { reason } : {}),
        detail: { documentId: upd.document_id },
      });
      await this.emitter.publish(tx, {
        type: 'DocumentLegalHoldReleased',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { documentId: upd.document_id },
      });
      return upd;
    });
  }

  // --- disposition ------------------------------------------------------------------------------
  /** Assess whether a document may enter disposition (retention passed + no hold). PURE decision surfaced. */
  async assessDisposition(ctx: RequestContext, documentId: string): Promise<DispositionEligibility> {
    await this.authz.require(ctx, M09_PERMISSIONS.dispositionRead);
    return this.db.withTenant(ctx, async (tx) => {
      const doc = await this.repo.findDocument(tx, documentId);
      if (doc === null) throw ProblemError.notFound('Document not found.', ctx.correlationId);
      const earliest =
        doc.earliest_disposition_at === null
          ? Number.POSITIVE_INFINITY
          : Date.parse(doc.earliest_disposition_at);
      return evaluateDisposition({
        earliestDispositionMs: earliest,
        nowMs: Date.now(),
        legalHold: doc.legal_hold,
      });
    });
  }

  async requestDisposition(
    ctx: RequestContext,
    actor: string | null,
    documentId: string,
    input: { action: string; reason?: string | null; idempotencyKey?: string | null },
  ): Promise<DispositionRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.dispositionRequest);
    if (!['review', 'archive', 'destroy'].includes(input.action))
      throw badRequest('invalid disposition action', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const doc = await this.repo.findDocument(tx, documentId);
      if (doc === null) throw ProblemError.notFound('Document not found.', ctx.correlationId);
      if (doc.legal_hold)
        throw ProblemError.conflict('An active legal hold blocks disposition.', ctx.correlationId);
      if (isDocumentTerminal(doc.status))
        throw ProblemError.conflict(`Document is ${doc.status}.`, ctx.correlationId);
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findDispositionByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const disp = await this.repo.insertDisposition(tx, {
        tenantId: ctx.tenantId,
        documentId,
        action: input.action,
        reason: input.reason ?? null,
        status: 'pending_review',
        idempotencyKey: input.idempotencyKey ?? null,
        requestedBy: actor,
        correlationId: ctx.correlationId,
      });
      await this.repo.setDispositionStatus(tx, {
        id: documentId,
        expectedVersion: doc.version,
        dispositionStatus: 'pending_review',
        updatedBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.dispositionRequested,
        entityType: 'document_disposition',
        entityId: disp.id,
        detail: { documentId, action: input.action },
      });
      await this.emitter.publish(tx, {
        type: 'DocumentDispositionRequested',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { documentId, toStatus: 'pending_review' },
      });
      return disp;
    });
  }

  async approveDisposition(
    ctx: RequestContext,
    actor: string | null,
    dispositionId: string,
    expectedVersion: number,
  ): Promise<DispositionRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.dispositionApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const disp = await this.repo.findDisposition(tx, dispositionId);
      if (disp === null) throw ProblemError.notFound('Disposition not found.', ctx.correlationId);
      // Segregation of duties: the approver must not be the requester (maker != checker).
      if (disp.requested_by !== null && actor !== null && disp.requested_by === actor) {
        throw ProblemError.conflict(
          'The requester of a disposition cannot approve it (segregation of duties).',
          ctx.correlationId,
        );
      }
      const doc = await this.repo.findDocument(tx, disp.document_id);
      if (doc?.legal_hold === true)
        throw ProblemError.conflict('An active legal hold blocks disposition.', ctx.correlationId);
      const check = checkDispositionTransition(disp.status, 'approved');
      if (!check.ok)
        throw ProblemError.conflict(
          `Invalid disposition transition: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateDispositionStatus(tx, {
        id: dispositionId,
        expectedVersion,
        toStatus: 'approved',
        approvedBy: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Disposition modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.dispositionApproved,
        entityType: 'document_disposition',
        entityId: dispositionId,
        detail: {},
      });
      return upd;
    });
  }

  async rejectDisposition(
    ctx: RequestContext,
    actor: string | null,
    dispositionId: string,
    expectedVersion: number,
    reason: string | null = null,
  ): Promise<DispositionRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.dispositionApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const disp = await this.repo.findDisposition(tx, dispositionId);
      if (disp === null) throw ProblemError.notFound('Disposition not found.', ctx.correlationId);
      const check = checkDispositionTransition(disp.status, 'rejected');
      if (!check.ok)
        throw ProblemError.conflict(
          `Invalid disposition transition: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateDispositionStatus(tx, {
        id: dispositionId,
        expectedVersion,
        toStatus: 'rejected',
      });
      if (upd === null)
        throw ProblemError.conflict('Disposition modified concurrently (stale version).', ctx.correlationId);
      const doc = await this.repo.findDocument(tx, disp.document_id);
      if (doc !== null)
        await this.repo.setDispositionStatus(tx, {
          id: doc.id,
          expectedVersion: doc.version,
          dispositionStatus: 'rejected',
          updatedBy: actor,
        });
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.dispositionRejected,
        entityType: 'document_disposition',
        entityId: dispositionId,
        ...(reason !== null ? { reason } : {}),
        detail: {},
      });
      return upd;
    });
  }

  /** Execute an APPROVED disposition: fail closed on a hold, purge object bytes, leave a tombstone (document
   *  set `disposed`; the disposition + version rows remain as evidence). */
  async executeDisposition(
    ctx: RequestContext,
    actor: string | null,
    dispositionId: string,
    expectedVersion: number,
  ): Promise<DispositionRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.dispositionExecute);
    // Load first (own tx) so we can purge object bytes outside the DB tx, then finalize atomically.
    const disp0 = await this.db.withTenant(ctx, (tx) => this.repo.findDisposition(tx, dispositionId));
    if (disp0 === null) throw ProblemError.notFound('Disposition not found.', ctx.correlationId);
    if (disp0.status !== 'approved')
      throw ProblemError.conflict('Only an approved disposition can be executed.', ctx.correlationId);
    const doc0 = await this.db.withTenant(ctx, (tx) => this.repo.findDocument(tx, disp0.document_id));
    if (doc0 === null) throw ProblemError.notFound('Document not found.', ctx.correlationId);
    try {
      assertNotHeld(doc0.legal_hold);
    } catch (e) {
      throw ProblemError.conflict(
        e instanceof DocError ? e.message : 'legal hold blocks disposal',
        ctx.correlationId,
      );
    }
    // Purge object bytes for every version (a tombstone row remains in the DB).
    const versions = await this.db.withTenant(ctx, (tx) => this.repo.listVersions(tx, disp0.document_id));
    for (const v of versions) await this.storage.purge(v.storage_ref);

    return this.db.withTenant(ctx, async (tx) => {
      const doc = await this.repo.findDocument(tx, disp0.document_id);
      if (doc === null) throw ProblemError.notFound('Document not found.', ctx.correlationId);
      if (doc.legal_hold)
        throw ProblemError.conflict('An active legal hold blocks disposal.', ctx.correlationId);
      const check = checkDispositionTransition(disp0.status, 'disposed');
      if (!check.ok)
        throw ProblemError.conflict(
          `Invalid disposition transition: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateDispositionStatus(tx, {
        id: dispositionId,
        expectedVersion,
        toStatus: 'disposed',
        disposedBy: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Disposition modified concurrently (stale version).', ctx.correlationId);
      const docUpd = await this.repo.updateDocumentStatus(tx, {
        id: doc.id,
        expectedVersion: doc.version,
        toStatus: 'disposed',
        updatedBy: actor,
      });
      if (docUpd === null) throw ProblemError.conflict('Document changed concurrently.', ctx.correlationId);
      await this.repo.setDispositionStatus(tx, {
        id: doc.id,
        expectedVersion: docUpd.version,
        dispositionStatus: 'disposed',
        updatedBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.dispositionCompleted,
        entityType: 'document_disposition',
        entityId: dispositionId,
        detail: { documentId: doc.id, versionsPurged: versions.length },
      });
      await this.emitter.publish(tx, {
        type: 'DocumentDisposed',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { documentId: doc.id, toStatus: 'disposed' },
      });
      return upd;
    });
  }

  async getDisposition(ctx: RequestContext, id: string): Promise<DispositionRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.dispositionRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findDisposition(tx, id));
    if (r === null) throw ProblemError.notFound('Disposition not found.', ctx.correlationId);
    return r;
  }
  async getActiveHold(ctx: RequestContext, documentId: string): Promise<LegalHoldRow | null> {
    await this.authz.require(ctx, M09_PERMISSIONS.legalHoldRead);
    return this.db.withTenant(ctx, (tx) => this.repo.findActiveHold(tx, documentId));
  }
}
