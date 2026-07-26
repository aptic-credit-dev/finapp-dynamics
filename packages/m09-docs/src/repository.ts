/**
 * M09 repository — ALL SQL for documents & records. Every query is parameterized; every mutating UPDATE is
 * optimistic-lock guarded (`WHERE ... AND version = $expected`) or a compare-and-set claim, so a stale/losing
 * command changes zero rows and the caller reacts. Queries carry NO tenant_id predicate: RLS is the isolation
 * guarantee. All methods take the caller's `Tx` so state, evidence, audit and outbox commit atomically. Scan
 * evidence is append-only (INSERT+SELECT by grant); no table grants DELETE.
 */
import type { Tx } from '@finapp/kernel';

export interface SpecRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly version_number: number;
  readonly name: string;
  readonly scope: string;
  readonly status: string;
  readonly spec: unknown;
  readonly content_hash: string | null;
  readonly version: number;
}

export interface DocumentRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly description: string | null;
  readonly document_type: string;
  readonly classification: string;
  readonly sensitivity: string | null;
  readonly status: string;
  readonly owner_id: string | null;
  readonly custodian_id: string | null;
  readonly current_version_id: string | null;
  readonly current_version_number: number;
  readonly metadata: unknown;
  readonly retention_policy_code: string | null;
  readonly retention_anchor_at: string | null;
  readonly earliest_disposition_at: string | null;
  readonly disposition_status: string | null;
  readonly legal_hold: boolean;
  readonly effective_at: string | null;
  readonly expires_at: string | null;
  readonly origin_module: string | null;
  readonly origin_entity_type: string | null;
  readonly origin_entity_id: string | null;
  readonly correlation_id: string;
  readonly version: number;
}

export interface VersionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly document_id: string;
  readonly version_number: number;
  readonly status: string;
  readonly storage_ref: string;
  readonly storage_code: string;
  readonly filename: string;
  readonly filename_norm: string;
  readonly media_type: string;
  readonly byte_size: string | null;
  readonly content_hash: string | null;
  readonly change_summary: string | null;
  readonly source: string | null;
  readonly scan_status: string;
  readonly version: number;
}

export interface AccessGrantRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly document_id: string;
  readonly grantee_kind: string;
  readonly grantee_ref: string;
  readonly access_level: string;
  readonly status: string;
  readonly version: number;
}

export interface CheckoutRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly document_id: string;
  readonly checked_out_by: string;
  readonly expected_version: number;
  readonly expires_at: string;
  readonly released_at: string | null;
  readonly forced: boolean;
  readonly version: number;
}

export interface RelationshipRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly from_document_id: string;
  readonly to_document_id: string;
  readonly relationship_type: string;
  readonly status: string;
  readonly version: number;
}

export interface LegalHoldRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly document_id: string;
  readonly status: string;
  readonly reason: string;
  readonly version: number;
}

export interface DispositionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly document_id: string;
  readonly status: string;
  readonly action: string;
  readonly reason: string | null;
  readonly idempotency_key: string | null;
  readonly requested_by: string | null;
  readonly version: number;
}

export interface ScanResultRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly document_id: string;
  readonly version_id: string;
  readonly status: string;
  readonly scanner_code: string;
  readonly signature: string | null;
}

const SPEC_COLS = 'tenant_id, id, code, version_number, name, scope, status, spec, content_hash, version';
const DOC_COLS =
  'tenant_id, id, code, title, description, document_type, classification, sensitivity, status, owner_id, ' +
  'custodian_id, current_version_id, current_version_number, metadata, retention_policy_code, ' +
  'retention_anchor_at, earliest_disposition_at, disposition_status, legal_hold, effective_at, expires_at, ' +
  'origin_module, origin_entity_type, origin_entity_id, correlation_id, version';
const VER_COLS =
  'tenant_id, id, document_id, version_number, status, storage_ref, storage_code, filename, filename_norm, ' +
  'media_type, byte_size, content_hash, change_summary, source, scan_status, version';
const GRANT_COLS = 'tenant_id, id, document_id, grantee_kind, grantee_ref, access_level, status, version';
const CHECKOUT_COLS =
  'tenant_id, id, document_id, checked_out_by, expected_version, expires_at, released_at, forced, version';
const REL_COLS = 'tenant_id, id, from_document_id, to_document_id, relationship_type, status, version';
const HOLD_COLS = 'tenant_id, id, document_id, status, reason, version';
const DISP_COLS =
  'tenant_id, id, document_id, status, action, reason, idempotency_key, requested_by, version';
const SCAN_COLS = 'tenant_id, id, document_id, version_id, status, scanner_code, signature';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m09 repository: expected a row from ${what}`);
  return row;
}

export class DocsRepository {
  // --- specs (document_type + retention_policy share shape) -------------------------------------
  private async insertSpec(
    tx: Tx,
    table: string,
    input: {
      tenantId: string;
      code: string;
      versionNumber: number;
      name: string;
      scope: string;
      spec: unknown;
      createdBy: string | null;
    },
  ): Promise<SpecRow> {
    const r = await tx.query<SpecRow>(
      `INSERT INTO ${table} (tenant_id, code, version_number, name, scope, spec, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING ${SPEC_COLS}`,
      [
        input.tenantId,
        input.code,
        input.versionNumber,
        input.name,
        input.scope,
        JSON.stringify(input.spec),
        input.createdBy,
      ],
    );
    return firstRow(r.rows, `insert ${table}`);
  }
  private async nextSpecVersion(tx: Tx, table: string, code: string): Promise<number> {
    const r = await tx.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number),0)+1 AS next FROM ${table} WHERE code = $1`,
      [code],
    );
    return firstRow(r.rows, 'next spec version').next;
  }
  private async findSpec(tx: Tx, table: string, id: string): Promise<SpecRow | null> {
    const r = await tx.query<SpecRow>(`SELECT ${SPEC_COLS} FROM ${table} WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }
  private async findActiveSpec(tx: Tx, table: string, code: string): Promise<SpecRow | null> {
    const r = await tx.query<SpecRow>(
      `SELECT ${SPEC_COLS} FROM ${table} WHERE code = $1 AND status = 'ACTIVE'`,
      [code],
    );
    return r.rows[0] ?? null;
  }
  private async updateSpecStatus(
    tx: Tx,
    table: string,
    input: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash: string | null;
      publishedBy: string | null;
    },
  ): Promise<SpecRow | null> {
    const r = await tx.query<SpecRow>(
      `UPDATE ${table} SET status=$3, content_hash=COALESCE($4,content_hash),
         published_at = CASE WHEN $3='PUBLISHED' THEN now() ELSE published_at END,
         published_by = COALESCE($5, published_by), version = version + 1
       WHERE id=$1 AND version=$2 RETURNING ${SPEC_COLS}`,
      [input.id, input.expectedVersion, input.toStatus, input.contentHash, input.publishedBy],
    );
    return r.rows[0] ?? null;
  }
  private async retireActiveSpec(tx: Tx, table: string, code: string, exceptId: string): Promise<void> {
    await tx.query(
      `UPDATE ${table} SET status='RETIRED', version=version+1 WHERE code=$1 AND status='ACTIVE' AND id<>$2`,
      [code, exceptId],
    );
  }
  private async listSpecs(tx: Tx, table: string): Promise<SpecRow[]> {
    const r = await tx.query<SpecRow>(`SELECT ${SPEC_COLS} FROM ${table} ORDER BY code, version_number`);
    return r.rows;
  }

  // document_type
  insertType(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      versionNumber: number;
      name: string;
      scope: string;
      spec: unknown;
      createdBy: string | null;
    },
  ) {
    return this.insertSpec(tx, 'document_type', i);
  }
  nextTypeVersion(tx: Tx, code: string) {
    return this.nextSpecVersion(tx, 'document_type', code);
  }
  findType(tx: Tx, id: string) {
    return this.findSpec(tx, 'document_type', id);
  }
  findActiveType(tx: Tx, code: string) {
    return this.findActiveSpec(tx, 'document_type', code);
  }
  updateTypeStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash: string | null;
      publishedBy: string | null;
    },
  ) {
    return this.updateSpecStatus(tx, 'document_type', i);
  }
  retireActiveTypes(tx: Tx, code: string, exceptId: string) {
    return this.retireActiveSpec(tx, 'document_type', code, exceptId);
  }
  listTypes(tx: Tx) {
    return this.listSpecs(tx, 'document_type');
  }

  // retention_policy
  insertRetention(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      versionNumber: number;
      name: string;
      scope: string;
      spec: unknown;
      createdBy: string | null;
    },
  ) {
    return this.insertSpec(tx, 'retention_policy', i);
  }
  nextRetentionVersion(tx: Tx, code: string) {
    return this.nextSpecVersion(tx, 'retention_policy', code);
  }
  findRetention(tx: Tx, id: string) {
    return this.findSpec(tx, 'retention_policy', id);
  }
  findActiveRetention(tx: Tx, code: string) {
    return this.findActiveSpec(tx, 'retention_policy', code);
  }
  updateRetentionStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash: string | null;
      publishedBy: string | null;
    },
  ) {
    return this.updateSpecStatus(tx, 'retention_policy', i);
  }
  retireActiveRetentions(tx: Tx, code: string, exceptId: string) {
    return this.retireActiveSpec(tx, 'retention_policy', code, exceptId);
  }
  listRetentions(tx: Tx) {
    return this.listSpecs(tx, 'retention_policy');
  }

  // --- documents --------------------------------------------------------------------------------
  async insertDocument(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      title: string;
      description: string | null;
      documentType: string;
      classification: string;
      sensitivity: string | null;
      ownerId: string | null;
      custodianId: string | null;
      metadata: unknown;
      retentionPolicyCode: string | null;
      effectiveAt: string | null;
      expiresAt: string | null;
      originModule: string | null;
      originEntityType: string | null;
      originEntityId: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      causationId: string | null;
      createdBy: string | null;
    },
  ): Promise<DocumentRow> {
    const r = await tx.query<DocumentRow>(
      `INSERT INTO document (tenant_id, code, title, description, document_type, classification, sensitivity,
         owner_id, custodian_id, metadata, retention_policy_code, effective_at, expires_at, origin_module,
         origin_entity_type, origin_entity_id, idempotency_key, correlation_id, causation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20)
       RETURNING ${DOC_COLS}`,
      [
        i.tenantId,
        i.code,
        i.title,
        i.description,
        i.documentType,
        i.classification,
        i.sensitivity,
        i.ownerId,
        i.custodianId,
        JSON.stringify(i.metadata),
        i.retentionPolicyCode,
        i.effectiveAt,
        i.expiresAt,
        i.originModule,
        i.originEntityType,
        i.originEntityId,
        i.idempotencyKey,
        i.correlationId,
        i.causationId,
        i.createdBy,
      ],
    );
    return firstRow(r.rows, 'insert document');
  }
  async findDocument(tx: Tx, id: string): Promise<DocumentRow | null> {
    const r = await tx.query<DocumentRow>(`SELECT ${DOC_COLS} FROM document WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }
  async findDocumentByIdempotencyKey(tx: Tx, key: string): Promise<DocumentRow | null> {
    const r = await tx.query<DocumentRow>(`SELECT ${DOC_COLS} FROM document WHERE idempotency_key = $1`, [
      key,
    ]);
    return r.rows[0] ?? null;
  }
  async updateDocumentMetadata(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      title: string;
      description: string | null;
      metadata: unknown;
      updatedBy: string | null;
    },
  ): Promise<DocumentRow | null> {
    const r = await tx.query<DocumentRow>(
      `UPDATE document SET title=$3, description=$4, metadata=$5::jsonb, updated_by=$6, updated_at=now(), version=version+1
       WHERE id=$1 AND version=$2 RETURNING ${DOC_COLS}`,
      [i.id, i.expectedVersion, i.title, i.description, JSON.stringify(i.metadata), i.updatedBy],
    );
    return r.rows[0] ?? null;
  }
  async updateDocumentClassification(
    tx: Tx,
    i: { id: string; expectedVersion: number; classification: string; updatedBy: string | null },
  ): Promise<DocumentRow | null> {
    const r = await tx.query<DocumentRow>(
      `UPDATE document SET classification=$3, updated_by=$4, updated_at=now(), version=version+1
       WHERE id=$1 AND version=$2 RETURNING ${DOC_COLS}`,
      [i.id, i.expectedVersion, i.classification, i.updatedBy],
    );
    return r.rows[0] ?? null;
  }
  async updateDocumentStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; updatedBy: string | null },
  ): Promise<DocumentRow | null> {
    const r = await tx.query<DocumentRow>(
      `UPDATE document SET status=$3, updated_by=$4, updated_at=now(), version=version+1
       WHERE id=$1 AND version=$2 RETURNING ${DOC_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.updatedBy],
    );
    return r.rows[0] ?? null;
  }
  async setCurrentVersion(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      versionId: string;
      versionNumber: number;
      retentionAnchorAt: string | null;
      earliestDispositionAt: string | null;
    },
  ): Promise<DocumentRow | null> {
    const r = await tx.query<DocumentRow>(
      `UPDATE document SET current_version_id=$3, current_version_number=$4,
         retention_anchor_at=COALESCE(retention_anchor_at,$5), earliest_disposition_at=COALESCE($6, earliest_disposition_at),
         status = CASE WHEN status='draft' THEN 'active' ELSE status END,
         updated_at=now(), version=version+1
       WHERE id=$1 AND version=$2 RETURNING ${DOC_COLS}`,
      [i.id, i.expectedVersion, i.versionId, i.versionNumber, i.retentionAnchorAt, i.earliestDispositionAt],
    );
    return r.rows[0] ?? null;
  }
  async setLegalHold(
    tx: Tx,
    i: { id: string; expectedVersion: number; legalHold: boolean; updatedBy: string | null },
  ): Promise<DocumentRow | null> {
    const r = await tx.query<DocumentRow>(
      `UPDATE document SET legal_hold=$3, updated_by=$4, updated_at=now(), version=version+1
       WHERE id=$1 AND version=$2 RETURNING ${DOC_COLS}`,
      [i.id, i.expectedVersion, i.legalHold, i.updatedBy],
    );
    return r.rows[0] ?? null;
  }
  async setDispositionStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; dispositionStatus: string; updatedBy: string | null },
  ): Promise<DocumentRow | null> {
    const r = await tx.query<DocumentRow>(
      `UPDATE document SET disposition_status=$3, updated_by=$4, updated_at=now(), version=version+1
       WHERE id=$1 AND version=$2 RETURNING ${DOC_COLS}`,
      [i.id, i.expectedVersion, i.dispositionStatus, i.updatedBy],
    );
    return r.rows[0] ?? null;
  }
  /** Safe metadata search with tenant isolation (RLS) + bounded, parameterized filters + pagination. */
  async searchDocuments(
    tx: Tx,
    f: {
      documentType?: string;
      status?: string;
      classification?: string;
      ownerId?: string;
      originModule?: string;
      codeLike?: string;
      limit: number;
      offset: number;
    },
  ): Promise<DocumentRow[]> {
    const r = await tx.query<DocumentRow>(
      `SELECT ${DOC_COLS} FROM document
       WHERE ($1::text IS NULL OR document_type=$1)
         AND ($2::text IS NULL OR status=$2)
         AND ($3::text IS NULL OR classification=$3)
         AND ($4::uuid IS NULL OR owner_id=$4)
         AND ($5::text IS NULL OR origin_module=$5)
         AND ($6::text IS NULL OR code ILIKE '%'||$6||'%')
       ORDER BY created_at DESC LIMIT $7 OFFSET $8`,
      [
        f.documentType ?? null,
        f.status ?? null,
        f.classification ?? null,
        f.ownerId ?? null,
        f.originModule ?? null,
        f.codeLike ?? null,
        f.limit,
        f.offset,
      ],
    );
    return r.rows;
  }

  // --- versions ---------------------------------------------------------------------------------
  async nextVersionNumber(tx: Tx, documentId: string): Promise<number> {
    const r = await tx.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number),0)+1 AS next FROM document_version WHERE document_id=$1`,
      [documentId],
    );
    return firstRow(r.rows, 'next version number').next;
  }
  async insertPendingVersion(
    tx: Tx,
    i: {
      tenantId: string;
      documentId: string;
      versionNumber: number;
      storageRef: string;
      storageCode: string;
      filename: string;
      filenameNorm: string;
      mediaType: string;
      changeSummary: string | null;
      source: string | null;
      scanStatus: string;
      idempotencyKey: string | null;
      createdBy: string | null;
    },
  ): Promise<VersionRow> {
    const r = await tx.query<VersionRow>(
      `INSERT INTO document_version (tenant_id, document_id, version_number, status, storage_ref, storage_code,
         filename, filename_norm, media_type, change_summary, source, scan_status, idempotency_key, created_by)
       VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${VER_COLS}`,
      [
        i.tenantId,
        i.documentId,
        i.versionNumber,
        i.storageRef,
        i.storageCode,
        i.filename,
        i.filenameNorm,
        i.mediaType,
        i.changeSummary,
        i.source,
        i.scanStatus,
        i.idempotencyKey,
        i.createdBy,
      ],
    );
    return firstRow(r.rows, 'insert pending version');
  }
  async findVersion(tx: Tx, id: string): Promise<VersionRow | null> {
    const r = await tx.query<VersionRow>(`SELECT ${VER_COLS} FROM document_version WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findVersionByIdempotencyKey(tx: Tx, documentId: string, key: string): Promise<VersionRow | null> {
    const r = await tx.query<VersionRow>(
      `SELECT ${VER_COLS} FROM document_version WHERE document_id=$1 AND idempotency_key=$2`,
      [documentId, key],
    );
    return r.rows[0] ?? null;
  }
  async listVersions(tx: Tx, documentId: string): Promise<VersionRow[]> {
    const r = await tx.query<VersionRow>(
      `SELECT ${VER_COLS} FROM document_version WHERE document_id=$1 ORDER BY version_number`,
      [documentId],
    );
    return r.rows;
  }
  /** Commit a pending version: freeze content hash + byte size + scan status. Version-guarded. */
  async commitVersion(
    tx: Tx,
    i: { id: string; expectedVersion: number; contentHash: string; byteSize: number; scanStatus: string },
  ): Promise<VersionRow | null> {
    const r = await tx.query<VersionRow>(
      `UPDATE document_version SET status='committed', content_hash=$3, byte_size=$4, scan_status=$5,
         committed_at=now(), version=version+1
       WHERE id=$1 AND version=$2 AND status='pending' RETURNING ${VER_COLS}`,
      [i.id, i.expectedVersion, i.contentHash, i.byteSize, i.scanStatus],
    );
    return r.rows[0] ?? null;
  }
  async updateVersionScan(
    tx: Tx,
    i: { id: string; expectedVersion: number; scanStatus: string },
  ): Promise<VersionRow | null> {
    const r = await tx.query<VersionRow>(
      `UPDATE document_version SET scan_status=$3, version=version+1 WHERE id=$1 AND version=$2 RETURNING ${VER_COLS}`,
      [i.id, i.expectedVersion, i.scanStatus],
    );
    return r.rows[0] ?? null;
  }
  async activateVersion(tx: Tx, i: { id: string; expectedVersion: number }): Promise<VersionRow | null> {
    const r = await tx.query<VersionRow>(
      `UPDATE document_version SET status='active', version=version+1 WHERE id=$1 AND version=$2 AND status='committed' RETURNING ${VER_COLS}`,
      [i.id, i.expectedVersion],
    );
    return r.rows[0] ?? null;
  }
  async supersedeActiveVersions(tx: Tx, documentId: string, exceptId: string): Promise<void> {
    await tx.query(
      `UPDATE document_version SET status='superseded', version=version+1 WHERE document_id=$1 AND status='active' AND id<>$2`,
      [documentId, exceptId],
    );
  }

  // --- access grants ----------------------------------------------------------------------------
  async insertGrant(
    tx: Tx,
    i: {
      tenantId: string;
      documentId: string;
      granteeKind: string;
      granteeRef: string;
      accessLevel: string;
      grantedBy: string | null;
    },
  ): Promise<AccessGrantRow> {
    const r = await tx.query<AccessGrantRow>(
      `INSERT INTO document_access_grant (tenant_id, document_id, grantee_kind, grantee_ref, access_level, granted_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${GRANT_COLS}`,
      [i.tenantId, i.documentId, i.granteeKind, i.granteeRef, i.accessLevel, i.grantedBy],
    );
    return firstRow(r.rows, 'insert access grant');
  }
  async findGrant(tx: Tx, id: string): Promise<AccessGrantRow | null> {
    const r = await tx.query<AccessGrantRow>(`SELECT ${GRANT_COLS} FROM document_access_grant WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async listGrants(tx: Tx, documentId: string): Promise<AccessGrantRow[]> {
    const r = await tx.query<AccessGrantRow>(
      `SELECT ${GRANT_COLS} FROM document_access_grant WHERE document_id=$1 ORDER BY granted_at`,
      [documentId],
    );
    return r.rows;
  }
  async revokeGrant(
    tx: Tx,
    i: { id: string; expectedVersion: number; revokedBy: string | null },
  ): Promise<AccessGrantRow | null> {
    const r = await tx.query<AccessGrantRow>(
      `UPDATE document_access_grant SET status='revoked', revoked_by=$3, revoked_at=now(), version=version+1
       WHERE id=$1 AND version=$2 AND status='active' RETURNING ${GRANT_COLS}`,
      [i.id, i.expectedVersion, i.revokedBy],
    );
    return r.rows[0] ?? null;
  }

  // --- checkout (lease) -------------------------------------------------------------------------
  async findOpenCheckout(tx: Tx, documentId: string): Promise<CheckoutRow | null> {
    const r = await tx.query<CheckoutRow>(
      `SELECT ${CHECKOUT_COLS} FROM document_checkout WHERE document_id=$1 AND released_at IS NULL`,
      [documentId],
    );
    return r.rows[0] ?? null;
  }
  /** Reclaim any expired open lease (so a fresh checkout can be acquired) — deterministic recovery. */
  async releaseExpiredCheckouts(tx: Tx, documentId: string): Promise<void> {
    await tx.query(
      `UPDATE document_checkout SET released_at=now(), version=version+1 WHERE document_id=$1 AND released_at IS NULL AND expires_at < now()`,
      [documentId],
    );
  }
  async insertCheckout(
    tx: Tx,
    i: {
      tenantId: string;
      documentId: string;
      checkedOutBy: string;
      expectedVersion: number;
      leaseSeconds: number;
    },
  ): Promise<CheckoutRow> {
    const r = await tx.query<CheckoutRow>(
      `INSERT INTO document_checkout (tenant_id, document_id, checked_out_by, expected_version, expires_at)
       VALUES ($1,$2,$3,$4, now() + make_interval(secs => $5)) RETURNING ${CHECKOUT_COLS}`,
      [i.tenantId, i.documentId, i.checkedOutBy, i.expectedVersion, i.leaseSeconds],
    );
    return firstRow(r.rows, 'insert checkout');
  }
  async releaseCheckout(
    tx: Tx,
    i: { id: string; expectedVersion: number; releasedBy: string; forced: boolean },
  ): Promise<CheckoutRow | null> {
    const r = await tx.query<CheckoutRow>(
      `UPDATE document_checkout SET released_at=now(), released_by=$3, forced=$4, version=version+1
       WHERE id=$1 AND version=$2 AND released_at IS NULL RETURNING ${CHECKOUT_COLS}`,
      [i.id, i.expectedVersion, i.releasedBy, i.forced],
    );
    return r.rows[0] ?? null;
  }

  // --- relationships ----------------------------------------------------------------------------
  async insertRelationship(
    tx: Tx,
    i: { tenantId: string; fromId: string; toId: string; type: string; createdBy: string | null },
  ): Promise<RelationshipRow> {
    const r = await tx.query<RelationshipRow>(
      `INSERT INTO document_relationship (tenant_id, from_document_id, to_document_id, relationship_type, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING ${REL_COLS}`,
      [i.tenantId, i.fromId, i.toId, i.type, i.createdBy],
    );
    return firstRow(r.rows, 'insert relationship');
  }
  async findRelationship(tx: Tx, id: string): Promise<RelationshipRow | null> {
    const r = await tx.query<RelationshipRow>(`SELECT ${REL_COLS} FROM document_relationship WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async listActiveEdgesOfType(tx: Tx, type: string): Promise<{ from: string; to: string }[]> {
    const r = await tx.query<{ from: string; to: string }>(
      `SELECT from_document_id AS from, to_document_id AS to FROM document_relationship WHERE relationship_type=$1 AND status='active'`,
      [type],
    );
    return r.rows;
  }
  async listRelationships(tx: Tx, documentId: string): Promise<RelationshipRow[]> {
    const r = await tx.query<RelationshipRow>(
      `SELECT ${REL_COLS} FROM document_relationship WHERE (from_document_id=$1 OR to_document_id=$1) AND status='active' ORDER BY created_at`,
      [documentId],
    );
    return r.rows;
  }
  async removeRelationship(
    tx: Tx,
    i: { id: string; expectedVersion: number; removedBy: string | null },
  ): Promise<RelationshipRow | null> {
    const r = await tx.query<RelationshipRow>(
      `UPDATE document_relationship SET status='removed', removed_by=$3, removed_at=now(), version=version+1
       WHERE id=$1 AND version=$2 AND status='active' RETURNING ${REL_COLS}`,
      [i.id, i.expectedVersion, i.removedBy],
    );
    return r.rows[0] ?? null;
  }

  // --- legal hold -------------------------------------------------------------------------------
  async insertHold(
    tx: Tx,
    i: { tenantId: string; documentId: string; reason: string; placedBy: string | null },
  ): Promise<LegalHoldRow> {
    const r = await tx.query<LegalHoldRow>(
      `INSERT INTO document_legal_hold (tenant_id, document_id, reason, placed_by) VALUES ($1,$2,$3,$4) RETURNING ${HOLD_COLS}`,
      [i.tenantId, i.documentId, i.reason, i.placedBy],
    );
    return firstRow(r.rows, 'insert legal hold');
  }
  async findActiveHold(tx: Tx, documentId: string): Promise<LegalHoldRow | null> {
    const r = await tx.query<LegalHoldRow>(
      `SELECT ${HOLD_COLS} FROM document_legal_hold WHERE document_id=$1 AND status='active'`,
      [documentId],
    );
    return r.rows[0] ?? null;
  }
  async releaseHold(
    tx: Tx,
    i: { id: string; expectedVersion: number; releasedBy: string | null; releaseReason: string | null },
  ): Promise<LegalHoldRow | null> {
    const r = await tx.query<LegalHoldRow>(
      `UPDATE document_legal_hold SET status='released', released_by=$3, released_at=now(), release_reason=$4, version=version+1
       WHERE id=$1 AND version=$2 AND status='active' RETURNING ${HOLD_COLS}`,
      [i.id, i.expectedVersion, i.releasedBy, i.releaseReason],
    );
    return r.rows[0] ?? null;
  }

  // --- disposition ------------------------------------------------------------------------------
  async insertDisposition(
    tx: Tx,
    i: {
      tenantId: string;
      documentId: string;
      action: string;
      reason: string | null;
      status: string;
      idempotencyKey: string | null;
      requestedBy: string | null;
      correlationId: string;
    },
  ): Promise<DispositionRow> {
    const r = await tx.query<DispositionRow>(
      `INSERT INTO document_disposition (tenant_id, document_id, action, reason, status, idempotency_key, requested_by, requested_at, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), $8) RETURNING ${DISP_COLS}`,
      [
        i.tenantId,
        i.documentId,
        i.action,
        i.reason,
        i.status,
        i.idempotencyKey,
        i.requestedBy,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert disposition');
  }
  async findDisposition(tx: Tx, id: string): Promise<DispositionRow | null> {
    const r = await tx.query<DispositionRow>(`SELECT ${DISP_COLS} FROM document_disposition WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async findDispositionByIdempotencyKey(tx: Tx, key: string): Promise<DispositionRow | null> {
    const r = await tx.query<DispositionRow>(
      `SELECT ${DISP_COLS} FROM document_disposition WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async updateDispositionStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      approvedBy?: string | null;
      disposedBy?: string | null;
    },
  ): Promise<DispositionRow | null> {
    const r = await tx.query<DispositionRow>(
      `UPDATE document_disposition SET status=$3,
         approved_by=COALESCE($4, approved_by), approved_at = CASE WHEN $4 IS NOT NULL THEN now() ELSE approved_at END,
         disposed_by=COALESCE($5, disposed_by), disposed_at = CASE WHEN $5 IS NOT NULL THEN now() ELSE disposed_at END,
         version=version+1
       WHERE id=$1 AND version=$2 RETURNING ${DISP_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.approvedBy ?? null, i.disposedBy ?? null],
    );
    return r.rows[0] ?? null;
  }

  // --- scan results (append-only) ---------------------------------------------------------------
  async insertScanResult(
    tx: Tx,
    i: {
      tenantId: string;
      documentId: string;
      versionId: string;
      status: string;
      scannerCode: string;
      signature: string | null;
      correlationId: string;
    },
  ): Promise<ScanResultRow> {
    const r = await tx.query<ScanResultRow>(
      `INSERT INTO document_scan_result (tenant_id, document_id, version_id, status, scanner_code, signature, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${SCAN_COLS}`,
      [i.tenantId, i.documentId, i.versionId, i.status, i.scannerCode, i.signature, i.correlationId],
    );
    return firstRow(r.rows, 'insert scan result');
  }
  async listScanResults(tx: Tx, versionId: string): Promise<ScanResultRow[]> {
    const r = await tx.query<ScanResultRow>(
      `SELECT ${SCAN_COLS} FROM document_scan_result WHERE version_id=$1 ORDER BY scanned_at`,
      [versionId],
    );
    return r.rows;
  }
}
