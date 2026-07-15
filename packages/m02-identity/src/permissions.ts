/**
 * M02 permissions. Namespace `identity.*` (registered); three segments, per the kernel's @Endpoint
 * validator — see packages/m01-tenant/src/permissions.ts for why two-segment names are rejected.
 *
 * `rbac.*` is m02's OTHER registered namespace and is deliberately untouched: roles and permission
 * assignment are Stage 1D.
 *
 * Declared, not granted. No role holds these until 1D.
 */
export const IDENTITY_PERMISSIONS = {
  registryView: 'identity.registry.view',
  registryCreate: 'identity.registry.create',
  registryEdit: 'identity.registry.edit',
  registryActivate: 'identity.registry.activate',
  registrySuspend: 'identity.registry.suspend',
  registryReactivate: 'identity.registry.reactivate',
  registryClose: 'identity.registry.close',

  accountView: 'identity.account.view',
  accountCreate: 'identity.account.create',
  accountActivate: 'identity.account.activate',
  accountSuspend: 'identity.account.suspend',
  accountReactivate: 'identity.account.reactivate',
  accountDeactivate: 'identity.account.deactivate',

  membershipView: 'identity.membership.view',
  membershipCreate: 'identity.membership.create',
  membershipActivate: 'identity.membership.activate',
  membershipSuspend: 'identity.membership.suspend',
  membershipReactivate: 'identity.membership.reactivate',
  membershipEnd: 'identity.membership.end',
  membershipScope: 'identity.membership.scope',
} as const;

export type IdentityPermission = (typeof IDENTITY_PERMISSIONS)[keyof typeof IDENTITY_PERMISSIONS];
export const ALL_IDENTITY_PERMISSIONS: readonly string[] = Object.values(IDENTITY_PERMISSIONS);
export const IDENTITY_PERMISSION_NAMESPACE = 'identity.';
