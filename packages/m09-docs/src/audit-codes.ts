/**
 * M09 audit codes — the authoritative constant map. Every controlled document mutation and every governed
 * access/scan/disposition event records one of these through the kernel `AUDIT` port (m03 AuditService) in the
 * SAME transaction as the state change. Codes are SCREAMING_SNAKE `DOC_<ENTITY>_<ACTION>` (>= 3 segments) and
 * MUST be registered in manifests/audit-code-registry.yaml (unregistered codes fail CI, ADR-005). Payloads
 * never carry raw content, extracted text, storage credentials, signed URLs, encryption keys, or AV payloads
 * (ADR-046).
 */
export const M09_AUDIT_CODES = {
  documentCreated: 'DOC_DOCUMENT_CREATED',
  metadataUpdated: 'DOC_METADATA_UPDATED',
  classificationChanged: 'DOC_CLASSIFICATION_CHANGED',
  versionInitiated: 'DOC_VERSION_INITIATED',
  versionCompleted: 'DOC_VERSION_COMPLETED',
  versionActivated: 'DOC_VERSION_ACTIVATED',
  versionSuperseded: 'DOC_VERSION_SUPERSEDED',
  documentActivated: 'DOC_DOCUMENT_ACTIVATED',
  documentArchived: 'DOC_DOCUMENT_ARCHIVED',
  documentWithdrawn: 'DOC_DOCUMENT_WITHDRAWN',
  documentAccessed: 'DOC_DOCUMENT_ACCESSED',
  documentDownloaded: 'DOC_DOCUMENT_DOWNLOADED',
  accessGranted: 'DOC_ACCESS_GRANTED',
  accessRevoked: 'DOC_ACCESS_REVOKED',
  checkoutAcquired: 'DOC_CHECKOUT_ACQUIRED',
  checkoutReleased: 'DOC_CHECKOUT_RELEASED',
  typeCreated: 'DOC_TYPE_CREATED',
  typePublished: 'DOC_TYPE_PUBLISHED',
  retentionCreated: 'DOC_RETENTION_CREATED',
  retentionPublished: 'DOC_RETENTION_PUBLISHED',
  legalHoldPlaced: 'DOC_LEGAL_HOLD_PLACED',
  legalHoldReleased: 'DOC_LEGAL_HOLD_RELEASED',
  dispositionRequested: 'DOC_DISPOSITION_REQUESTED',
  dispositionApproved: 'DOC_DISPOSITION_APPROVED',
  dispositionRejected: 'DOC_DISPOSITION_REJECTED',
  dispositionCompleted: 'DOC_DISPOSITION_COMPLETED',
  scanCompleted: 'DOC_SCAN_COMPLETED',
  scanFailed: 'DOC_SCAN_FAILED',
  relationshipCreated: 'DOC_RELATIONSHIP_CREATED',
  relationshipRemoved: 'DOC_RELATIONSHIP_REMOVED',
} as const;

export type M09AuditCode = (typeof M09_AUDIT_CODES)[keyof typeof M09_AUDIT_CODES];

export const ALL_M09_AUDIT_CODES: readonly M09AuditCode[] = Object.values(M09_AUDIT_CODES);

export const DOC_AUDIT_PREFIX = 'DOC_';
