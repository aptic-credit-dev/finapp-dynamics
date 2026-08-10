/**
 * @finapp/m33-integration — INTEGRATION FOUNDATION (Stage 6D-1, mvp:false): the governed platform integration foundation
 * — a connector SDK/registry (registered, governed capabilities), tenant connection management, and a FRAMEWORK-ONLY
 * connector runtime. It is NOT a production runtime (fail-closed, deterministic doubles, no network egress) and NOT a
 * secrets manager (connections store opaque secretref: pointers via the m30 seam; zero secret value columns; real key mgmt
 * = m41 behind a fail-closed port). NO arbitrary code — the SDK exposes registered capabilities only. It IMPLEMENTS m31's
 * IntegrationCapabilityCatalogPort. Connector publication is a controlled action (maker-checker/SoD; published-immutable).
 * Uses the connector_* prefix (integration_* is m23's). Reuses m02/m03/m06/m30 by contract; owns connector.lifecycle and
 * publishes through the ONE m06 outbox. Declares /api/v1/integration + integration.* + INTEGRATION_. No secret value; no
 * external network; no arbitrary code.
 */

// Permissions + audit codes
export {
  M33_PERMISSIONS,
  ALL_M33_PERMISSIONS,
  M33_PLATFORM_PERMISSIONS,
  M33_PRIVILEGED_PERMISSIONS,
  isPlatformPermission,
} from './permissions.ts';
export type { M33Permission } from './permissions.ts';
export { M33_AUDIT_CODES, ALL_M33_AUDIT_CODES, INTEGRATION_AUDIT_PREFIX } from './audit-codes.ts';
export type { M33AuditCode } from './audit-codes.ts';

// Domain
export {
  M33_LIMITS,
  IntegrationError,
  SCOPES,
  isScope,
  isPlatformScope,
  AUTH_KINDS,
  isAuthKind,
  CATEGORIES,
  isCategory,
  DIRECTIONS,
  isDirection,
  CAPABILITY_KINDS,
  isCapabilityKind,
  CONNECTOR_STATES,
  isConnectorState,
  isConnectorFrozen,
  RUN_STATUSES,
  isRunStatus,
  REASON_CODES,
  ALL_REASON_CODES,
  isHumanActor,
  evaluateSodGate,
  evaluatePublishGate,
  screenConnectionConfig,
  validateConnectorDefinition,
  SECRET_REFERENCE_PATTERN,
  isSecretReference,
  clampPage,
} from './domain.ts';
export type {
  Scope,
  ConnectorState,
  ReasonCodeKey,
  GateResult,
  PublishGateInput,
  ValidationFinding,
  ValidationOutcome,
  Page,
} from './domain.ts';

// Errors + emit
export { badRequest, governanceForbidden, versionConflict } from './errors.ts';
export { M33Emitter } from './emit.ts';

// Ports (m31 catalog implementation + fail-closed framework runtime + m30 secret resolver seam)
export {
  M33IntegrationCapabilityCatalog,
  FrameworkConnectorRuntime,
  UnavailableConnectorRuntime,
  DeterministicSecretResolver,
  UnavailableSecretResolver,
} from './ports.ts';
export type {
  CapabilityAvailabilityProvider,
  ConnectorRuntimePort,
  ConnectorRunInput,
  ConnectorRunResult,
  SecretResolver,
  IntegrationCapability,
} from './ports.ts';

// Persistence
export { IntegrationRepository } from './repository.ts';
export type {
  ConnectorDefinitionRow,
  ConnectorCapabilityRow,
  ConnectionRow,
  ConnectionSecretRow,
  ConnectorRunRow,
  ReviewRow,
} from './repository.ts';

// Services
export { ConnectorService, contentHashOf } from './connector.service.ts';
export { ConnectionService, RunService } from './connection.service.ts';
