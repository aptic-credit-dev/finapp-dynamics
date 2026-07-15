// Domain — pure, deterministic, no I/O.
export {
  TENANT_STATUSES,
  TENANT_TRANSITIONS,
  TERMINAL_STATUSES,
  isTenantStatus,
  isTerminal,
  transitionFor,
  checkTransition,
  allowsBusinessWrites,
  allowsBusinessReads,
} from './domain/tenant-status.ts';
export type {
  TenantStatus,
  TenantAction,
  TenantTransition,
  TransitionCheck,
} from './domain/tenant-status.ts';

export { TENANT_TYPES, TENANT_TYPE_LABELS, isTenantType } from './domain/tenant-type.ts';
export type { TenantType } from './domain/tenant-type.ts';

export {
  TENANT_CODE_PATTERN,
  ORG_CODE_PATTERN,
  CURRENCY_PATTERN,
  COUNTRY_PATTERN,
  TIMEZONE_PATTERN,
  validateTenantCode,
  validateOrgCode,
  validateTimezone,
  validateCurrency,
  validateCountry,
  isKnownTimezone,
} from './domain/tenant-code.ts';

export {
  ENVIRONMENT_TYPES,
  ENVIRONMENT_STATUSES,
  PROVISIONING_STATUSES,
  ORG_STATUSES,
  isEnvironmentType,
  isOrgStatus,
  validateOrgNode,
  validateEnvironment,
  validateEffectiveDates,
  wouldCreateCycle,
} from './domain/org.ts';
export type {
  EnvironmentType,
  EnvironmentStatus,
  ProvisioningStatus,
  OrgStatus,
  OrgNodeKind,
  OrgNodeInput,
  EnvironmentInput,
  EffectiveDates,
} from './domain/org.ts';

// Registered names — permissions, audit codes, and the action map that keeps them in step.
export { TENANT_PERMISSIONS, ALL_TENANT_PERMISSIONS, TENANT_PERMISSION_NAMESPACE } from './permissions.ts';
export type { TenantPermission } from './permissions.ts';

export {
  TENANT_AUDIT_CODES,
  ALL_TENANT_AUDIT_CODES,
  TENANT_AUDIT_PREFIX,
  TENANT_ACTION_MAP,
  TENANT_ACTION_PERMISSIONS,
} from './audit-codes.ts';
export type { TenantAuditCode } from './audit-codes.ts';

// Events.
export { tenantLifecycleEvent } from './events.ts';

// Persistence + services.
export { TenantRepository } from './repository.ts';
export type { TenantRow, CreateTenantRow } from './repository.ts';
export { OrgRepository } from './org-repository.ts';
export type { EnvironmentRow, EntityRow, DepartmentRow, BranchRow, OrgNodeRow } from './org-repository.ts';

export { TenantService } from './tenant.service.ts';
export type { CreateTenantInput, UpdateTenantInput } from './tenant.service.ts';
export { OrgService } from './org.service.ts';

export { TenantContextResolver, UUID_PATTERN } from './tenant-context.ts';

// Stage 1A stand-ins — delete when m02/m03/m06 land. See adapters.ts.
export { ContextAuthz, RecordingAudit, RecordingOutbox } from './adapters.ts';
export type { RecordedAudit } from './adapters.ts';
