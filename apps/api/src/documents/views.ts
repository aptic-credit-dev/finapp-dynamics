import type {
  SpecRow,
  DocumentRow,
  VersionRow,
  AccessGrantRow,
  CheckoutRow,
  RelationshipRow,
  LegalHoldRow,
  DispositionRow,
  ScanResultRow,
} from '@finapp/m09-docs';

/**
 * Response shapes for the documents API (m09). Persistence rows are snake_case; these map to camelCase DTOs.
 * The tenant is implicit (x-tenant-id + RLS), never re-exposed. Deliberate REDACTIONS (ADR-046, prompt §E29):
 * a version view omits the raw `storage_ref` and `storage_code` (internal object location) — the caller gets a
 * content hash + size instead; checkout views omit nothing sensitive but are read-scoped. Every mutable view
 * carries `version` for the caller's next optimistic-lock `expectedVersion`.
 */

export function specView(row: SpecRow) {
  return {
    id: row.id,
    code: row.code,
    versionNumber: row.version_number,
    name: row.name,
    scope: row.scope,
    status: row.status,
    spec: row.spec,
    contentHash: row.content_hash,
    version: row.version,
  };
}

export function documentView(row: DocumentRow) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    documentType: row.document_type,
    classification: row.classification,
    sensitivity: row.sensitivity,
    status: row.status,
    ownerId: row.owner_id,
    custodianId: row.custodian_id,
    currentVersionId: row.current_version_id,
    currentVersionNumber: row.current_version_number,
    metadata: row.metadata,
    retentionPolicyCode: row.retention_policy_code,
    earliestDispositionAt: row.earliest_disposition_at,
    dispositionStatus: row.disposition_status,
    legalHold: row.legal_hold,
    effectiveAt: row.effective_at,
    expiresAt: row.expires_at,
    originModule: row.origin_module,
    originEntityType: row.origin_entity_type,
    originEntityId: row.origin_entity_id,
    version: row.version,
  };
}

export function versionView(row: VersionRow) {
  // storage_ref / storage_code are internal object-location details and are NOT exposed.
  return {
    id: row.id,
    documentId: row.document_id,
    versionNumber: row.version_number,
    status: row.status,
    filename: row.filename,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    contentHash: row.content_hash,
    changeSummary: row.change_summary,
    scanStatus: row.scan_status,
    version: row.version,
  };
}

export function grantView(row: AccessGrantRow) {
  return {
    id: row.id,
    documentId: row.document_id,
    granteeKind: row.grantee_kind,
    granteeRef: row.grantee_ref,
    accessLevel: row.access_level,
    status: row.status,
    version: row.version,
  };
}

export function checkoutView(row: CheckoutRow) {
  return {
    id: row.id,
    documentId: row.document_id,
    checkedOutBy: row.checked_out_by,
    expectedVersion: row.expected_version,
    expiresAt: row.expires_at,
    releasedAt: row.released_at,
    forced: row.forced,
    version: row.version,
  };
}

export function relationshipView(row: RelationshipRow) {
  return {
    id: row.id,
    fromDocumentId: row.from_document_id,
    toDocumentId: row.to_document_id,
    relationshipType: row.relationship_type,
    status: row.status,
    version: row.version,
  };
}

export function holdView(row: LegalHoldRow) {
  return {
    id: row.id,
    documentId: row.document_id,
    status: row.status,
    reason: row.reason,
    version: row.version,
  };
}

export function dispositionView(row: DispositionRow) {
  return {
    id: row.id,
    documentId: row.document_id,
    status: row.status,
    action: row.action,
    reason: row.reason,
    version: row.version,
  };
}

export function scanView(row: ScanResultRow) {
  return {
    id: row.id,
    documentId: row.document_id,
    versionId: row.version_id,
    status: row.status,
    scannerCode: row.scanner_code,
    signature: row.signature,
  };
}
