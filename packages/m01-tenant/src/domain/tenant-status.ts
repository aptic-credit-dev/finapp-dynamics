/**
 * The tenant lifecycle state machine — the deterministic safety core of M01.
 *
 * Pure: no database, no clock, no DI. Every transition in the platform is decided here and then
 * enforced server-side, so a client cannot drive a tenant into a state the governance model forbids by
 * calling endpoints out of order.
 */

export const TENANT_STATUSES = [
  'draft',
  'under_review',
  'approved',
  'rejected',
  'provisioning',
  'provisioning_failed',
  'active',
  'restricted',
  'suspended',
  'closed',
] as const;

export type TenantStatus = (typeof TENANT_STATUSES)[number];

export function isTenantStatus(value: string): value is TenantStatus {
  return (TENANT_STATUSES as readonly string[]).includes(value);
}

/**
 * The transitions the platform allows, keyed by the action that performs them.
 *
 * Modelled as action -> (from -> to) rather than a bare from -> to graph, because two different actions
 * can leave the same state for different reasons (`approve` and `reject` both leave `under_review`) and
 * each needs its own permission and audit code. A bare graph would lose that.
 */
export interface TenantTransition {
  readonly action: TenantAction;
  readonly from: readonly TenantStatus[];
  readonly to: TenantStatus;
  /** Whether the caller must supply a reason. Required wherever the outcome is adverse or terminal. */
  readonly reasonRequired: boolean;
}

export type TenantAction =
  | 'submit_review'
  | 'approve'
  | 'reject'
  | 'start_provisioning'
  | 'complete_provisioning'
  | 'fail_provisioning'
  | 'activate'
  | 'restrict'
  | 'suspend'
  | 'reactivate'
  | 'close';

export const TENANT_TRANSITIONS: readonly TenantTransition[] = [
  { action: 'submit_review', from: ['draft'], to: 'under_review', reasonRequired: false },
  { action: 'approve', from: ['under_review'], to: 'approved', reasonRequired: false },
  // Adverse outcome: a rejected applicant is owed the reason, and the auditor is owed it too.
  { action: 'reject', from: ['under_review'], to: 'rejected', reasonRequired: true },

  // Retryable: provisioning may be re-attempted after a failure without re-approval, because the
  // approval decision has not changed — only the machinery failed.
  {
    action: 'start_provisioning',
    from: ['approved', 'provisioning_failed'],
    to: 'provisioning',
    reasonRequired: false,
  },
  { action: 'complete_provisioning', from: ['provisioning'], to: 'approved', reasonRequired: false },
  { action: 'fail_provisioning', from: ['provisioning'], to: 'provisioning_failed', reasonRequired: true },

  { action: 'activate', from: ['approved'], to: 'active', reasonRequired: false },

  { action: 'restrict', from: ['active'], to: 'restricted', reasonRequired: true },
  { action: 'suspend', from: ['active', 'restricted'], to: 'suspended', reasonRequired: true },
  { action: 'reactivate', from: ['restricted', 'suspended'], to: 'active', reasonRequired: false },

  {
    action: 'close',
    from: [
      'draft',
      'under_review',
      'approved',
      'rejected',
      'provisioning_failed',
      'active',
      'restricted',
      'suspended',
    ],
    to: 'closed',
    reasonRequired: true,
  },
];

/**
 * `closed` is terminal and `rejected` is near-terminal (only `close` leaves it).
 *
 * Terminal means terminal: there is no `reopen`. Resurrecting a closed tenant would silently reattach
 * historical data — its users, its audit trail, its journals — to a new commercial relationship that
 * never consented to it. A new tenant is a new tenant.
 */
export const TERMINAL_STATUSES: readonly TenantStatus[] = ['closed'];

export function isTerminal(status: TenantStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** The transition for an action, or undefined if the action is unknown. */
export function transitionFor(action: TenantAction): TenantTransition | undefined {
  return TENANT_TRANSITIONS.find((t) => t.action === action);
}

export interface TransitionCheck {
  readonly allowed: boolean;
  readonly to?: TenantStatus;
  readonly reason?: string;
}

/**
 * Decides whether `action` may be applied to a tenant currently in `from`.
 *
 * Fail closed: an unknown action, a disallowed source state, or a missing required reason is a denial
 * with a stated cause. There is no "probably fine" branch.
 */
export function checkTransition(
  from: TenantStatus,
  action: TenantAction,
  opts: { reason?: string | undefined } = {},
): TransitionCheck {
  const transition = transitionFor(action);
  if (transition === undefined) {
    return { allowed: false, reason: `Unknown tenant action "${action}".` };
  }

  if (isTerminal(from)) {
    return {
      allowed: false,
      reason: `Tenant is ${from}, which is terminal. No further transitions are possible.`,
    };
  }

  if (!transition.from.includes(from)) {
    return {
      allowed: false,
      reason: `Cannot ${action} a tenant in status "${from}". Allowed from: ${transition.from.join(', ')}.`,
    };
  }

  if (transition.reasonRequired && (opts.reason === undefined || opts.reason.trim() === '')) {
    return { allowed: false, reason: `Action "${action}" requires a reason.` };
  }

  return { allowed: true, to: transition.to };
}

/**
 * Whether the tenant may perform ordinary business operations.
 *
 * `restricted` is deliberately read-only rather than blocked: restriction is a commercial or compliance
 * measure, and cutting off a tenant's ability to read its own records would turn a billing dispute into
 * a data-availability incident.
 */
export function allowsBusinessWrites(status: TenantStatus): boolean {
  return status === 'active';
}

export function allowsBusinessReads(status: TenantStatus): boolean {
  return status === 'active' || status === 'restricted';
}
