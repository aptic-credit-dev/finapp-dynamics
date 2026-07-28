/**
 * The M16 state machines — PURE transition checkers, the single choke point every service lifecycle mutation goes
 * through (mirrors m07/m08/m09/m12/m13/m14). Machines:
 *  - PROCEEDING: draft → referred → under_review → approved_to_file → awaiting_filing → filed → (awaiting_service /
 *    served / pleadings_open / case_management / directions / pre_trial / hearing_scheduled → hearing →
 *    submissions → decision_pending → ruling_delivered / judgment_delivered → appeal_* / compliance) → concluded →
 *    closed, with reopened / stayed / settled / withdrawn / dismissed / archived branches.
 *  - PROCEEDING-TYPE / SLA-POLICY spec: DRAFT → VALIDATED → PUBLISHED → ACTIVE → RETIRED → ARCHIVED (frozen at
 *    PUBLISHED, mirrors m09 doctype / m14).
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

// --- proceeding lifecycle ----------------------------------------------------------------------
export const PROCEEDING_STATUSES = [
  'draft',
  'referred',
  'under_review',
  'approved_to_file',
  'awaiting_filing',
  'filed',
  'awaiting_service',
  'served',
  'awaiting_response',
  'pleadings_open',
  'case_management',
  'directions',
  'pre_trial',
  'hearing_scheduled',
  'hearing',
  'submissions',
  'decision_pending',
  'ruling_delivered',
  'judgment_delivered',
  'appeal_pending',
  'on_appeal',
  'compliance',
  'stayed',
  'settled',
  'withdrawn',
  'dismissed',
  'concluded',
  'closed',
  'reopened',
  'archived',
] as const;
export type ProceedingStatus = (typeof PROCEEDING_STATUSES)[number];

const PROCEEDING_MACHINE: Record<string, string[]> = {
  draft: ['referred', 'under_review', 'withdrawn'],
  referred: ['under_review', 'approved_to_file', 'withdrawn'],
  under_review: ['approved_to_file', 'awaiting_filing', 'stayed', 'withdrawn', 'dismissed'],
  approved_to_file: ['awaiting_filing', 'filed', 'withdrawn'],
  awaiting_filing: ['filed', 'withdrawn'],
  filed: ['awaiting_service', 'served', 'pleadings_open', 'case_management', 'withdrawn'],
  awaiting_service: ['served', 'withdrawn'],
  served: ['awaiting_response', 'pleadings_open', 'case_management', 'withdrawn'],
  awaiting_response: ['pleadings_open', 'case_management', 'withdrawn'],
  pleadings_open: ['case_management', 'directions', 'pre_trial', 'hearing_scheduled', 'settled', 'withdrawn'],
  case_management: ['directions', 'pre_trial', 'hearing_scheduled', 'settled', 'stayed', 'withdrawn'],
  directions: ['pre_trial', 'hearing_scheduled', 'case_management', 'settled', 'withdrawn'],
  pre_trial: ['hearing_scheduled', 'hearing', 'settled', 'withdrawn'],
  hearing_scheduled: ['hearing', 'submissions', 'settled', 'stayed', 'withdrawn'],
  hearing: ['submissions', 'decision_pending', 'hearing_scheduled', 'settled', 'withdrawn'],
  submissions: ['decision_pending', 'hearing_scheduled', 'withdrawn'],
  decision_pending: ['ruling_delivered', 'judgment_delivered', 'settled', 'withdrawn'],
  ruling_delivered: [
    'judgment_delivered',
    'hearing_scheduled',
    'compliance',
    'appeal_pending',
    'concluded',
    'withdrawn',
  ],
  judgment_delivered: ['appeal_pending', 'compliance', 'concluded', 'withdrawn'],
  appeal_pending: ['on_appeal', 'compliance', 'concluded', 'withdrawn'],
  on_appeal: ['judgment_delivered', 'compliance', 'concluded', 'withdrawn'],
  compliance: ['concluded', 'closed', 'appeal_pending', 'withdrawn'],
  stayed: ['case_management', 'hearing_scheduled', 'withdrawn', 'dismissed'],
  settled: ['compliance', 'concluded', 'closed'],
  withdrawn: ['concluded', 'closed', 'archived'],
  dismissed: ['appeal_pending', 'concluded', 'closed'],
  concluded: ['closed', 'reopened'],
  closed: ['reopened', 'archived'],
  reopened: [
    'case_management',
    'hearing_scheduled',
    'appeal_pending',
    'compliance',
    'concluded',
    'withdrawn',
  ],
  archived: [],
};

export function checkProceedingTransition(from: string, to: string): TransitionResult {
  return transition(PROCEEDING_MACHINE, from, to);
}

/** Fully terminal — no further work (a closed/withdrawn/dismissed proceeding is reopenable, so NOT terminal here). */
export const PROCEEDING_TERMINAL: readonly string[] = ['archived'];
export function isProceedingTerminal(s: string): boolean {
  return PROCEEDING_TERMINAL.includes(s);
}
export function isProceedingOpen(s: string): boolean {
  return s !== 'closed' && s !== 'withdrawn' && s !== 'dismissed' && !isProceedingTerminal(s);
}

// --- spec lifecycle (proceeding type + sla policy) ---------------------------------------------
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
