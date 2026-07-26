/**
 * The M13 state machines — PURE transition checkers, the single choke point every service lifecycle mutation
 * goes through (mirrors m07/m08/m09/m12). Machines:
 *  - CASE RECORD: draft → opened → triage → assigned → under_review → investigation → (awaiting_* /
 *    hearing_scheduled / in_litigation / under_recovery) → decision_pending → resolved → closed, with
 *    reopened / cancelled / archived branches.
 *  - CASE-TYPE / SLA-POLICY spec: DRAFT → VALIDATED → PUBLISHED → ACTIVE → RETIRED → ARCHIVED (frozen at
 *    PUBLISHED, mirrors m09 doctype / m12 questionnaire).
 * Each checker returns the resulting status or a machine-readable reason; callers fail closed on `!ok`.
 * Conversion to an m14 legal matter is an EVENT (case.converted_to_matter), not a terminal case state — a case
 * being litigated stays a live case.
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

// --- case record lifecycle ---------------------------------------------------------------------
export const CASE_STATUSES = [
  'draft',
  'opened',
  'triage',
  'assigned',
  'under_review',
  'investigation',
  'awaiting_information',
  'awaiting_internal_action',
  'awaiting_external_action',
  'hearing_scheduled',
  'in_litigation',
  'under_recovery',
  'decision_pending',
  'resolved',
  'closed',
  'reopened',
  'cancelled',
  'archived',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

const WORK = [
  'under_review',
  'investigation',
  'awaiting_information',
  'awaiting_internal_action',
  'awaiting_external_action',
  'hearing_scheduled',
  'in_litigation',
  'under_recovery',
  'decision_pending',
  'resolved',
  'cancelled',
];

const CASE_MACHINE: Record<string, string[]> = {
  draft: ['opened', 'cancelled'],
  opened: ['triage', 'assigned', 'cancelled'],
  triage: ['assigned', 'under_review', 'investigation', 'in_litigation', 'under_recovery', 'cancelled'],
  assigned: WORK,
  under_review: [
    'investigation',
    'awaiting_information',
    'awaiting_internal_action',
    'awaiting_external_action',
    'hearing_scheduled',
    'in_litigation',
    'under_recovery',
    'decision_pending',
    'resolved',
    'cancelled',
  ],
  investigation: [
    'awaiting_information',
    'awaiting_internal_action',
    'awaiting_external_action',
    'decision_pending',
    'in_litigation',
    'under_recovery',
    'resolved',
    'cancelled',
  ],
  awaiting_information: ['under_review', 'investigation', 'decision_pending', 'resolved', 'cancelled'],
  awaiting_internal_action: ['under_review', 'investigation', 'decision_pending', 'resolved', 'cancelled'],
  awaiting_external_action: [
    'under_review',
    'hearing_scheduled',
    'in_litigation',
    'under_recovery',
    'decision_pending',
    'resolved',
    'cancelled',
  ],
  hearing_scheduled: [
    'in_litigation',
    'awaiting_external_action',
    'decision_pending',
    'resolved',
    'cancelled',
  ],
  in_litigation: [
    'hearing_scheduled',
    'awaiting_external_action',
    'under_recovery',
    'decision_pending',
    'resolved',
    'cancelled',
  ],
  under_recovery: ['awaiting_external_action', 'in_litigation', 'decision_pending', 'resolved', 'cancelled'],
  decision_pending: ['awaiting_internal_action', 'in_litigation', 'under_recovery', 'resolved', 'cancelled'],
  resolved: ['closed', 'reopened'],
  closed: ['reopened', 'archived'],
  reopened: [
    'triage',
    'assigned',
    'under_review',
    'investigation',
    'decision_pending',
    'resolved',
    'cancelled',
  ],
  cancelled: [],
  archived: [],
};

export function checkCaseTransition(from: string, to: string): TransitionResult {
  return transition(CASE_MACHINE, from, to);
}

/** Fully terminal — no further work (a closed case is reopenable, so it is NOT terminal here). */
export const CASE_TERMINAL: readonly string[] = ['cancelled', 'archived'];
export function isCaseTerminal(s: string): boolean {
  return CASE_TERMINAL.includes(s);
}
export function isCaseOpen(s: string): boolean {
  return s !== 'closed' && !isCaseTerminal(s);
}

// --- spec lifecycle (case type + sla policy) ---------------------------------------------------
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
