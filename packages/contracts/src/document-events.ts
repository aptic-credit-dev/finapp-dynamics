import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `document.lifecycle` event family — owned by m09-docs (Stage 2.5).
 *
 * Registered in manifests/event-registry.yaml alongside this declaration and the module that emits it.
 * Delivered through the SINGLE transactional outbox that m06 owns (ADR-004/023) — m09 owns no outbox.
 * Classification `confidential`. Payloads carry IDENTIFIERS, STATES, CONTENT HASHES and STORAGE REFERENCES
 * (not URLs/credentials) ONLY — never raw document content, extracted text, signed URLs, encryption keys, or
 * antivirus payloads (ADR-046). A consumer that needs a document reads it back through the documents API under
 * its own permissions, with a server-mediated, short-lived access grant.
 */

export const DOCUMENT_LIFECYCLE_FAMILY = 'document.lifecycle';
export const DOCUMENT_LIFECYCLE_VERSION = 1;

export type DocumentLifecycleEventType =
  | 'DocumentCreated'
  | 'DocumentMetadataUpdated'
  | 'DocumentVersionInitiated'
  | 'DocumentVersionCompleted'
  | 'DocumentVersionActivated'
  | 'DocumentVersionSuperseded'
  | 'DocumentActivated'
  | 'DocumentArchived'
  | 'DocumentWithdrawn'
  | 'DocumentExpired'
  | 'DocumentAccessGranted'
  | 'DocumentAccessRevoked'
  | 'DocumentCheckoutAcquired'
  | 'DocumentCheckoutReleased'
  | 'DocumentScanCompleted'
  | 'DocumentScanFailed'
  | 'DocumentApprovalRequested'
  | 'DocumentLegalHoldPlaced'
  | 'DocumentLegalHoldReleased'
  | 'DocumentDispositionRequested'
  | 'DocumentDisposed'
  | 'DocumentRelationshipCreated';

export const DOCUMENT_LIFECYCLE_EVENT_TYPES: readonly DocumentLifecycleEventType[] = [
  'DocumentCreated',
  'DocumentMetadataUpdated',
  'DocumentVersionInitiated',
  'DocumentVersionCompleted',
  'DocumentVersionActivated',
  'DocumentVersionSuperseded',
  'DocumentActivated',
  'DocumentArchived',
  'DocumentWithdrawn',
  'DocumentExpired',
  'DocumentAccessGranted',
  'DocumentAccessRevoked',
  'DocumentCheckoutAcquired',
  'DocumentCheckoutReleased',
  'DocumentScanCompleted',
  'DocumentScanFailed',
  'DocumentApprovalRequested',
  'DocumentLegalHoldPlaced',
  'DocumentLegalHoldReleased',
  'DocumentDispositionRequested',
  'DocumentDisposed',
  'DocumentRelationshipCreated',
];

/** A document / version lifecycle transition. Identifiers, states and content hashes only. */
export interface DocumentLifecyclePayload {
  readonly documentId: string;
  readonly code?: string;
  readonly documentType?: string;
  readonly classification?: string;
  readonly versionId?: string;
  readonly versionNumber?: number;
  readonly contentHash?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly originModule?: string;
  readonly originEntityType?: string;
  readonly originEntityId?: string;
  readonly reason?: string;
}

/** A document access-control change. Grantee kind/ref only — never a resolved private destination. */
export interface DocumentAccessPayload {
  readonly documentId: string;
  readonly grantId: string;
  readonly granteeKind: string;
  readonly action: string;
}

/** A document relationship event. Both endpoint ids + type; tenant-consistent by construction. */
export interface DocumentRelationshipPayload {
  readonly documentId: string;
  readonly relationshipId: string;
  readonly toDocumentId: string;
  readonly relationshipType: string;
}

export type DocumentEventPayload =
  DocumentLifecyclePayload | DocumentAccessPayload | DocumentRelationshipPayload;

export type DocumentLifecycleEvent = DomainEventEnvelope<
  typeof DOCUMENT_LIFECYCLE_FAMILY,
  DocumentLifecycleEventType,
  DocumentEventPayload
>;
