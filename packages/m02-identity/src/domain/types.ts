/**
 * Identity, account and membership type catalogues — pure.
 *
 * Catalogue-driven and FK-backed, exactly as m01 does with tenant types: a CHECK constraint drifts the
 * moment someone adds a type in code and forgets the migration; a FK to a seeded reference table cannot.
 */

export const IDENTITY_TYPES = [
  'internal_person',
  'external_person',
  'contractor',
  'partner_user',
  'service_identity',
  'system_identity',
] as const;
export type IdentityType = (typeof IDENTITY_TYPES)[number];

export function isIdentityType(value: string): value is IdentityType {
  return (IDENTITY_TYPES as readonly string[]).includes(value);
}

/** A person, as opposed to a machine principal. Drives which fields are required and what may resolve. */
export const HUMAN_IDENTITY_TYPES: readonly IdentityType[] = [
  'internal_person',
  'external_person',
  'contractor',
  'partner_user',
];

export function isHumanIdentity(type: IdentityType): boolean {
  return HUMAN_IDENTITY_TYPES.includes(type);
}

export const ACCOUNT_TYPES = ['human', 'service', 'system', 'integration'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export function isAccountType(value: string): value is AccountType {
  return (ACCOUNT_TYPES as readonly string[]).includes(value);
}

export const MEMBERSHIP_TYPES = ['employee', 'contractor', 'partner', 'external', 'service'] as const;
export type MembershipType = (typeof MEMBERSHIP_TYPES)[number];

export function isMembershipType(value: string): value is MembershipType {
  return (MEMBERSHIP_TYPES as readonly string[]).includes(value);
}

/**
 * The named system actors (§4.5).
 *
 * They are a CLOSED list, not free text. A system actor is a principal with a narrow, stated purpose;
 * letting one be created by name would make "system" an unbounded namespace in which anything could hide.
 */
export const SYSTEM_ACTORS = [
  'platform_system',
  'migration_service',
  'scheduler_service',
  'integration_service',
] as const;
export type SystemActor = (typeof SYSTEM_ACTORS)[number];

export function isSystemActor(value: string): value is SystemActor {
  return (SYSTEM_ACTORS as readonly string[]).includes(value);
}

/**
 * Which identity types an account type may be bound to.
 *
 * The rule that matters: a `human` account cannot be bound to a `system_identity`, and a `system`
 * account cannot be bound to a person. Without it, "log in as the scheduler" becomes possible, and every
 * audit row it produced would name a machine for something a human did.
 */
export function accountTypeAllowsIdentityType(accountType: AccountType, identityType: IdentityType): boolean {
  switch (accountType) {
    case 'human':
      return isHumanIdentity(identityType);
    case 'service':
    case 'integration':
      return identityType === 'service_identity';
    case 'system':
      return identityType === 'system_identity';
  }
}

/**
 * Whether a system actor may act on behalf of a human.
 *
 * Always false, and there is deliberately no flag to change it. A system identity that could borrow human
 * permissions is impersonation without the word — §4.5 requires that a system actor not inherit arbitrary
 * human permissions, and the safest way to guarantee that is to have no code path that grants it.
 */
export function systemActorInheritsHumanPermissions(): false {
  return false;
}
