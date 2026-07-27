/**
 * The M14 state machines — PURE transition checkers, the single choke point every service lifecycle mutation goes
 * through (mirrors m07/m08/m09/m12/m13). Machines:
 *  - LEGAL MATTER: draft → instructed → opened → legal_review → (pre_action / negotiation / mediation /
 *    arbitration / filed → active_litigation → hearing → judgment_* / appeal_* / settlement_* / enforcement) →
 *    resolved → closed, with reopened / withdrawn / archived branches.
 *  - MATTER-TYPE / SLA-POLICY spec: DRAFT → VALIDATED → PUBLISHED → ACTIVE → RETIRED → ARCHIVED (frozen at
 *    PUBLISHED, mirrors m09 doctype).
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

// --- legal matter lifecycle --------------------------------------------------------------------
export const MATTER_STATUSES = [
  'draft',
  'instructed',
  'opened',
  'legal_review',
  'awaiting_information',
  'pre_action',
  'negotiation',
  'mediation',
  'arbitration',
  'filed',
  'awaiting_service',
  'active_litigation',
  'hearing',
  'judgment_pending',
  'judgment_entered',
  'appeal_pending',
  'on_appeal',
  'settlement_pending',
  'settled',
  'enforcement',
  'resolved',
  'closed',
  'reopened',
  'withdrawn',
  'archived',
] as const;
export type MatterStatus = (typeof MATTER_STATUSES)[number];

const WORK = [
  'legal_review',
  'awaiting_information',
  'pre_action',
  'negotiation',
  'mediation',
  'arbitration',
  'filed',
  'settlement_pending',
  'resolved',
  'withdrawn',
];

const MATTER_MACHINE: Record<string, string[]> = {
  draft: ['instructed', 'opened', 'withdrawn'],
  instructed: ['opened', 'legal_review', 'withdrawn'],
  opened: ['legal_review', 'pre_action', 'negotiation', 'filed', 'withdrawn'],
  legal_review: WORK,
  awaiting_information: ['legal_review', 'pre_action', 'negotiation', 'filed', 'resolved', 'withdrawn'],
  pre_action: ['negotiation', 'mediation', 'filed', 'settlement_pending', 'resolved', 'withdrawn'],
  negotiation: ['mediation', 'arbitration', 'filed', 'settlement_pending', 'resolved', 'withdrawn'],
  mediation: ['negotiation', 'filed', 'settlement_pending', 'resolved', 'withdrawn'],
  arbitration: ['settlement_pending', 'judgment_pending', 'resolved', 'withdrawn'],
  filed: ['awaiting_service', 'active_litigation', 'settlement_pending', 'withdrawn'],
  awaiting_service: ['active_litigation', 'withdrawn'],
  active_litigation: [
    'hearing',
    'judgment_pending',
    'settlement_pending',
    'awaiting_information',
    'withdrawn',
  ],
  hearing: ['active_litigation', 'judgment_pending', 'settlement_pending', 'withdrawn'],
  judgment_pending: ['judgment_entered', 'settlement_pending', 'withdrawn'],
  judgment_entered: ['appeal_pending', 'enforcement', 'resolved', 'withdrawn'],
  appeal_pending: ['on_appeal', 'enforcement', 'resolved', 'withdrawn'],
  on_appeal: ['judgment_entered', 'enforcement', 'resolved', 'withdrawn'],
  settlement_pending: ['settled', 'active_litigation', 'negotiation', 'withdrawn'],
  settled: ['enforcement', 'resolved', 'closed'],
  enforcement: ['resolved', 'closed', 'withdrawn'],
  resolved: ['closed', 'reopened'],
  closed: ['reopened', 'archived'],
  reopened: ['legal_review', 'active_litigation', 'appeal_pending', 'enforcement', 'resolved', 'withdrawn'],
  withdrawn: ['reopened', 'archived'],
  archived: [],
};

export function checkMatterTransition(from: string, to: string): TransitionResult {
  return transition(MATTER_MACHINE, from, to);
}

/** Fully terminal — no further work (a closed/withdrawn matter is reopenable, so it is NOT terminal here). */
export const MATTER_TERMINAL: readonly string[] = ['archived'];
export function isMatterTerminal(s: string): boolean {
  return MATTER_TERMINAL.includes(s);
}
export function isMatterOpen(s: string): boolean {
  return s !== 'closed' && s !== 'withdrawn' && !isMatterTerminal(s);
}

// --- spec lifecycle (matter type + sla policy) -------------------------------------------------
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
