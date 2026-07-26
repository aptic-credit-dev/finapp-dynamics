/**
 * @finapp/m09-docs — enterprise document & records management (Stage 2.5).
 *
 * The PURE domain layer (content-safety filename/media/hash checks with a path-traversal + SSRF-free guard, the
 * document/version/spec/disposition state machines, typed metadata + document-type + retention-policy
 * validation, retention/legal-hold/disposition rules, and relationship acyclicity) carries no I/O and is
 * exhaustively unit-tested. Large binary content lives in an object store behind the `DocumentStorage` port —
 * NEVER in PostgreSQL, which holds only an opaque storage reference plus metadata (ADR-045). The services layer
 * runs everything inside `db.withTenant` with audit + outbox in the same transaction; m09 consumes DB/AUDIT/
 * AUTHZ via kernel tokens and publishes `document.lifecycle` through the ONE outbox m06 owns. Storage + scan
 * are ports with deterministic test doubles only — no cloud provider, no antivirus, no secrets.
 */

// Vocabularies (registered in manifests/*.yaml + seeded)
export { M09_PERMISSIONS, ALL_M09_PERMISSIONS } from './permissions.ts';
export type { M09Permission } from './permissions.ts';
export { M09_AUDIT_CODES, ALL_M09_AUDIT_CODES, DOC_AUDIT_PREFIX } from './audit-codes.ts';
export type { M09AuditCode } from './audit-codes.ts';

// Domain — limits + classification
export {
  DOC_LIMITS,
  DocError,
  CLASSIFICATIONS,
  isClassification,
  classificationRank,
  isDowngrade,
} from './domain/limits.ts';
export type { Classification } from './domain/limits.ts';

// Domain — content safety
export {
  normalizeFilename,
  requireFilename,
  validateMediaType,
  requireContentHash,
  requireByteSize,
  verifyUpload,
} from './domain/content.ts';

// Domain — lifecycles
export {
  DOCUMENT_STATUSES,
  checkDocumentTransition,
  isDocumentTerminal,
  VERSION_STATUSES,
  checkVersionTransition,
  isVersionCommitted,
  SPEC_STATUSES,
  SPEC_ACTIONS,
  checkSpecTransition,
  isSpecFrozen,
  DISPOSITION_STATUSES,
  checkDispositionTransition,
  isDispositionTerminal,
} from './domain/lifecycles.ts';
export type {
  DocumentStatus,
  VersionStatus,
  SpecStatus,
  SpecAction,
  DispositionStatus,
  TransitionResult,
} from './domain/lifecycles.ts';

// Domain — type/retention specs + metadata
export {
  TYPE_SCHEMA_VERSION,
  RETENTION_SCHEMA_VERSION,
  METADATA_FIELD_TYPES,
  RETENTION_TRIGGERS,
  DISPOSITION_ACTIONS,
  validateDocumentTypeSpec,
  validateRetentionPolicySpec,
} from './domain/doctype.ts';
export type {
  DocumentTypeSpec,
  RetentionPolicySpec,
  MetadataFieldSchema,
  MetadataFieldType,
  SpecError,
  SpecValidation,
} from './domain/doctype.ts';
export { validateMetadata } from './domain/metadata.ts';
export type { MetadataValue, MetadataError, MetadataValidation } from './domain/metadata.ts';

// Domain — retention/disposition/legal-hold rules
export { earliestDispositionMs, evaluateDisposition, assertNotHeld, isExpired } from './domain/retention.ts';
export type { DispositionEligibility } from './domain/retention.ts';

// Domain — relationships + ACL model
export {
  RELATIONSHIP_TYPES,
  ACYCLIC_TYPES,
  isRelationshipType,
  wouldCreateCycle,
  assertAcyclic,
  GRANTEE_KINDS,
  isGranteeKind,
  ACCESS_LEVELS,
  isAccessLevel,
} from './domain/relationships.ts';
export type { RelationshipType, GranteeKind, AccessLevel } from './domain/relationships.ts';

// Hash
export { contentHashOf, canonicalJson, bytesHash } from './hash.ts';

// Storage + scan ports (+ deterministic test doubles)
export { InMemoryStorage } from './storage.ts';
export type { DocumentStorage, StorageHead } from './storage.ts';
export { SCAN_STATUSES, scanPermitsRelease, DeterministicScanner } from './scan.ts';
export type { ScanStatus, ScanResult, ContentScanner } from './scan.ts';

// Persistence
export { DocsRepository } from './repository.ts';
export type {
  SpecRow,
  DocumentRow,
  VersionRow,
  AccessGrantRow,
  CheckoutRow,
  RelationshipRow,
  LegalHoldRow,
  DispositionRow,
  ScanResultRow,
} from './repository.ts';

// Emit + errors
export { M09Emitter } from './emit.ts';
export { badRequest, invalidSpec, invalidMetadata } from './errors.ts';

// Services
export { CatalogService } from './catalog.service.ts';
export { DocumentService } from './document.service.ts';
export type { CreateDocumentInput } from './document.service.ts';
export { AccessService } from './access.service.ts';
export { RecordsService } from './records.service.ts';
