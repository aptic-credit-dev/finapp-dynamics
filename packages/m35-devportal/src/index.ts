/**
 * @finapp/m35-devportal — PUBLIC APIs & DEVELOPER PORTAL (Stage 6D-3, mvp:false): the governed developer portal + API-gateway
 * FACADE over the platform — developer applications, API credentials, published API products and app subscriptions (public
 * exposure). It is a GOVERNED FACADE: a product exposes only ALLOW-LISTED operations, each carrying the m02 permission it
 * requires — public exposure never bypasses m02 RBAC or m01 tenancy (they stay authoritative). It is NOT a secrets manager:
 * an API credential persists only a one-way sha256: hash XOR an opaque secretref: pointer (the m30 seam); zero plaintext
 * columns; real key mgmt = m41 behind a fail-closed port. Credential issuance/rotation/revocation are human-governed (AI
 * never issues); product publication + subscription approval are maker-checker/SoD controlled actions (AI never approves;
 * published-immutable). It CONSUMES m34/m33 by contract (opaque source references validated through a fail-closed
 * CatalogSourcePort; m35 reads no m33/m34 table) and m39-saas by contract for public quotas (fail-closed UsageQuotaPort; m39
 * unbuilt -> deny). Uses the devportal_* prefix (integration_* is m23's, connector_* is m33's, marketplace_* is m34's).
 * Reuses m02/m03/m06/m30/m33/m34 by contract; owns devportal.lifecycle and publishes through the ONE m06 outbox. Declares
 * /api/v1/developer + devportal.* (GAP-4 resolved) + DEVPORTAL_. No secret value; no external network/provider; no arbitrary code.
 */

// Permissions + audit codes
export {
  M35_PERMISSIONS,
  ALL_M35_PERMISSIONS,
  M35_PLATFORM_PERMISSIONS,
  M35_PRIVILEGED_PERMISSIONS,
  isPlatformPermission,
} from './permissions.ts';
export type { M35Permission } from './permissions.ts';
export { M35_AUDIT_CODES, ALL_M35_AUDIT_CODES, DEVPORTAL_AUDIT_PREFIX } from './audit-codes.ts';
export type { M35AuditCode } from './audit-codes.ts';

// Domain
export {
  M35_LIMITS,
  DevportalError,
  SCOPES,
  isScope,
  isPlatformScope,
  VISIBILITIES,
  isVisibility,
  isPublicVisibility,
  CATEGORIES,
  isCategory,
  SOURCE_KINDS,
  isSourceKind,
  PRODUCT_STATES,
  isProductState,
  isProductFrozen,
  APP_STATUSES,
  isAppStatus,
  CREDENTIAL_STATUSES,
  isCredentialStatus,
  SUBSCRIPTION_STATUSES,
  isSubscriptionStatus,
  REASON_CODES,
  ALL_REASON_CODES,
  isHumanActor,
  evaluateSodGate,
  evaluatePublishGate,
  evaluateCredentialActorGate,
  SECRET_HASH_PATTERN,
  isSecretHash,
  validateCredentialSecret,
  isThreeSegmentPermission,
  screenExposedOperations,
  validateProduct,
  SECRET_REFERENCE_PATTERN,
  isSecretReference,
  clampPage,
} from './domain.ts';
export type {
  Scope,
  ProductState,
  ReasonCodeKey,
  GateResult,
  PublishGateInput,
  CredentialSecret,
  ExposedOperation,
  ValidationFinding,
  ValidationOutcome,
  Page,
} from './domain.ts';

// Errors + emit
export { badRequest, governanceForbidden, notFound, versionConflict } from './errors.ts';
export { M35Emitter } from './emit.ts';

// Ports (m34/m33 catalog consumption + m39 quota seam + m30 secret resolver seam; deterministic doubles only)
export {
  CatalogSourceAdapter,
  FixtureSourceCatalog,
  UnavailableSourceCatalog,
  FixtureUsageQuota,
  UnavailableUsageQuota,
  DeterministicSecretResolver,
  UnavailableSecretResolver,
} from './ports.ts';
export type {
  SourceAvailability,
  CatalogSourcePort,
  M34MarketplaceReader,
  M33ConnectorReader,
  QuotaDecision,
  UsageQuotaPort,
  SecretResolver,
} from './ports.ts';

// Persistence
export { DevportalRepository } from './repository.ts';
export type {
  AppRow,
  ProductRow,
  ProductScopeRow,
  CredentialRow,
  SubscriptionRow,
  ReviewRow,
} from './repository.ts';

// Services
export { AppService } from './app.service.ts';
export type { IssuedCredential } from './app.service.ts';
export { ProductService, contentHashOf } from './product.service.ts';
export { SubscriptionService } from './subscription.service.ts';
