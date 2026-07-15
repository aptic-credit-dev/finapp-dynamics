import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `tenant.lifecycle` event family — owned by m01-tenant (manifests/naming-map.yaml).
 *
 * Payloads are deliberately thin: identifiers, the status transition, and a reason. A tenant's legal
 * name, metadata and contact details are NOT broadcast. An event goes to every subscriber of the family,
 * and the outbox retains it, so anything included here is copied to places the tenant never chose —
 * consumers that need the profile read it back through the API under the caller's own permissions.
 * That keeps this family `internal` rather than `confidential`.
 */

export const TENANT_LIFECYCLE_FAMILY = 'tenant.lifecycle';

export type TenantLifecycleEventType =
  | 'TenantCreated'
  | 'TenantUpdated'
  | 'TenantSubmittedForReview'
  | 'TenantApproved'
  | 'TenantRejected'
  | 'TenantProvisioningStarted'
  | 'TenantProvisioned'
  | 'TenantProvisioningFailed'
  | 'TenantActivated'
  | 'TenantRestricted'
  | 'TenantSuspended'
  | 'TenantReactivated'
  | 'TenantClosed'
  | 'TenantEnvironmentCreated'
  | 'TenantEntityCreated'
  | 'TenantDepartmentCreated'
  | 'TenantBranchCreated';

export const TENANT_LIFECYCLE_EVENT_TYPES: readonly TenantLifecycleEventType[] = [
  'TenantCreated',
  'TenantUpdated',
  'TenantSubmittedForReview',
  'TenantApproved',
  'TenantRejected',
  'TenantProvisioningStarted',
  'TenantProvisioned',
  'TenantProvisioningFailed',
  'TenantActivated',
  'TenantRestricted',
  'TenantSuspended',
  'TenantReactivated',
  'TenantClosed',
  'TenantEnvironmentCreated',
  'TenantEntityCreated',
  'TenantDepartmentCreated',
  'TenantBranchCreated',
];

/** Carried by every status transition so a consumer can rebuild the lifecycle without reading back. */
export interface TenantStatusChangePayload {
  readonly tenantId: string;
  readonly tenantCode: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  /** Required for rejection, restriction, suspension, closure and provisioning failure. */
  readonly reason?: string;
}

/** A profile field changed. Names the fields, never their values. */
export interface TenantUpdatedPayload {
  readonly tenantId: string;
  readonly tenantCode: string;
  readonly changedFields: readonly string[];
}

export interface TenantEnvironmentCreatedPayload {
  readonly tenantId: string;
  readonly environmentId: string;
  readonly environmentCode: string;
  readonly environmentType: string;
  readonly isDefault: boolean;
}

export interface TenantOrgNodeCreatedPayload {
  readonly tenantId: string;
  readonly nodeId: string;
  readonly nodeCode: string;
  /** `entity` | `department` | `branch`. */
  readonly nodeKind: string;
  readonly parentId: string | null;
  readonly entityId: string | null;
}

export type TenantLifecyclePayload =
  | TenantStatusChangePayload
  | TenantUpdatedPayload
  | TenantEnvironmentCreatedPayload
  | TenantOrgNodeCreatedPayload;

/** The `tenant.lifecycle` envelope. Payload version 1. */
export type TenantLifecycleEvent = DomainEventEnvelope<
  typeof TENANT_LIFECYCLE_FAMILY,
  TenantLifecycleEventType,
  TenantLifecyclePayload
>;

export const TENANT_LIFECYCLE_VERSION = 1;
