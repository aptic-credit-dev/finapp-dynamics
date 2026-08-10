/**
 * @finapp/m34-marketplace — CONNECTOR MARKETPLACE (Stage 6D-2, mvp:false): the governed marketplace over the connectors
 * m33 defines — catalog listings, tenant installations, consent and upgrades. It CONSUMES m33 by contract (opaque
 * connector references validated through a fail-closed ConnectorRegistryPort; m34 never reads m33 tables and never executes
 * a connector) and is NOT a secrets manager (install secrets are opaque secretref: pointers via the m30 seam; zero secret
 * value columns; real key mgmt = m41 behind a fail-closed port). CONSENT + listing PUBLICATION + UPGRADE are human-governed
 * controlled actions (maker-checker/SoD; AI never consents/approves; consent revocable; published-immutable). Uses the
 * marketplace_* prefix (integration_* is m23's, connector_* is m33's). Reuses m02/m03/m06/m30/m33 by contract; owns
 * marketplace.lifecycle and publishes through the ONE m06 outbox. Declares /api/v1/connectors + marketplace.* (GAP-4
 * resolved) + MARKETPLACE_. No secret value; no external network/provider; no arbitrary code.
 */

// Permissions + audit codes
export {
  M34_PERMISSIONS,
  ALL_M34_PERMISSIONS,
  M34_PLATFORM_PERMISSIONS,
  M34_PRIVILEGED_PERMISSIONS,
  isPlatformPermission,
} from './permissions.ts';
export type { M34Permission } from './permissions.ts';
export { M34_AUDIT_CODES, ALL_M34_AUDIT_CODES, MARKETPLACE_AUDIT_PREFIX } from './audit-codes.ts';
export type { M34AuditCode } from './audit-codes.ts';

// Domain
export {
  M34_LIMITS,
  MarketplaceError,
  SCOPES,
  isScope,
  isPlatformScope,
  VISIBILITIES,
  isVisibility,
  CATEGORIES,
  isCategory,
  CONSENT_SCOPES,
  isConsentScope,
  LISTING_STATES,
  isListingState,
  isListingFrozen,
  INSTALL_STATUSES,
  isInstallStatus,
  REASON_CODES,
  ALL_REASON_CODES,
  isHumanActor,
  evaluateSodGate,
  evaluatePublishGate,
  evaluateConsentGate,
  screenInstallConfig,
  validateListing,
  SECRET_REFERENCE_PATTERN,
  isSecretReference,
  clampPage,
} from './domain.ts';
export type {
  Scope,
  ListingState,
  ReasonCodeKey,
  GateResult,
  PublishGateInput,
  ValidationFinding,
  ValidationOutcome,
  Page,
} from './domain.ts';

// Errors + emit
export { badRequest, governanceForbidden, notFound, versionConflict } from './errors.ts';
export { M34Emitter } from './emit.ts';

// Ports (m33 connector-registry consumption + m30 secret resolver seam; deterministic doubles only)
export {
  M33ConnectorRegistryAdapter,
  FixtureConnectorRegistry,
  UnavailableConnectorRegistry,
  DeterministicSecretResolver,
  UnavailableSecretResolver,
} from './ports.ts';
export type {
  ConnectorAvailability,
  ConnectorRegistryPort,
  M33ConnectorReader,
  SecretResolver,
} from './ports.ts';

// Persistence
export { MarketplaceRepository } from './repository.ts';
export type {
  ListingRow,
  ListingCapabilityRow,
  InstallationRow,
  ConsentRow,
  InstallSecretRow,
  UpgradeRow,
  ReviewRow,
} from './repository.ts';

// Services
export { ListingService, contentHashOf } from './listing.service.ts';
export { InstallationService } from './installation.service.ts';
