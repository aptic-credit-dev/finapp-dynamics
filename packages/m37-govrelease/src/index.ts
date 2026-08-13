/**
 * @finapp/m37-govrelease — INTEGRATION GOVERNANCE / QA / RELEASE (Stage 6D-5, mvp:false): the governed promotion of an
 * integration artifact (an m33 connector, an m34 marketplace listing, an m35 API product, an m36 webhook/stream) through QA
 * gates to a released state, per target environment. It RECORDS + GOVERNS the release decision + QA evidence; it EXECUTES no
 * release (runtime stays with the owning module). It CONSUMES m33/m34/m35/m36 by contract (opaque artifact refs validated
 * through a fail-closed ArtifactRegistryPort; m37 reads no owning-module table) and is NOT a secrets manager (a release
 * signature is an opaque secretref: pointer via the m30 seam; zero secret value columns; m41 deferred). A release is a
 * human-governed controlled action (maker-checker/SoD over a passing QA gate; AI never approves/releases; released-immutable).
 * Uses the govrelease_ table prefix. Reuses m02/m03/m06/m30 by contract; owns govrelease.lifecycle and publishes through the
 * ONE m06 outbox. Declares /api/v1/releases + govrelease.* (GAP-4 resolved) + GOVRELEASE_ (distinct from m33's INTEGRATION_).
 * No secret value; no external network/provider; no arbitrary code.
 */

// Permissions + audit codes
export {
  M37_PERMISSIONS,
  ALL_M37_PERMISSIONS,
  M37_PLATFORM_PERMISSIONS,
  M37_PRIVILEGED_PERMISSIONS,
  isPlatformPermission,
} from './permissions.ts';
export type { M37Permission } from './permissions.ts';
export { M37_AUDIT_CODES, ALL_M37_AUDIT_CODES, GOVRELEASE_AUDIT_PREFIX } from './audit-codes.ts';
export type { M37AuditCode } from './audit-codes.ts';

// Domain
export {
  M37_LIMITS,
  GovreleaseError,
  SCOPES,
  isScope,
  isPlatformScope,
  ARTIFACT_KINDS,
  isArtifactKind,
  ARTIFACT_STATUSES,
  isArtifactStatus,
  ENVIRONMENT_STATUSES,
  isEnvironmentStatus,
  RELEASE_STATES,
  isReleaseState,
  isReleaseFrozen,
  GATE_STATUSES,
  isGateStatus,
  CHECK_STATUSES,
  isCheckStatus,
  REASON_CODES,
  ALL_REASON_CODES,
  isHumanActor,
  evaluateSodGate,
  evaluateApprovalGate,
  evaluateQaGate,
  validateRelease,
  validateSignatureRef,
  SECRET_REFERENCE_PATTERN,
  isSecretReference,
  clampPage,
} from './domain.ts';
export type {
  Scope,
  ReleaseState,
  ReasonCodeKey,
  GateResult,
  ApprovalGateInput,
  GateState,
  ValidationFinding,
  ValidationOutcome,
  Page,
} from './domain.ts';

// Errors + emit
export { badRequest, governanceForbidden, notFound, versionConflict } from './errors.ts';
export { M37Emitter } from './emit.ts';

// Ports (m33/m34 artifact-registry consumption + m30 secret resolver seam; deterministic doubles only)
export {
  ArtifactRegistryAdapter,
  FixtureArtifactRegistry,
  UnavailableArtifactRegistry,
  DeterministicSecretResolver,
  UnavailableSecretResolver,
} from './ports.ts';
export type {
  ArtifactAvailability,
  ArtifactRegistryPort,
  M33ConnectorReader,
  M34MarketplaceReader,
  SecretResolver,
} from './ports.ts';

// Persistence
export { GovreleaseRepository } from './repository.ts';
export type {
  ArtifactRow,
  EnvironmentRow,
  ReleaseRow,
  GateRow,
  ReviewRow,
  EvidenceRow,
} from './repository.ts';

// Services
export { ArtifactService } from './artifact.service.ts';
export { ReleaseService, contentHashOf } from './release.service.ts';
