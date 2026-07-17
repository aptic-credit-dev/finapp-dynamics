import type { IdentityLifecycleEventType } from '@finapp/contracts';
import type { AccountAction, IdentityAction, MembershipAction } from './domain/lifecycles.ts';
import { IDENTITY_PERMISSIONS } from './permissions.ts';

/**
 * M02 audit codes. Prefix `IDENTITY_` (registered); format `<PREFIX>_<ENTITY>_<ACTION>` — three
 * segments, so `IDENTITY_CREATED` is invalid. Immutable once registered (ADR-005).
 */
export const IDENTITY_AUDIT_CODES = {
  identityCreated: 'IDENTITY_REGISTRY_CREATED',
  identityUpdated: 'IDENTITY_REGISTRY_UPDATED',
  identityActivated: 'IDENTITY_REGISTRY_ACTIVATED',
  identitySuspended: 'IDENTITY_REGISTRY_SUSPENDED',
  identityReactivated: 'IDENTITY_REGISTRY_REACTIVATED',
  identityDeactivated: 'IDENTITY_REGISTRY_DEACTIVATED',
  identityRejected: 'IDENTITY_REGISTRY_REJECTED',
  identityArchived: 'IDENTITY_REGISTRY_ARCHIVED',
  identityClosed: 'IDENTITY_REGISTRY_CLOSED',

  accountCreated: 'IDENTITY_ACCOUNT_CREATED',
  accountActivated: 'IDENTITY_ACCOUNT_ACTIVATED',
  accountSuspended: 'IDENTITY_ACCOUNT_SUSPENDED',
  accountReactivated: 'IDENTITY_ACCOUNT_REACTIVATED',
  accountDeactivated: 'IDENTITY_ACCOUNT_DEACTIVATED',

  membershipCreated: 'IDENTITY_MEMBERSHIP_CREATED',
  membershipActivated: 'IDENTITY_MEMBERSHIP_ACTIVATED',
  membershipSuspended: 'IDENTITY_MEMBERSHIP_SUSPENDED',
  membershipReactivated: 'IDENTITY_MEMBERSHIP_REACTIVATED',
  membershipEnded: 'IDENTITY_MEMBERSHIP_ENDED',
  membershipScopeChanged: 'IDENTITY_MEMBERSHIP_SCOPE_CHANGED',

  authSubjectLinked: 'IDENTITY_SUBJECT_LINKED',
} as const;

export type IdentityAuditCode = (typeof IDENTITY_AUDIT_CODES)[keyof typeof IDENTITY_AUDIT_CODES];
export const ALL_IDENTITY_AUDIT_CODES: readonly string[] = Object.values(IDENTITY_AUDIT_CODES);
export const IDENTITY_AUDIT_PREFIX = 'IDENTITY_';

interface ActionBinding<TCode, TEvent> {
  readonly auditCode: TCode;
  readonly eventType: TEvent;
  readonly permission: string;
}

/**
 * action -> (audit code, event type, permission), one total table per lifecycle.
 *
 * Total over the action union, so adding an action without its audit code, event or permission is a
 * compile error rather than a gap found in production. Same device as m01's TENANT_ACTION_MAP.
 */
export const IDENTITY_ACTION_MAP: Readonly<
  Record<IdentityAction, ActionBinding<IdentityAuditCode, IdentityLifecycleEventType>>
> = {
  activate: {
    auditCode: IDENTITY_AUDIT_CODES.identityActivated,
    eventType: 'IdentityActivated',
    permission: IDENTITY_PERMISSIONS.registryActivate,
  },
  suspend: {
    auditCode: IDENTITY_AUDIT_CODES.identitySuspended,
    eventType: 'IdentitySuspended',
    permission: IDENTITY_PERMISSIONS.registrySuspend,
  },
  reactivate: {
    auditCode: IDENTITY_AUDIT_CODES.identityReactivated,
    eventType: 'IdentityReactivated',
    permission: IDENTITY_PERMISSIONS.registryReactivate,
  },
  deactivate: {
    auditCode: IDENTITY_AUDIT_CODES.identityDeactivated,
    eventType: 'IdentitySuspended',
    permission: IDENTITY_PERMISSIONS.registrySuspend,
  },
  reject: {
    auditCode: IDENTITY_AUDIT_CODES.identityRejected,
    eventType: 'IdentitySuspended',
    permission: IDENTITY_PERMISSIONS.registrySuspend,
  },
  archive: {
    auditCode: IDENTITY_AUDIT_CODES.identityArchived,
    eventType: 'IdentitySuspended',
    permission: IDENTITY_PERMISSIONS.registryClose,
  },
  close: {
    auditCode: IDENTITY_AUDIT_CODES.identityClosed,
    eventType: 'IdentityClosed',
    permission: IDENTITY_PERMISSIONS.registryClose,
  },
};

export const ACCOUNT_ACTION_MAP: Readonly<
  Record<AccountAction, ActionBinding<IdentityAuditCode, IdentityLifecycleEventType>>
> = {
  activate: {
    auditCode: IDENTITY_AUDIT_CODES.accountActivated,
    eventType: 'AccountActivated',
    permission: IDENTITY_PERMISSIONS.accountActivate,
  },
  suspend: {
    auditCode: IDENTITY_AUDIT_CODES.accountSuspended,
    eventType: 'AccountSuspended',
    permission: IDENTITY_PERMISSIONS.accountSuspend,
  },
  reactivate: {
    auditCode: IDENTITY_AUDIT_CODES.accountReactivated,
    eventType: 'AccountReactivated',
    permission: IDENTITY_PERMISSIONS.accountReactivate,
  },
  deactivate: {
    auditCode: IDENTITY_AUDIT_CODES.accountDeactivated,
    eventType: 'AccountDeactivated',
    permission: IDENTITY_PERMISSIONS.accountDeactivate,
  },
};

export const MEMBERSHIP_ACTION_MAP: Readonly<
  Record<MembershipAction, ActionBinding<IdentityAuditCode, IdentityLifecycleEventType>>
> = {
  activate: {
    auditCode: IDENTITY_AUDIT_CODES.membershipActivated,
    eventType: 'TenantMembershipActivated',
    permission: IDENTITY_PERMISSIONS.membershipActivate,
  },
  suspend: {
    auditCode: IDENTITY_AUDIT_CODES.membershipSuspended,
    eventType: 'TenantMembershipSuspended',
    permission: IDENTITY_PERMISSIONS.membershipSuspend,
  },
  reactivate: {
    auditCode: IDENTITY_AUDIT_CODES.membershipReactivated,
    eventType: 'TenantMembershipReactivated',
    permission: IDENTITY_PERMISSIONS.membershipReactivate,
  },
  end: {
    auditCode: IDENTITY_AUDIT_CODES.membershipEnded,
    eventType: 'TenantMembershipEnded',
    permission: IDENTITY_PERMISSIONS.membershipEnd,
  },
};
