/**
 * DocumentService — documents and their immutable versions (prompt §E1-E6, §E23). Create resolves the ACTIVE
 * document type, validates typed metadata, defaults classification, and is idempotent. The upload flow is
 * server-verified: initiate creates a PENDING version with a storage reference; complete reads the object's
 * ACTUAL hash + size from the storage port and rejects any mismatch (a client cannot claim completion),
 * scans it, then commits the immutable version; activate promotes a committed+clean version to the one ACTIVE
 * version and supersedes the prior. Classification downgrades require platform authority (ADR-049). Every step
 * is permissioned, audited, and emits document.lifecycle through the m06 outbox. Content bytes never touch
 * PostgreSQL; downloads are server-mediated (ADR-045/046).
 */
import { randomUUID } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M09_PERMISSIONS } from './permissions.ts';
import { M09_AUDIT_CODES } from './audit-codes.ts';
import { checkDocumentTransition, isDocumentTerminal } from './domain/lifecycles.ts';
import {
  requireFilename,
  validateMediaType,
  requireByteSize,
  requireContentHash,
  verifyUpload,
} from './domain/content.ts';
import { validateMetadata } from './domain/metadata.ts';
import { isClassification, isDowngrade, DocError, type Classification } from './domain/limits.ts';
import { earliestDispositionMs, isExpired } from './domain/retention.ts';
import type { DocumentTypeSpec, RetentionPolicySpec } from './domain/doctype.ts';
import { type DocsRepository, type DocumentRow, type VersionRow, type ScanResultRow } from './repository.ts';
import type { M09Emitter } from './emit.ts';
import type { DocumentStorage } from './storage.ts';
import { scanPermitsRelease, type ContentScanner } from './scan.ts';
import { badRequest, invalidMetadata } from './errors.ts';

export interface CreateDocumentInput {
  code: string;
  title: string;
  description?: string | null;
  documentType: string;
  classification?: string;
  sensitivity?: string | null;
  ownerId?: string | null;
  custodianId?: string | null;
  metadata?: Readonly<Record<string, unknown>>;
  effectiveAt?: string | null;
  expiresAt?: string | null;
  idempotencyKey?: string | null;
  originModule?: string | null;
  originEntityType?: string | null;
  originEntityId?: string | null;
  causationId?: string | null;
}

export class DocumentService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M09Emitter;
  private readonly repo: DocsRepository;
  private readonly storage: DocumentStorage;
  private readonly scanner: ContentScanner;

  constructor(
    db: Db,
    authz: Authz,
    emitter: M09Emitter,
    repo: DocsRepository,
    storage: DocumentStorage,
    scanner: ContentScanner,
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.storage = storage;
    this.scanner = scanner;
  }

  async create(ctx: RequestContext, actor: string | null, input: CreateDocumentInput): Promise<DocumentRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.documentCreate);
    return this.db.withTenant(ctx, async (tx) => {
      const typeRow = await this.repo.findActiveType(tx, input.documentType);
      if (typeRow === null)
        throw ProblemError.conflict('No ACTIVE document type for that code.', ctx.correlationId);
      const spec = typeRow.spec as DocumentTypeSpec;
      const metaRes = validateMetadata(spec.requiredMetadata, input.metadata ?? {});
      if (!metaRes.ok) throw invalidMetadata(metaRes.errors, ctx.correlationId);
      let classification: Classification = spec.defaultClassification as Classification;
      if (input.classification !== undefined) {
        if (!isClassification(input.classification))
          throw badRequest('invalid classification', ctx.correlationId);
        classification = input.classification;
      }
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findDocumentByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) {
          if (existing.code !== input.code || existing.document_type !== input.documentType) {
            throw ProblemError.conflict(
              'Idempotency key reused with a different payload.',
              ctx.correlationId,
            );
          }
          return existing;
        }
      }
      const doc = await this.repo.insertDocument(tx, {
        tenantId: ctx.tenantId,
        code: input.code,
        title: input.title,
        description: input.description ?? null,
        documentType: input.documentType,
        classification,
        sensitivity: input.sensitivity ?? null,
        ownerId: input.ownerId ?? actor,
        custodianId: input.custodianId ?? null,
        metadata: metaRes.values,
        retentionPolicyCode: spec.retentionPolicyCode ?? null,
        effectiveAt: input.effectiveAt ?? null,
        expiresAt: input.expiresAt ?? null,
        originModule: input.originModule ?? null,
        originEntityType: input.originEntityType ?? null,
        originEntityId: input.originEntityId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        causationId: input.causationId ?? null,
        createdBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.documentCreated,
        entityType: 'document',
        entityId: doc.id,
        detail: { code: input.code, documentType: input.documentType, classification },
      });
      await this.emitter.publish(tx, {
        type: 'DocumentCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          documentId: doc.id,
          code: input.code,
          documentType: input.documentType,
          classification,
          toStatus: 'draft',
        },
      });
      return doc;
    });
  }

  async updateMetadata(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      title: string;
      description?: string | null;
      metadata?: Readonly<Record<string, unknown>>;
    },
  ): Promise<DocumentRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.documentUpdateMetadata);
    return this.db.withTenant(ctx, async (tx) => {
      const doc = await this.repo.findDocument(tx, id);
      if (doc === null) throw ProblemError.notFound('Document not found.', ctx.correlationId);
      if (isDocumentTerminal(doc.status))
        throw ProblemError.conflict(`Document is ${doc.status}.`, ctx.correlationId);
      const typeRow = await this.repo.findActiveType(tx, doc.document_type);
      const spec = (typeRow?.spec ?? { requiredMetadata: [] }) as DocumentTypeSpec;
      const metaRes = validateMetadata(spec.requiredMetadata, input.metadata ?? {});
      if (!metaRes.ok) throw invalidMetadata(metaRes.errors, ctx.correlationId);
      const upd = await this.repo.updateDocumentMetadata(tx, {
        id,
        expectedVersion: input.expectedVersion,
        title: input.title,
        description: input.description ?? null,
        metadata: metaRes.values,
        updatedBy: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Document modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.metadataUpdated,
        entityType: 'document',
        entityId: id,
        detail: { title: input.title },
      });
      await this.emitter.publish(tx, {
        type: 'DocumentMetadataUpdated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { documentId: id },
      });
      return upd;
    });
  }

  /** Change classification; a DOWNGRADE (to a less sensitive level) requires platform authority + audit. */
  async changeClassification(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { expectedVersion: number; classification: string },
  ): Promise<DocumentRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.documentUpdateMetadata);
    if (!isClassification(input.classification))
      throw badRequest('invalid classification', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const doc = await this.repo.findDocument(tx, id);
      if (doc === null) throw ProblemError.notFound('Document not found.', ctx.correlationId);
      if (isDowngrade(doc.classification as Classification, input.classification as Classification)) {
        await this.authz.require(ctx, M09_PERMISSIONS.platformAdminister);
      }
      const upd = await this.repo.updateDocumentClassification(tx, {
        id,
        expectedVersion: input.expectedVersion,
        classification: input.classification,
        updatedBy: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Document modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.classificationChanged,
        entityType: 'document',
        entityId: id,
        detail: { from: doc.classification, to: input.classification },
      });
      return upd;
    });
  }

  /** Initiate an upload: validate media type against the document type, create a PENDING version + storage ref. */
  async initiateUpload(
    ctx: RequestContext,
    actor: string | null,
    documentId: string,
    input: {
      filename: string;
      mediaType: string;
      changeSummary?: string | null;
      source?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<{ version: VersionRow; storageRef: string; scanRequired: boolean }> {
    await this.authz.require(ctx, M09_PERMISSIONS.documentUploadVersion);
    return this.db.withTenant(ctx, async (tx) => {
      const doc = await this.repo.findDocument(tx, documentId);
      if (doc === null) throw ProblemError.notFound('Document not found.', ctx.correlationId);
      if (isDocumentTerminal(doc.status))
        throw ProblemError.conflict(`Document is ${doc.status}.`, ctx.correlationId);
      const typeRow = await this.repo.findActiveType(tx, doc.document_type);
      if (typeRow === null) throw ProblemError.conflict('Document type is not ACTIVE.', ctx.correlationId);
      const spec = typeRow.spec as DocumentTypeSpec;
      const filenameNorm = requireFilename(input.filename);
      let mediaType: string;
      try {
        mediaType = validateMediaType(input.mediaType, spec.allowedMediaTypes);
      } catch (e) {
        throw badRequest(e instanceof DocError ? e.message : 'invalid media type', ctx.correlationId);
      }
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findVersionByIdempotencyKey(tx, documentId, input.idempotencyKey);
        if (existing !== null)
          return { version: existing, storageRef: existing.storage_ref, scanRequired: spec.scanRequired };
      }
      const next = await this.repo.nextVersionNumber(tx, documentId);
      const storageRef = `doc/${documentId}/v${String(next)}/${randomUUID()}`;
      const version = await this.repo.insertPendingVersion(tx, {
        tenantId: ctx.tenantId,
        documentId,
        versionNumber: next,
        storageRef,
        storageCode: this.storage.code,
        filename: input.filename.trim(),
        filenameNorm,
        mediaType,
        changeSummary: input.changeSummary ?? null,
        source: input.source ?? null,
        scanStatus: 'pending',
        idempotencyKey: input.idempotencyKey ?? null,
        createdBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.versionInitiated,
        entityType: 'document_version',
        entityId: version.id,
        detail: { versionNumber: next, mediaType },
      });
      await this.emitter.publish(tx, {
        type: 'DocumentVersionInitiated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { documentId, versionId: version.id, versionNumber: next, toStatus: 'pending' },
      });
      return { version, storageRef, scanRequired: spec.scanRequired };
    });
  }

  /** Complete an upload: verify the object's ACTUAL hash + size against the claim, scan, then commit the version. */
  async completeUpload(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    input: { expectedVersion: number; contentHash: string; byteSize: number },
  ): Promise<{ version: VersionRow; scan: ScanResultRow }> {
    await this.authz.require(ctx, M09_PERMISSIONS.documentUploadVersion);
    const claimedHash = requireContentHash(input.contentHash);
    const claimedSize = requireByteSize(input.byteSize);
    // Read the object's server-side truth OUTSIDE the tx (adapter I/O), then commit atomically.
    const version0 = await this.db.withTenant(ctx, (tx) => this.repo.findVersion(tx, versionId));
    if (version0 === null) throw ProblemError.notFound('Version not found.', ctx.correlationId);
    if (version0.status !== 'pending')
      throw ProblemError.conflict('Version is not pending.', ctx.correlationId);
    const observed = await this.storage.head(version0.storage_ref);
    if (observed === null) throw badRequest('no uploaded object found for this version', ctx.correlationId);
    try {
      verifyUpload({ contentHash: claimedHash, byteSize: claimedSize }, observed);
    } catch (e) {
      throw ProblemError.conflict(
        e instanceof DocError ? e.message : 'upload verification failed',
        ctx.correlationId,
      );
    }
    const scan = await this.scanner.scan(version0.storage_ref);
    return this.db.withTenant(ctx, async (tx) => {
      const committed = await this.repo.commitVersion(tx, {
        id: versionId,
        expectedVersion: input.expectedVersion,
        contentHash: observed.contentHash,
        byteSize: observed.byteSize,
        scanStatus: scan.status,
      });
      if (committed === null)
        throw ProblemError.conflict('Version changed concurrently (stale version).', ctx.correlationId);
      const scanRow = await this.repo.insertScanResult(tx, {
        tenantId: ctx.tenantId,
        documentId: committed.document_id,
        versionId,
        status: scan.status,
        scannerCode: scan.scannerCode,
        signature: scan.signature ?? null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.versionCompleted,
        entityType: 'document_version',
        entityId: versionId,
        detail: { byteSize: observed.byteSize },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code:
          scan.status === 'infected' || scan.status === 'failed'
            ? M09_AUDIT_CODES.scanFailed
            : M09_AUDIT_CODES.scanCompleted,
        entityType: 'document_version',
        entityId: versionId,
        detail: { scanStatus: scan.status },
      });
      await this.emitter.publish(tx, {
        type: 'DocumentVersionCompleted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          documentId: committed.document_id,
          versionId,
          contentHash: observed.contentHash,
          toStatus: 'committed',
        },
      });
      await this.emitter.publish(tx, {
        type: scanPermitsRelease(scan.status) ? 'DocumentScanCompleted' : 'DocumentScanFailed',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        payload: { documentId: committed.document_id, versionId, toStatus: scan.status },
      });
      return { version: committed, scan: scanRow };
    });
  }

  /** Activate a committed+clean version as the one ACTIVE version; supersede the prior; set retention anchor. */
  async activateVersion(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    input: { expectedVersion: number },
  ): Promise<VersionRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.documentActivate);
    return this.db.withTenant(ctx, async (tx) => {
      const version = await this.repo.findVersion(tx, versionId);
      if (version === null) throw ProblemError.notFound('Version not found.', ctx.correlationId);
      if (version.status !== 'committed')
        throw ProblemError.conflict(`Version is ${version.status}, not committed.`, ctx.correlationId);
      if (!scanPermitsRelease(version.scan_status as 'clean'))
        throw ProblemError.conflict(
          `Version scan status ${version.scan_status} blocks activation.`,
          ctx.correlationId,
        );
      const activated = await this.repo.activateVersion(tx, {
        id: versionId,
        expectedVersion: input.expectedVersion,
      });
      if (activated === null)
        throw ProblemError.conflict('Version changed concurrently (stale version).', ctx.correlationId);
      await this.repo.supersedeActiveVersions(tx, activated.document_id, versionId);
      const doc = await this.repo.findDocument(tx, activated.document_id);
      if (doc === null) throw ProblemError.notFound('Document not found.', ctx.correlationId);
      // Compute retention anchor + earliest disposition from the active retention policy (if any).
      let anchorAt: string | null = doc.retention_anchor_at;
      let earliest: string | null = null;
      if (doc.retention_policy_code !== null) {
        const rp = await this.repo.findActiveRetention(tx, doc.retention_policy_code);
        if (rp !== null) {
          const nowMs = Date.now();
          anchorAt = doc.retention_anchor_at ?? new Date(nowMs).toISOString();
          const anchorMs = Date.parse(anchorAt);
          earliest = new Date(earliestDispositionMs(rp.spec as RetentionPolicySpec, anchorMs)).toISOString();
        }
      }
      const updDoc = await this.repo.setCurrentVersion(tx, {
        id: doc.id,
        expectedVersion: doc.version,
        versionId,
        versionNumber: activated.version_number,
        retentionAnchorAt: anchorAt,
        earliestDispositionAt: earliest,
      });
      if (updDoc === null) throw ProblemError.conflict('Document changed concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.versionActivated,
        entityType: 'document_version',
        entityId: versionId,
        detail: { versionNumber: activated.version_number },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.documentActivated,
        entityType: 'document',
        entityId: doc.id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'DocumentVersionActivated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          documentId: doc.id,
          versionId,
          versionNumber: activated.version_number,
          toStatus: 'active',
        },
      });
      await this.emitter.publish(tx, {
        type: 'DocumentActivated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        payload: { documentId: doc.id, toStatus: 'active' },
      });
      return activated;
    });
  }

  private async lifecycle(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    to: string,
    permission: string,
    auditCode: string,
    eventType: 'DocumentArchived' | 'DocumentWithdrawn',
    reason: string | null,
  ): Promise<DocumentRow> {
    await this.authz.require(ctx, permission);
    return this.db.withTenant(ctx, async (tx) => {
      const doc = await this.repo.findDocument(tx, id);
      if (doc === null) throw ProblemError.notFound('Document not found.', ctx.correlationId);
      const check = checkDocumentTransition(doc.status, to);
      if (!check.ok)
        throw ProblemError.conflict(`Invalid document transition: ${check.reason ?? ''}`, ctx.correlationId);
      const upd = await this.repo.updateDocumentStatus(tx, {
        id,
        expectedVersion: doc.version,
        toStatus: to,
        updatedBy: actor,
      });
      if (upd === null) throw ProblemError.conflict('Document changed concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: 'document',
        entityId: id,
        ...(reason !== null ? { reason } : {}),
        detail: { toStatus: to },
      });
      await this.emitter.publish(tx, {
        type: eventType,
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { documentId: id, fromStatus: doc.status, toStatus: to },
      });
      return upd;
    });
  }
  archive(ctx: RequestContext, a: string | null, id: string) {
    return this.lifecycle(
      ctx,
      a,
      id,
      'archived',
      M09_PERMISSIONS.documentArchive,
      M09_AUDIT_CODES.documentArchived,
      'DocumentArchived',
      null,
    );
  }
  withdraw(ctx: RequestContext, a: string | null, id: string, reason: string | null = null) {
    return this.lifecycle(
      ctx,
      a,
      id,
      'withdrawn',
      M09_PERMISSIONS.documentWithdraw,
      M09_AUDIT_CODES.documentWithdrawn,
      'DocumentWithdrawn',
      reason,
    );
  }

  /** Authorize + server-mediate a download of the active (or a specific) version. Fails closed on scan/status. */
  async authorizeDownload(
    ctx: RequestContext,
    _actor: string | null,
    versionId: string,
  ): Promise<{ version: VersionRow; bytes: Uint8Array }> {
    await this.authz.require(ctx, M09_PERMISSIONS.documentDownload);
    const version = await this.db.withTenant(ctx, (tx) => this.repo.findVersion(tx, versionId));
    if (version === null) throw ProblemError.notFound('Version not found.', ctx.correlationId);
    const doc = await this.db.withTenant(ctx, (tx) => this.repo.findDocument(tx, version.document_id));
    if (doc === null) throw ProblemError.notFound('Document not found.', ctx.correlationId);
    if (doc.status === 'withdrawn' || doc.status === 'disposed')
      throw ProblemError.conflict(`Document is ${doc.status}.`, ctx.correlationId);
    if (version.status === 'pending')
      throw ProblemError.conflict('Version is not available for download.', ctx.correlationId);
    if (!scanPermitsRelease(version.scan_status as 'clean'))
      throw ProblemError.conflict('Version has not passed scanning.', ctx.correlationId);
    if (isExpired(doc.expires_at === null ? null : Date.parse(doc.expires_at), Date.now()))
      throw ProblemError.conflict('Document has expired.', ctx.correlationId);
    const bytes = await this.storage.read(version.storage_ref);
    if (bytes === null) throw ProblemError.notFound('Object not found in storage.', ctx.correlationId);
    await this.db.withTenant(ctx, (tx) =>
      this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.documentDownloaded,
        entityType: 'document_version',
        entityId: versionId,
        detail: { documentId: doc.id },
      }),
    );
    return { version, bytes };
  }

  // --- reads ------------------------------------------------------------------------------------
  async get(ctx: RequestContext, id: string): Promise<DocumentRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.documentRead);
    const doc = await this.db.withTenant(ctx, async (tx) => {
      const d = await this.repo.findDocument(tx, id);
      if (d !== null)
        await this.emitter.recordAudit(tx, ctx, {
          code: M09_AUDIT_CODES.documentAccessed,
          entityType: 'document',
          entityId: id,
          detail: {},
        });
      return d;
    });
    if (doc === null) throw ProblemError.notFound('Document not found.', ctx.correlationId);
    return doc;
  }
  async listVersions(ctx: RequestContext, documentId: string): Promise<VersionRow[]> {
    await this.authz.require(ctx, M09_PERMISSIONS.documentRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listVersions(tx, documentId));
  }
  async search(
    ctx: RequestContext,
    filters: {
      documentType?: string;
      status?: string;
      classification?: string;
      ownerId?: string;
      originModule?: string;
      codeLike?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<DocumentRow[]> {
    await this.authz.require(ctx, M09_PERMISSIONS.documentRead);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.searchDocuments(tx, {
        ...filters,
        limit: Math.min(filters.limit ?? 50, 200),
        offset: filters.offset ?? 0,
      }),
    );
  }
  async scanResults(ctx: RequestContext, versionId: string): Promise<ScanResultRow[]> {
    await this.authz.require(ctx, M09_PERMISSIONS.documentRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listScanResults(tx, versionId));
  }
}
