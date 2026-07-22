// Domain — pure.
export {
  ACTOR_TYPES,
  OUTCOMES,
  CATEGORIES,
  isActorType,
  isOutcome,
  isCategory,
  moduleForCode,
  categoryForCode,
} from './domain/types.ts';
export type { ActorType, Outcome, Category } from './domain/types.ts';

// Redaction + integrity — pure.
export { redact, REDACTED } from './redaction.ts';
export type { RedactionResult } from './redaction.ts';
export { hashEvent, verifyChain, canonicalize, INTEGRITY_VERSION, GENESIS_HASH } from './integrity.ts';
export type { HashableEvent, ChainVerification } from './integrity.ts';

// Registered names.
export { AUDIT_PERMISSIONS, ALL_AUDIT_PERMISSIONS, AUDIT_PERMISSION_NAMESPACE } from './permissions.ts';
export type { AuditPermission } from './permissions.ts';
export { AUDIT_AUDIT_CODES, ALL_AUDIT_AUDIT_CODES, AUDIT_AUDIT_PREFIX } from './audit-codes.ts';
export type { AuditAuditCode } from './audit-codes.ts';

// Persistence + services.
export { AuditRepository } from './repository.ts';
export type { AuditEventRow, AuditQueryFilter } from './repository.ts';
export { AuditService } from './audit.service.ts';
export { AuditQueryService } from './query.service.ts';
