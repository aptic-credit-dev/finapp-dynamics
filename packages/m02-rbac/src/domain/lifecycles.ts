/**
 * Role and assignment state machines — pure. Same action→from→to shape as m01/m02, reason required on
 * adverse/terminal transitions.
 */

// --- role ------------------------------------------------------------------------------------------
export const ROLE_STATUSES = ['draft', 'active', 'suspended', 'retired'] as const;
export type RoleStatus = (typeof ROLE_STATUSES)[number];
export function isRoleStatus(v: string): v is RoleStatus {
  return (ROLE_STATUSES as readonly string[]).includes(v);
}
export type RoleAction = 'activate' | 'suspend' | 'reactivate' | 'retire';

interface Transition<S extends string, A extends string> {
  readonly action: A;
  readonly from: readonly S[];
  readonly to: S;
  readonly reasonRequired: boolean;
}

export const ROLE_TRANSITIONS: readonly Transition<RoleStatus, RoleAction>[] = [
  { action: 'activate', from: ['draft'], to: 'active', reasonRequired: false },
  { action: 'suspend', from: ['active'], to: 'suspended', reasonRequired: true },
  { action: 'reactivate', from: ['suspended'], to: 'active', reasonRequired: false },
  { action: 'retire', from: ['draft', 'active', 'suspended'], to: 'retired', reasonRequired: true },
];
export const ROLE_TERMINAL: readonly RoleStatus[] = ['retired'];

/** Only an ACTIVE role's permissions count — suspended/retired/draft grant nothing (fail closed). */
export function roleGrantsPermissions(status: RoleStatus): boolean {
  return status === 'active';
}

// --- assignment ------------------------------------------------------------------------------------
export const ASSIGNMENT_STATUSES = ['active', 'suspended', 'revoked', 'expired'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export function isAssignmentStatus(v: string): v is AssignmentStatus {
  return (ASSIGNMENT_STATUSES as readonly string[]).includes(v);
}
export type AssignmentAction = 'suspend' | 'reactivate' | 'revoke' | 'expire';

export const ASSIGNMENT_TRANSITIONS: readonly Transition<AssignmentStatus, AssignmentAction>[] = [
  { action: 'suspend', from: ['active'], to: 'suspended', reasonRequired: true },
  { action: 'reactivate', from: ['suspended'], to: 'active', reasonRequired: false },
  { action: 'revoke', from: ['active', 'suspended'], to: 'revoked', reasonRequired: true },
  { action: 'expire', from: ['active', 'suspended'], to: 'expired', reasonRequired: false },
];
export const ASSIGNMENT_TERMINAL: readonly AssignmentStatus[] = ['revoked', 'expired'];

/**
 * An assignment yields permissions only while active AND within its effective window. Anything else — a
 * suspended/revoked/expired status, a not-yet-effective or past-expiry window — yields nothing.
 */
export function assignmentIsEffective(
  status: AssignmentStatus,
  nowMs: number,
  effectiveFromMs: number | null,
  expiresAtMs: number | null,
): boolean {
  if (status !== 'active') return false;
  if (effectiveFromMs !== null && nowMs < effectiveFromMs) return false;
  if (expiresAtMs !== null && nowMs >= expiresAtMs) return false;
  return true;
}

// --- shared checker --------------------------------------------------------------------------------
export interface TransitionCheck<S extends string> {
  readonly allowed: boolean;
  readonly to?: S;
  readonly reason?: string;
}

function check<S extends string, A extends string>(
  transitions: readonly Transition<S, A>[],
  terminal: readonly S[],
  from: S,
  action: A,
  opts: { reason?: string | undefined },
): TransitionCheck<S> {
  const t = transitions.find((x) => x.action === action);
  if (t === undefined) return { allowed: false, reason: `Unknown action "${action}".` };
  if (terminal.includes(from)) return { allowed: false, reason: `Status is ${from}, which is terminal.` };
  if (!t.from.includes(from)) {
    return { allowed: false, reason: `Cannot ${action} from "${from}". Allowed from: ${t.from.join(', ')}.` };
  }
  if (t.reasonRequired && (opts.reason === undefined || opts.reason.trim() === '')) {
    return { allowed: false, reason: `Action "${action}" requires a reason.` };
  }
  return { allowed: true, to: t.to };
}

export function checkRoleTransition(
  from: RoleStatus,
  action: RoleAction,
  opts: { reason?: string | undefined } = {},
): TransitionCheck<RoleStatus> {
  return check(ROLE_TRANSITIONS, ROLE_TERMINAL, from, action, opts);
}

export function checkAssignmentTransition(
  from: AssignmentStatus,
  action: AssignmentAction,
  opts: { reason?: string | undefined } = {},
): TransitionCheck<AssignmentStatus> {
  return check(ASSIGNMENT_TRANSITIONS, ASSIGNMENT_TERMINAL, from, action, opts);
}
