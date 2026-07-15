import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `identity.lifecycle` event family — owned by m02-identity (manifests/naming-map.yaml).
 *
 * CLASSIFICATION IS `confidential`, one level above `tenant.lifecycle`'s `internal`. These events concern
 * natural persons, so they are personal data under the Kenya DPA (OPEN_QUESTIONS #6/#7) and must never
 * reach an unapproved AI provider (ADR-006).
 *
 * Payloads therefore carry identifiers and transitions ONLY — never an email, a phone number, a display
 * name or an external reference. An event reaches every subscriber of the family and the outbox retains
 * it, so anything included here is copied to places the person never consented to. A consumer that needs
 * the profile reads it back through the API under its own permissions.
 */

export const IDENTITY_LIFECYCLE_FAMILY = 'identity.lifecycle';
export const IDENTITY_LIFECYCLE_VERSION = 1;

export type IdentityLifecycleEventType =
  | 'IdentityCreated'
  | 'IdentityUpdated'
  | 'IdentityActivated'
  | 'IdentitySuspended'
  | 'IdentityReactivated'
  | 'IdentityClosed'
  | 'AccountCreated'
  | 'AccountActivated'
  | 'AccountSuspended'
  | 'AccountReactivated'
  | 'AccountDeactivated'
  | 'TenantMembershipCreated'
  | 'TenantMembershipActivated'
  | 'TenantMembershipSuspended'
  | 'TenantMembershipReactivated'
  | 'TenantMembershipEnded'
  | 'TenantMembershipScopeChanged'
  | 'AuthenticationSubjectLinked';

export const IDENTITY_LIFECYCLE_EVENT_TYPES: readonly IdentityLifecycleEventType[] = [
  'IdentityCreated',
  'IdentityUpdated',
  'IdentityActivated',
  'IdentitySuspended',
  'IdentityReactivated',
  'IdentityClosed',
  'AccountCreated',
  'AccountActivated',
  'AccountSuspended',
  'AccountReactivated',
  'AccountDeactivated',
  'TenantMembershipCreated',
  'TenantMembershipActivated',
  'TenantMembershipSuspended',
  'TenantMembershipReactivated',
  'TenantMembershipEnded',
  'TenantMembershipScopeChanged',
  'AuthenticationSubjectLinked',
];

/** An identity's status changed. No name, no email — the identity id is the reference. */
export interface IdentityStatusChangePayload {
  readonly identityId: string;
  readonly identityType: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly reason?: string;
}

/** A profile field changed. Names the fields, never their values. */
export interface IdentityUpdatedPayload {
  readonly identityId: string;
  readonly changedFields: readonly string[];
}

export interface AccountStatusChangePayload {
  readonly accountId: string;
  readonly identityId: string;
  readonly accountType: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly reason?: string;
}

export interface MembershipStatusChangePayload {
  readonly membershipId: string;
  readonly tenantId: string;
  readonly identityId: string;
  readonly accountId: string | null;
  readonly membershipType: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly reason?: string;
}

export interface MembershipScopeChangedPayload {
  readonly membershipId: string;
  readonly tenantId: string;
  readonly changedFields: readonly string[];
}

/** An external auth subject was linked. Carries the provider and issuer — never the subject itself. */
export interface AuthenticationSubjectLinkedPayload {
  readonly accountId: string;
  readonly providerCode: string;
  readonly issuer: string;
}

export type IdentityLifecyclePayload =
  | IdentityStatusChangePayload
  | IdentityUpdatedPayload
  | AccountStatusChangePayload
  | MembershipStatusChangePayload
  | MembershipScopeChangedPayload
  | AuthenticationSubjectLinkedPayload;

/**
 * The `identity.lifecycle` envelope.
 *
 * `tenantId` on the envelope is mandatory platform-wide (ADR-001). Identity and account events are not
 * inherently tenant-scoped — a person exists before and across tenants — so those events carry the
 * PLATFORM_TENANT sentinel below rather than a fake tenant. Membership events carry the real tenant.
 */
export type IdentityLifecycleEvent = DomainEventEnvelope<
  typeof IDENTITY_LIFECYCLE_FAMILY,
  IdentityLifecycleEventType,
  IdentityLifecyclePayload
>;

/**
 * The tenant id used by platform-scoped identity events.
 *
 * The all-zero UUID, deliberately: it is a value no tenant can ever have, so a consumer filtering by its
 * own tenant will never accidentally match a platform event, and a platform event can never be mistaken
 * for one tenant's business. Inventing a real-looking tenant id here would be a lie that consumers would
 * eventually join on.
 */
export const PLATFORM_TENANT = '00000000-0000-0000-0000-000000000000';
