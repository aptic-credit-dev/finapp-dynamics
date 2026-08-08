/**
 * @finapp/m30-platform — PLATFORM FOUNDATION (Stage 6A, mvp:false): the CANONICAL owner of governed platform METADATA,
 * CONFIGURATION (typed definitions + values + history), FEATURE FLAGS (definitions + assignments + deterministic
 * evaluation + history) and the SECRET-REFERENCE SEAM (opaque secretref: pointers only). HARD RULES: a feature flag is
 * NEVER an authorization substitute — a flag can never grant a permission RBAC (m02) denies, and a platform-ABSOLUTE
 * control can never be weakened by a tenant override; M30 stores ZERO secret VALUES (opaque references only) and defers
 * real secret/key management to M41-security behind a fail-closed SecretResolver port (deterministic double only). It
 * CONSUMES m01/m02/m03/m06 BY CONTRACT and owns NO second engine and NO second outbox — it declares + owns the
 * platform.lifecycle family (published through the ONE m06 outbox), the platform.* permission namespace (GAP-2 resolved,
 * ADR-115) and the PLATFORM_ audit prefix. m04-admin is the admin CONSOLE that orchestrates over M30's public contracts.
 * NO REST API (internal governed library, ADR-116). No float; no secret value; no production provider; no network.
 */

// Permissions + audit codes
export {
  M30_PERMISSIONS,
  ALL_M30_PERMISSIONS,
  M30_PLATFORM_PERMISSIONS,
  M30_PRIVILEGED_PERMISSIONS,
  isPlatformPermission,
} from './permissions.ts';
export type { M30Permission } from './permissions.ts';
export { M30_AUDIT_CODES, ALL_M30_AUDIT_CODES, PLATFORM_AUDIT_PREFIX } from './audit-codes.ts';
export type { M30AuditCode } from './audit-codes.ts';

// Domain
export {
  M30_LIMITS,
  PlatformError,
  SCOPES,
  isScope,
  isPlatformScope,
  METADATA_CATEGORIES,
  isMetadataCategory,
  VALUE_TYPES,
  isValueType,
  SPEC_STATUSES,
  isSpecFrozen,
  SECRET_REF_STATUSES,
  SECRET_REFERENCE_PATTERN,
  isSecretReference,
  REASON_CODES,
  ALL_REASON_CODES,
  evaluateFeature,
  evaluateAbsoluteAssignmentGate,
  evaluateConfigValueGate,
  clampPage,
} from './domain.ts';
export type {
  Scope,
  MetadataCategory,
  ValueType,
  SpecStatus,
  SecretRefStatus,
  ReasonCodeKey,
  FeatureEvaluationInput,
  AbsoluteGateResult,
  ConfigValueGateInput,
  ConfigValueGateResult,
  Page,
} from './domain.ts';

// Errors + emit
export { badRequest, governanceForbidden } from './errors.ts';
export { M30Emitter } from './emit.ts';

// Ports (secret resolver + public read contracts; deterministic doubles only)
export { DeterministicSecretResolver, UnavailableSecretResolver } from './ports.ts';
export type {
  SecretResolver,
  PlatformConfigResolvePort,
  PlatformFeatureEvaluatePort,
  ResolvedConfig,
} from './ports.ts';

// Persistence
export { PlatformRepository } from './repository.ts';
export type {
  MetadataRow,
  ConfigDefinitionRow,
  ConfigValueRow,
  FeatureDefinitionRow,
  FeatureAssignmentRow,
  SecretReferenceRow,
} from './repository.ts';

// Services
export { PlatformMetadataService } from './metadata.service.ts';
export { PlatformConfigService } from './config.service.ts';
export { PlatformFeatureService } from './feature.service.ts';
export { PlatformSecretReferenceService } from './secret.service.ts';
