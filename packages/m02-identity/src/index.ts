// Domain — pure, deterministic, no I/O.
export {
  IDENTITY_STATUSES,
  ACCOUNT_STATUSES,
  MEMBERSHIP_STATUSES,
  IDENTITY_TRANSITIONS,
  ACCOUNT_TRANSITIONS,
  MEMBERSHIP_TRANSITIONS,
  IDENTITY_TERMINAL,
  ACCOUNT_TERMINAL,
  MEMBERSHIP_TERMINAL,
  isIdentityStatus,
  isAccountStatus,
  isMembershipStatus,
  checkIdentityTransition,
  checkAccountTransition,
  checkMembershipTransition,
  identityCanResolve,
  accountCanResolve,
  membershipCanResolve,
} from './domain/lifecycles.ts';
export type {
  IdentityStatus,
  AccountStatus,
  MembershipStatus,
  IdentityAction,
  AccountAction,
  MembershipAction,
  Transition,
  TransitionCheck,
} from './domain/lifecycles.ts';

export {
  IDENTITY_TYPES,
  ACCOUNT_TYPES,
  MEMBERSHIP_TYPES,
  HUMAN_IDENTITY_TYPES,
  SYSTEM_ACTORS,
  isIdentityType,
  isAccountType,
  isMembershipType,
  isHumanIdentity,
  isSystemActor,
  accountTypeAllowsIdentityType,
  systemActorInheritsHumanPermissions,
} from './domain/types.ts';
export type { IdentityType, AccountType, MembershipType, SystemActor } from './domain/types.ts';

export {
  EMAIL_PATTERN,
  USERNAME_PATTERN,
  SERVICE_ACCOUNT_PATTERN,
  SYSTEM_ACCOUNT_PATTERN,
  E164_PATTERN,
  normalizeEmail,
  normalizeUsername,
  validateEmail,
  validateUsername,
  validateServiceAccountName,
  validateSystemAccountName,
  validatePhoneReadiness,
  validateAuthSubject,
  authSubjectKey,
} from './domain/normalization.ts';

// Registered names.
export {
  IDENTITY_PERMISSIONS,
  ALL_IDENTITY_PERMISSIONS,
  IDENTITY_PERMISSION_NAMESPACE,
} from './permissions.ts';
export type { IdentityPermission } from './permissions.ts';
export {
  IDENTITY_AUDIT_CODES,
  ALL_IDENTITY_AUDIT_CODES,
  IDENTITY_AUDIT_PREFIX,
  IDENTITY_ACTION_MAP,
  ACCOUNT_ACTION_MAP,
  MEMBERSHIP_ACTION_MAP,
} from './audit-codes.ts';
export type { IdentityAuditCode } from './audit-codes.ts';

// Persistence + services.
export { IdentityRepository, firstRow } from './repository.ts';
export type { IdentityRow, AccountRow, MembershipRow, AccountWithIdentityRow } from './repository.ts';
export { IdentityService } from './identity.service.ts';
export { MembershipService } from './membership.service.ts';

// Actor resolution — the authoritative boundary.
export { ActorResolver, contextFromActor, UUID_PATTERN } from './actor-resolver.ts';
export type { AuthenticatedActor, ResolveInput } from './actor-resolver.ts';

// The API's actor boundary — the one place a request becomes a context.
export {
  ActorContextFactory,
  requireUuidParam,
  CORRELATION_HEADER,
  TENANT_HEADER,
  PERMISSIONS_HEADER,
} from './actor-context.ts';
export type {
  ActorSource,
  ScopedRequest,
  TenantScopedRequest,
  PlatformScopedRequest,
} from './actor-context.ts';

// Development-only adapter. DELETE IN STAGE 1C — see dev-actor-adapter.ts.
export {
  DevActorAdapter,
  DEV_ACTOR_HEADER,
  isDevActorAdapterAllowed,
  devActorAdapterRejectionReason,
  signDevAssertion,
  verifyDevAssertion,
} from './dev-actor-adapter.ts';
export type { DevAssertion, DevVerifyResult } from './dev-actor-adapter.ts';
