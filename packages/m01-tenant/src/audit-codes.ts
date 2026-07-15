/**
 * M01 audit codes.
 *
 * FORMAT — manifests/audit-code-registry.yaml specifies `<PREFIX>_<ENTITY>_<ACTION>`, and m01's
 * registered prefix is `TENANT_`. So the tenant record's own codes are `TENANT_REGISTRY_*`, not
 * `TENANT_*`: `TENANT_CREATED` has two segments and does not satisfy the registry's own format. They
 * pair one-to-one with the permissions in permissions.ts — `tenant.registry.create` emits
 * `TENANT_REGISTRY_CREATED`.
 *
 * Codes are immutable once registered: never renamed, renumbered or reused. Supersede, never edit
 * (ADR-005). Every code here is registered in manifests/audit-code-registry.yaml, and the M01 smoke
 * suite fails if one is not.
 */

export const TENANT_AUDIT_CODES = {
  created: 'TENANT_REGISTRY_CREATED',
  updated: 'TENANT_REGISTRY_UPDATED',
  submittedForReview: 'TENANT_REGISTRY_SUBMITTED_FOR_REVIEW',
  approved: 'TENANT_REGISTRY_APPROVED',
  rejected: 'TENANT_REGISTRY_REJECTED',
  provisioningStarted: 'TENANT_REGISTRY_PROVISIONING_STARTED',
  provisioned: 'TENANT_REGISTRY_PROVISIONED',
  provisioningFailed: 'TENANT_REGISTRY_PROVISIONING_FAILED',
  activated: 'TENANT_REGISTRY_ACTIVATED',
  restricted: 'TENANT_REGISTRY_RESTRICTED',
  suspended: 'TENANT_REGISTRY_SUSPENDED',
  reactivated: 'TENANT_REGISTRY_REACTIVATED',
  closed: 'TENANT_REGISTRY_CLOSED',

  environmentCreated: 'TENANT_ENVIRONMENT_CREATED',
  entityCreated: 'TENANT_ENTITY_CREATED',
  departmentCreated: 'TENANT_DEPARTMENT_CREATED',
  branchCreated: 'TENANT_BRANCH_CREATED',
  orgStatusChanged: 'TENANT_ORG_STATUS_CHANGED',
} as const;

export type TenantAuditCode = (typeof TENANT_AUDIT_CODES)[keyof typeof TENANT_AUDIT_CODES];

export const ALL_TENANT_AUDIT_CODES: readonly string[] = Object.values(TENANT_AUDIT_CODES);

/** The prefix m01 is registered to own. */
export const TENANT_AUDIT_PREFIX = 'TENANT_';

import type { TenantAction } from './domain/tenant-status.ts';
import type { TenantLifecycleEventType } from '@finapp/contracts';

/**
 * action -> (audit code, event type). One table so the three axes cannot drift apart: adding an action
 * without its audit code or its event is a type error here rather than a gap discovered in production.
 */
export const TENANT_ACTION_MAP: Readonly<
  Record<TenantAction, { auditCode: TenantAuditCode; eventType: TenantLifecycleEventType }>
> = {
  submit_review: { auditCode: TENANT_AUDIT_CODES.submittedForReview, eventType: 'TenantSubmittedForReview' },
  approve: { auditCode: TENANT_AUDIT_CODES.approved, eventType: 'TenantApproved' },
  reject: { auditCode: TENANT_AUDIT_CODES.rejected, eventType: 'TenantRejected' },
  start_provisioning: {
    auditCode: TENANT_AUDIT_CODES.provisioningStarted,
    eventType: 'TenantProvisioningStarted',
  },
  complete_provisioning: { auditCode: TENANT_AUDIT_CODES.provisioned, eventType: 'TenantProvisioned' },
  fail_provisioning: {
    auditCode: TENANT_AUDIT_CODES.provisioningFailed,
    eventType: 'TenantProvisioningFailed',
  },
  activate: { auditCode: TENANT_AUDIT_CODES.activated, eventType: 'TenantActivated' },
  restrict: { auditCode: TENANT_AUDIT_CODES.restricted, eventType: 'TenantRestricted' },
  suspend: { auditCode: TENANT_AUDIT_CODES.suspended, eventType: 'TenantSuspended' },
  reactivate: { auditCode: TENANT_AUDIT_CODES.reactivated, eventType: 'TenantReactivated' },
  close: { auditCode: TENANT_AUDIT_CODES.closed, eventType: 'TenantClosed' },
};

import { TENANT_PERMISSIONS } from './permissions.ts';

/** action -> the permission the caller must hold. Separate from the map above so a read of one axis is unambiguous. */
export const TENANT_ACTION_PERMISSIONS: Readonly<Record<TenantAction, string>> = {
  submit_review: TENANT_PERMISSIONS.registryReview,
  approve: TENANT_PERMISSIONS.registryApprove,
  reject: TENANT_PERMISSIONS.registryApprove,
  start_provisioning: TENANT_PERMISSIONS.registryProvision,
  complete_provisioning: TENANT_PERMISSIONS.registryProvision,
  fail_provisioning: TENANT_PERMISSIONS.registryProvision,
  activate: TENANT_PERMISSIONS.registryActivate,
  restrict: TENANT_PERMISSIONS.registryRestrict,
  suspend: TENANT_PERMISSIONS.registrySuspend,
  reactivate: TENANT_PERMISSIONS.registryReactivate,
  close: TENANT_PERMISSIONS.registryClose,
};
