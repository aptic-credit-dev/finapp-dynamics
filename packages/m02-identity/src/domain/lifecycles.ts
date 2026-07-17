/**
 * The three M02 lifecycles — identity, account, membership. Pure: no database, no clock, no DI.
 *
 * They are SEPARATE state machines on purpose. An identity is a person; an account is a way that person
 * logs in; a membership is that person's relationship with one tenant. Collapsing them into one status
 * column is how "this contractor left" becomes indistinguishable from "this contractor's login is
 * disabled in tenant A but they are still active in tenant B".
 *
 * Modelled exactly like m01's tenant lifecycle (action -> from -> to, reason required on adverse or
 * terminal outcomes), because it is a proven shape in this repo and a second dialect would be a second
 * thing to learn and to get wrong.
 */

// ---------------------------------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------------------------------

export const IDENTITY_STATUSES = [
  'draft',
  'active',
  'inactive',
  'suspended',
  'rejected',
  'archived',
  'closed',
] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

export function isIdentityStatus(value: string): value is IdentityStatus {
  return (IDENTITY_STATUSES as readonly string[]).includes(value);
}

export type IdentityAction =
  'activate' | 'suspend' | 'reactivate' | 'deactivate' | 'reject' | 'archive' | 'close';

// ---------------------------------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------------------------------

export const ACCOUNT_STATUSES = [
  'pending_activation',
  'active',
  'suspended',
  'deactivated',
  'locked',
  'expired',
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export function isAccountStatus(value: string): value is AccountStatus {
  return (ACCOUNT_STATUSES as readonly string[]).includes(value);
}

export type AccountAction = 'activate' | 'suspend' | 'reactivate' | 'deactivate';

// ---------------------------------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------------------------------

export const MEMBERSHIP_STATUSES = ['pending', 'active', 'suspended', 'ended'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export function isMembershipStatus(value: string): value is MembershipStatus {
  return (MEMBERSHIP_STATUSES as readonly string[]).includes(value);
}

export type MembershipAction = 'activate' | 'suspend' | 'reactivate' | 'end';

// ---------------------------------------------------------------------------------------------------
// The shared machine
// ---------------------------------------------------------------------------------------------------

export interface Transition<TStatus extends string, TAction extends string> {
  readonly action: TAction;
  readonly from: readonly TStatus[];
  readonly to: TStatus;
  readonly reasonRequired: boolean;
}

export interface TransitionCheck<TStatus extends string> {
  readonly allowed: boolean;
  readonly to?: TStatus;
  readonly reason?: string;
}

function check<TStatus extends string, TAction extends string>(
  transitions: readonly Transition<TStatus, TAction>[],
  terminal: readonly TStatus[],
  from: TStatus,
  action: TAction,
  opts: { reason?: string | undefined },
): TransitionCheck<TStatus> {
  const transition = transitions.find((t) => t.action === action);
  if (transition === undefined) return { allowed: false, reason: `Unknown action "${action}".` };

  if (terminal.includes(from)) {
    return { allowed: false, reason: `Status is ${from}, which is terminal. No further transitions.` };
  }
  if (!transition.from.includes(from)) {
    return {
      allowed: false,
      reason: `Cannot ${action} from status "${from}". Allowed from: ${transition.from.join(', ')}.`,
    };
  }
  if (transition.reasonRequired && (opts.reason === undefined || opts.reason.trim() === '')) {
    return { allowed: false, reason: `Action "${action}" requires a reason.` };
  }
  return { allowed: true, to: transition.to };
}

// --- identity transitions ---------------------------------------------------------------------------

export const IDENTITY_TRANSITIONS: readonly Transition<IdentityStatus, IdentityAction>[] = [
  { action: 'activate', from: ['draft'], to: 'active', reasonRequired: false },
  { action: 'reject', from: ['draft'], to: 'rejected', reasonRequired: true },
  { action: 'suspend', from: ['active'], to: 'suspended', reasonRequired: true },
  { action: 'reactivate', from: ['suspended', 'inactive'], to: 'active', reasonRequired: false },
  { action: 'deactivate', from: ['active'], to: 'inactive', reasonRequired: true },
  // Archival is a records-retention state, not a lifecycle outcome: an inactive person's record is kept
  // but taken out of circulation. It is NOT deletion — nothing here deletes a person (ADR-010).
  { action: 'archive', from: ['inactive', 'rejected'], to: 'archived', reasonRequired: true },
  {
    action: 'close',
    from: ['draft', 'active', 'inactive', 'suspended', 'rejected', 'archived'],
    to: 'closed',
    reasonRequired: true,
  },
];

/** `closed` is terminal. There is no reopen — the same rule, for the same reason, as m01's tenants. */
export const IDENTITY_TERMINAL: readonly IdentityStatus[] = ['closed'];

export function checkIdentityTransition(
  from: IdentityStatus,
  action: IdentityAction,
  opts: { reason?: string | undefined } = {},
): TransitionCheck<IdentityStatus> {
  return check(IDENTITY_TRANSITIONS, IDENTITY_TERMINAL, from, action, opts);
}

/**
 * Whether an identity may be resolved as an actor.
 *
 * ONLY `active`. Everything else — draft, suspended, inactive, rejected, archived, closed — is refused.
 * This is the check that makes "suspend this person" mean something: a suspended identity that could
 * still act would make suspension a label rather than a control.
 */
export function identityCanResolve(status: IdentityStatus): boolean {
  return status === 'active';
}

// --- account transitions ----------------------------------------------------------------------------

export const ACCOUNT_TRANSITIONS: readonly Transition<AccountStatus, AccountAction>[] = [
  { action: 'activate', from: ['pending_activation'], to: 'active', reasonRequired: false },
  { action: 'suspend', from: ['active'], to: 'suspended', reasonRequired: true },
  // `locked` and `expired` are Stage 1C states (lockout, credential expiry). They are declared so the
  // column and the CHECK constraint do not have to change later, but NOTHING in 1B produces them —
  // reactivate accepts them as sources so 1C can wire lockout without touching this machine.
  { action: 'reactivate', from: ['suspended', 'locked', 'expired'], to: 'active', reasonRequired: false },
  {
    action: 'deactivate',
    from: ['pending_activation', 'active', 'suspended', 'locked', 'expired'],
    to: 'deactivated',
    reasonRequired: true,
  },
];

/** `deactivated` is terminal. A new account is a new account (m01's reasoning, applied to logins). */
export const ACCOUNT_TERMINAL: readonly AccountStatus[] = ['deactivated'];

export function checkAccountTransition(
  from: AccountStatus,
  action: AccountAction,
  opts: { reason?: string | undefined } = {},
): TransitionCheck<AccountStatus> {
  return check(ACCOUNT_TRANSITIONS, ACCOUNT_TERMINAL, from, action, opts);
}

/** Only an `active` account may be resolved as an actor. */
export function accountCanResolve(status: AccountStatus): boolean {
  return status === 'active';
}

// --- membership transitions -------------------------------------------------------------------------

export const MEMBERSHIP_TRANSITIONS: readonly Transition<MembershipStatus, MembershipAction>[] = [
  { action: 'activate', from: ['pending'], to: 'active', reasonRequired: false },
  { action: 'suspend', from: ['active'], to: 'suspended', reasonRequired: true },
  { action: 'reactivate', from: ['suspended'], to: 'active', reasonRequired: false },
  { action: 'end', from: ['pending', 'active', 'suspended'], to: 'ended', reasonRequired: true },
];

/**
 * `ended` is terminal — a leaver's membership is never revived.
 *
 * A mover gets a NEW membership rather than a mutated one: reviving an ended membership would erase the
 * record that the gap ever existed, and that gap is exactly what a joiner/mover/leaver audit asks about.
 */
export const MEMBERSHIP_TERMINAL: readonly MembershipStatus[] = ['ended'];

export function checkMembershipTransition(
  from: MembershipStatus,
  action: MembershipAction,
  opts: { reason?: string | undefined } = {},
): TransitionCheck<MembershipStatus> {
  return check(MEMBERSHIP_TRANSITIONS, MEMBERSHIP_TERMINAL, from, action, opts);
}

/** Only an `active` membership admits an actor to a tenant. */
export function membershipCanResolve(status: MembershipStatus): boolean {
  return status === 'active';
}
