/**
 * The M17 state machines — PURE transition checkers, the single choke point every service lifecycle mutation goes
 * through (mirrors m07/m08/m09/m12/m13/m14/m16). Machines:
 *  - RECOVERY: draft → referred → under_review → strategy_selection → (demand_issued / negotiation /
 *    arrangement_active / enforcement_active → attachment / execution / auction / security_realization /
 *    agent_recovery → partial_recovery / recovered / write_off_recommended → written_off) → resolved → closed,
 *    with reopened / suspended / settled / uncollectible / withdrawn / archived branches.
 *  - RECOVERY-TYPE / SLA-POLICY spec: DRAFT → VALIDATED → PUBLISHED → ACTIVE → RETIRED → ARCHIVED (frozen at
 *    PUBLISHED, mirrors m09 doctype / m16).
 * Each checker returns the resulting status or a machine-readable reason; callers fail closed on `!ok`.
 */

export interface TransitionResult {
  readonly ok: boolean;
  readonly to?: string;
  readonly reason?: string;
}

function transition(machine: Record<string, string[]>, from: string, to: string): TransitionResult {
  const forState = machine[from];
  if (forState === undefined) return { ok: false, reason: `unknown state "${from}"` };
  if (!forState.includes(to)) return { ok: false, reason: `cannot move "${from}" -> "${to}"` };
  return { ok: true, to };
}

// --- recovery lifecycle ------------------------------------------------------------------------
export const RECOVERY_STATUSES = [
  'draft',
  'referred',
  'under_review',
  'strategy_selection',
  'demand_issued',
  'awaiting_response',
  'negotiation',
  'arrangement_pending',
  'arrangement_active',
  'arrangement_default',
  'enforcement_pending',
  'enforcement_active',
  'attachment',
  'execution',
  'auction',
  'security_realization',
  'agent_recovery',
  'partial_recovery',
  'recovered',
  'write_off_recommended',
  'written_off',
  'uncollectible',
  'settled',
  'suspended',
  'resolved',
  'closed',
  'reopened',
  'withdrawn',
  'archived',
] as const;
export type RecoveryStatus = (typeof RECOVERY_STATUSES)[number];

const RECOVERY_MACHINE: Record<string, string[]> = {
  draft: ['referred', 'under_review', 'withdrawn'],
  referred: ['under_review', 'strategy_selection', 'withdrawn'],
  under_review: ['strategy_selection', 'demand_issued', 'suspended', 'withdrawn', 'uncollectible'],
  strategy_selection: [
    'demand_issued',
    'negotiation',
    'enforcement_pending',
    'agent_recovery',
    'security_realization',
    'write_off_recommended',
    'withdrawn',
  ],
  demand_issued: ['awaiting_response', 'negotiation', 'enforcement_pending', 'withdrawn'],
  awaiting_response: [
    'negotiation',
    'arrangement_pending',
    'enforcement_pending',
    'partial_recovery',
    'recovered',
    'withdrawn',
  ],
  negotiation: [
    'arrangement_pending',
    'settled',
    'enforcement_pending',
    'write_off_recommended',
    'withdrawn',
  ],
  arrangement_pending: ['arrangement_active', 'negotiation', 'withdrawn'],
  arrangement_active: ['arrangement_default', 'partial_recovery', 'recovered', 'settled', 'withdrawn'],
  arrangement_default: [
    'negotiation',
    'enforcement_pending',
    'arrangement_active',
    'write_off_recommended',
    'withdrawn',
  ],
  enforcement_pending: ['enforcement_active', 'agent_recovery', 'security_realization', 'withdrawn'],
  enforcement_active: [
    'attachment',
    'execution',
    'auction',
    'security_realization',
    'partial_recovery',
    'recovered',
    'write_off_recommended',
    'withdrawn',
  ],
  attachment: ['execution', 'auction', 'partial_recovery', 'recovered', 'withdrawn'],
  execution: ['auction', 'partial_recovery', 'recovered', 'withdrawn'],
  auction: ['partial_recovery', 'recovered', 'security_realization', 'withdrawn'],
  security_realization: ['partial_recovery', 'recovered', 'write_off_recommended', 'withdrawn'],
  agent_recovery: ['partial_recovery', 'recovered', 'negotiation', 'write_off_recommended', 'withdrawn'],
  partial_recovery: [
    'negotiation',
    'enforcement_active',
    'recovered',
    'write_off_recommended',
    'settled',
    'resolved',
    'withdrawn',
  ],
  recovered: ['resolved', 'closed'],
  write_off_recommended: ['written_off', 'enforcement_active', 'negotiation', 'withdrawn'],
  written_off: ['resolved', 'closed', 'reopened'],
  uncollectible: ['write_off_recommended', 'closed', 'reopened'],
  settled: ['partial_recovery', 'recovered', 'resolved', 'closed'],
  suspended: ['under_review', 'strategy_selection', 'withdrawn'],
  resolved: ['closed', 'reopened'],
  closed: ['reopened', 'archived'],
  reopened: ['strategy_selection', 'negotiation', 'enforcement_pending', 'resolved', 'withdrawn'],
  withdrawn: ['reopened', 'archived'],
  archived: [],
};

export function checkRecoveryTransition(from: string, to: string): TransitionResult {
  return transition(RECOVERY_MACHINE, from, to);
}

/** Fully terminal — no further work (a closed/withdrawn recovery is reopenable, so it is NOT terminal here). */
export const RECOVERY_TERMINAL: readonly string[] = ['archived'];
export function isRecoveryTerminal(s: string): boolean {
  return RECOVERY_TERMINAL.includes(s);
}
export function isRecoveryOpen(s: string): boolean {
  return s !== 'closed' && s !== 'withdrawn' && !isRecoveryTerminal(s);
}

// --- spec lifecycle (recovery type + sla policy) -----------------------------------------------
export const SPEC_STATUSES = ['DRAFT', 'VALIDATED', 'PUBLISHED', 'ACTIVE', 'RETIRED', 'ARCHIVED'] as const;
export type SpecStatus = (typeof SPEC_STATUSES)[number];
export const SPEC_ACTIONS = ['validate', 'publish', 'activate', 'retire', 'archive'] as const;
export type SpecAction = (typeof SPEC_ACTIONS)[number];
const SPEC_MACHINE: Record<string, string[]> = {
  DRAFT: ['VALIDATED'],
  VALIDATED: ['PUBLISHED', 'DRAFT'],
  PUBLISHED: ['ACTIVE', 'RETIRED'],
  ACTIVE: ['RETIRED'],
  RETIRED: ['ARCHIVED'],
  ARCHIVED: [],
};
const SPEC_ACTION_TARGET: Record<SpecAction, string> = {
  validate: 'VALIDATED',
  publish: 'PUBLISHED',
  activate: 'ACTIVE',
  retire: 'RETIRED',
  archive: 'ARCHIVED',
};
export function checkSpecTransition(from: string, action: SpecAction): TransitionResult {
  return transition(SPEC_MACHINE, from, SPEC_ACTION_TARGET[action]);
}
export function isSpecFrozen(status: string): boolean {
  return status === 'PUBLISHED' || status === 'ACTIVE' || status === 'RETIRED' || status === 'ARCHIVED';
}
