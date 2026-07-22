import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `identity.authorization` event family — owned by m02-rbac (Stage 1D).
 *
 * Registered in manifests/event-registry.yaml alongside this declaration and the module that emits it
 * (GAP-1 discipline). Delivered through the SINGLE outbox port. Classification `confidential`.
 *
 * Payloads carry IDENTIFIERS AND TRANSITIONS ONLY — never a permission-set dump, a role's full grant list,
 * a secret, or personal data. A consumer that needs the detail reads it back through the RBAC API under its
 * own permissions.
 */

export const AUTHZ_LIFECYCLE_FAMILY = 'identity.authorization';
export const AUTHZ_LIFECYCLE_VERSION = 1;

export type AuthzLifecycleEventType =
  | 'RoleCreated'
  | 'RoleUpdated'
  | 'RoleActivated'
  | 'RoleSuspended'
  | 'RoleRetired'
  | 'RolePermissionsChanged'
  | 'RoleAssigned'
  | 'AssignmentRevoked'
  | 'AssignmentExpired'
  | 'SodRuleCreated'
  | 'SodConflictDetected'
  | 'BootstrapAdminProvisioned';

export const AUTHZ_LIFECYCLE_EVENT_TYPES: readonly AuthzLifecycleEventType[] = [
  'RoleCreated',
  'RoleUpdated',
  'RoleActivated',
  'RoleSuspended',
  'RoleRetired',
  'RolePermissionsChanged',
  'RoleAssigned',
  'AssignmentRevoked',
  'AssignmentExpired',
  'SodRuleCreated',
  'SodConflictDetected',
  'BootstrapAdminProvisioned',
];

/** A role transition. `tenantId` on the envelope is the real tenant (tenant roles) or PLATFORM_TENANT. */
export interface RoleLifecyclePayload {
  readonly roleId: string;
  readonly roleCode: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly reason?: string;
}

/** A permission-set change on a role — counts only, never the codes themselves. */
export interface RolePermissionsChangedPayload {
  readonly roleId: string;
  readonly added: number;
  readonly removed: number;
}

/** An assignment transition. Identifiers only. */
export interface AssignmentLifecyclePayload {
  readonly assignmentId: string;
  readonly roleId: string;
  /** The subject the role was assigned to (membership id for tenant roles, identity id for platform). */
  readonly subjectId: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly reason?: string;
}

/** A SoD rule creation or a detected conflict. */
export interface SodPayload {
  readonly ruleId?: string;
  readonly codeA?: string;
  readonly codeB?: string;
  readonly subjectId?: string;
}

/** The first administrator was provisioned by the bootstrap. */
export interface BootstrapPayload {
  readonly accountId: string;
  readonly roleId: string;
}

export type AuthzLifecyclePayload =
  | RoleLifecyclePayload
  | RolePermissionsChangedPayload
  | AssignmentLifecyclePayload
  | SodPayload
  | BootstrapPayload;

export type AuthzLifecycleEvent = DomainEventEnvelope<
  typeof AUTHZ_LIFECYCLE_FAMILY,
  AuthzLifecycleEventType,
  AuthzLifecyclePayload
>;
