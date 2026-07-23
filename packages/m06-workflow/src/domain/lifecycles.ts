/**
 * Workflow lifecycle state machines (ADR-021/022) — PURE. Three machines: definition version, instance, and
 * task. Transitions are DATA; `checkTransition` is the single choke point the services call. Illegal
 * transitions are refused (the caller raises 409). Terminal states accept no further transition. Everything
 * here is deterministic and side-effect-free so it can be exhaustively proven by the PURE smoke suite.
 */

export interface Transition<S extends string, A extends string> {
  readonly from: S;
  readonly action: A;
  readonly to: S;
}

export interface Machine<S extends string, A extends string> {
  readonly statuses: readonly S[];
  readonly initial: S;
  readonly terminal: ReadonlySet<S>;
  readonly transitions: readonly Transition<S, A>[];
}

export type TransitionResult<S extends string> =
  { readonly ok: true; readonly to: S } | { readonly ok: false; readonly reason: string };

/** The one transition checker. Returns the next status or a reason for refusal — never throws. */
export function checkTransition<S extends string, A extends string>(
  machine: Machine<S, A>,
  from: S,
  action: A,
): TransitionResult<S> {
  if (machine.terminal.has(from)) {
    return { ok: false, reason: `'${from}' is terminal; '${action}' is not permitted` };
  }
  const match = machine.transitions.find((t) => t.from === from && t.action === action);
  if (match === undefined) {
    return { ok: false, reason: `'${action}' is not a legal transition from '${from}'` };
  }
  return { ok: true, to: match.to };
}

export function isTerminal<S extends string, A extends string>(machine: Machine<S, A>, status: S): boolean {
  return machine.terminal.has(status);
}

// --- Definition version lifecycle ------------------------------------------------------------------
// DRAFT -> VALIDATED -> PUBLISHED -> ACTIVE -> RETIRED -> ARCHIVED. Publishing FREEZES content (ADR-022):
// any status at or beyond PUBLISHED is immutable. `revise` returns a validated draft to DRAFT (edits are
// only ever applied in DRAFT). Activation deploys the version; retirement stops new starts (running
// instances continue on their frozen version).

export const DEFINITION_STATUSES = [
  'DRAFT',
  'VALIDATED',
  'PUBLISHED',
  'ACTIVE',
  'RETIRED',
  'ARCHIVED',
] as const;
export type DefinitionStatus = (typeof DEFINITION_STATUSES)[number];

export const DEFINITION_ACTIONS = ['validate', 'revise', 'publish', 'activate', 'retire', 'archive'] as const;
export type DefinitionAction = (typeof DEFINITION_ACTIONS)[number];

export const DEFINITION_MACHINE: Machine<DefinitionStatus, DefinitionAction> = {
  statuses: DEFINITION_STATUSES,
  initial: 'DRAFT',
  terminal: new Set<DefinitionStatus>(['ARCHIVED']),
  transitions: [
    { from: 'DRAFT', action: 'validate', to: 'VALIDATED' },
    { from: 'VALIDATED', action: 'revise', to: 'DRAFT' },
    { from: 'VALIDATED', action: 'publish', to: 'PUBLISHED' },
    { from: 'PUBLISHED', action: 'activate', to: 'ACTIVE' },
    { from: 'ACTIVE', action: 'retire', to: 'RETIRED' },
    { from: 'PUBLISHED', action: 'retire', to: 'RETIRED' },
    { from: 'RETIRED', action: 'archive', to: 'ARCHIVED' },
  ],
};

/** Content (`spec`) is immutable once a version reaches PUBLISHED — the core of ADR-022. */
export function isDefinitionContentFrozen(status: DefinitionStatus): boolean {
  return status === 'PUBLISHED' || status === 'ACTIVE' || status === 'RETIRED' || status === 'ARCHIVED';
}

export function checkDefinitionTransition(
  from: DefinitionStatus,
  action: DefinitionAction,
): TransitionResult<DefinitionStatus> {
  return checkTransition(DEFINITION_MACHINE, from, action);
}

// --- Instance lifecycle ----------------------------------------------------------------------------
// CREATED -> RUNNING <-> WAITING; either may SUSPEND and resume; RUNNING completes; any non-terminal may be
// cancelled; unrecoverable failure -> FAILED -> (COMPENSATING ->) terminal. COMPENSATING is reserved for the
// deferred compensation flow but modelled so the machine is complete.

export const INSTANCE_STATUSES = [
  'CREATED',
  'RUNNING',
  'WAITING',
  'SUSPENDED',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'COMPENSATING',
] as const;
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

export const INSTANCE_ACTIONS = [
  'start',
  'block',
  'unblock',
  'suspend',
  'resume',
  'complete',
  'cancel',
  'fail',
  'compensate',
  'compensated',
] as const;
export type InstanceAction = (typeof INSTANCE_ACTIONS)[number];

export const INSTANCE_MACHINE: Machine<InstanceStatus, InstanceAction> = {
  statuses: INSTANCE_STATUSES,
  initial: 'CREATED',
  terminal: new Set<InstanceStatus>(['COMPLETED', 'CANCELLED', 'FAILED']),
  transitions: [
    { from: 'CREATED', action: 'start', to: 'RUNNING' },
    { from: 'RUNNING', action: 'block', to: 'WAITING' },
    { from: 'WAITING', action: 'unblock', to: 'RUNNING' },
    { from: 'RUNNING', action: 'suspend', to: 'SUSPENDED' },
    { from: 'WAITING', action: 'suspend', to: 'SUSPENDED' },
    { from: 'SUSPENDED', action: 'resume', to: 'RUNNING' },
    { from: 'RUNNING', action: 'complete', to: 'COMPLETED' },
    { from: 'CREATED', action: 'cancel', to: 'CANCELLED' },
    { from: 'RUNNING', action: 'cancel', to: 'CANCELLED' },
    { from: 'WAITING', action: 'cancel', to: 'CANCELLED' },
    { from: 'SUSPENDED', action: 'cancel', to: 'CANCELLED' },
    { from: 'RUNNING', action: 'fail', to: 'FAILED' },
    { from: 'WAITING', action: 'fail', to: 'FAILED' },
    { from: 'FAILED', action: 'compensate', to: 'COMPENSATING' },
    { from: 'COMPENSATING', action: 'compensated', to: 'CANCELLED' },
    { from: 'COMPENSATING', action: 'fail', to: 'FAILED' },
  ],
};

export function checkInstanceTransition(
  from: InstanceStatus,
  action: InstanceAction,
): TransitionResult<InstanceStatus> {
  return checkTransition(INSTANCE_MACHINE, from, action);
}

// --- Task lifecycle --------------------------------------------------------------------------------
// CREATED -> AVAILABLE -> CLAIMED -> IN_PROGRESS -> {COMPLETED | REJECTED}. Available/claimed tasks may be
// delegated/escalated/cancelled/expired. FAILED is a system outcome. DELEGATED/ESCALATED are terminal for
// THIS task row — a new/rerouted task is created by the engine.

export const TASK_STATUSES = [
  'CREATED',
  'AVAILABLE',
  'CLAIMED',
  'IN_PROGRESS',
  'COMPLETED',
  'REJECTED',
  'DELEGATED',
  'ESCALATED',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_ACTIONS = [
  'offer',
  'claim',
  'start',
  'complete',
  'reject',
  'delegate',
  'escalate',
  'cancel',
  'expire',
  'fail',
  'release',
] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

export const TASK_MACHINE: Machine<TaskStatus, TaskAction> = {
  statuses: TASK_STATUSES,
  initial: 'CREATED',
  terminal: new Set<TaskStatus>([
    'COMPLETED',
    'REJECTED',
    'DELEGATED',
    'ESCALATED',
    'CANCELLED',
    'EXPIRED',
    'FAILED',
  ]),
  transitions: [
    { from: 'CREATED', action: 'offer', to: 'AVAILABLE' },
    { from: 'AVAILABLE', action: 'claim', to: 'CLAIMED' },
    { from: 'CLAIMED', action: 'release', to: 'AVAILABLE' },
    { from: 'CLAIMED', action: 'start', to: 'IN_PROGRESS' },
    { from: 'IN_PROGRESS', action: 'complete', to: 'COMPLETED' },
    { from: 'CLAIMED', action: 'complete', to: 'COMPLETED' },
    { from: 'IN_PROGRESS', action: 'reject', to: 'REJECTED' },
    { from: 'CLAIMED', action: 'reject', to: 'REJECTED' },
    // reassignment/delegation/escalation may act on an available OR claimed task
    { from: 'AVAILABLE', action: 'delegate', to: 'DELEGATED' },
    { from: 'CLAIMED', action: 'delegate', to: 'DELEGATED' },
    { from: 'IN_PROGRESS', action: 'delegate', to: 'DELEGATED' },
    { from: 'AVAILABLE', action: 'escalate', to: 'ESCALATED' },
    { from: 'CLAIMED', action: 'escalate', to: 'ESCALATED' },
    { from: 'IN_PROGRESS', action: 'escalate', to: 'ESCALATED' },
    { from: 'AVAILABLE', action: 'expire', to: 'EXPIRED' },
    { from: 'CLAIMED', action: 'expire', to: 'EXPIRED' },
    { from: 'AVAILABLE', action: 'cancel', to: 'CANCELLED' },
    { from: 'CLAIMED', action: 'cancel', to: 'CANCELLED' },
    { from: 'IN_PROGRESS', action: 'cancel', to: 'CANCELLED' },
    { from: 'CREATED', action: 'cancel', to: 'CANCELLED' },
    { from: 'AVAILABLE', action: 'fail', to: 'FAILED' },
    { from: 'CLAIMED', action: 'fail', to: 'FAILED' },
    { from: 'IN_PROGRESS', action: 'fail', to: 'FAILED' },
  ],
};

export function checkTaskTransition(from: TaskStatus, action: TaskAction): TransitionResult<TaskStatus> {
  return checkTransition(TASK_MACHINE, from, action);
}
