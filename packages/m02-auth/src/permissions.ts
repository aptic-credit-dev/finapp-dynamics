/**
 * M02-auth permissions. Namespace `auth.*` (registered in manifests/permission-registry.yaml); three
 * segments, per the kernel's @Endpoint validator.
 *
 * These are ADMINISTRATIVE, cross-account session-management permissions only. Self-service on one's OWN
 * sessions needs no permission — the owner is the actor. Declared, NOT granted: no role holds them until
 * Stage 1D ships the RBAC model, exactly as `identity.*` in Stage 1B.
 */
export const AUTH_PERMISSIONS = {
  sessionView: 'auth.session.view',
  sessionRevoke: 'auth.session.revoke',
} as const;

export type AuthPermission = (typeof AUTH_PERMISSIONS)[keyof typeof AUTH_PERMISSIONS];
export const ALL_AUTH_PERMISSIONS: readonly string[] = Object.values(AUTH_PERMISSIONS);
export const AUTH_PERMISSION_NAMESPACE = 'auth.';
