/**
 * The M12 state machines — PURE transition checkers, the single choke point every service lifecycle mutation
 * goes through (mirrors m07/m08/m09). Machines:
 *  - FEEDBACK RECORD: pending_contact → contact_attempted → feedback_captured → under_review → assigned →
 *    investigation_required → awaiting_internal_response → awaiting_customer_confirmation → resolved → closed,
 *    with reopened / converted_to_case / cancelled / unreachable / expired branches.
 *  - QUESTIONNAIRE / SLA-POLICY spec: DRAFT → VALIDATED → PUBLISHED → ACTIVE → RETIRED → ARCHIVED (frozen at
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

// --- feedback record lifecycle -----------------------------------------------------------------
export const FEEDBACK_STATUSES = [
  'pending_contact',
  'contact_attempted',
  'feedback_captured',
  'under_review',
  'assigned',
  'investigation_required',
  'awaiting_internal_response',
  'awaiting_customer_confirmation',
  'resolved',
  'closed',
  'reopened',
  'converted_to_case',
  'cancelled',
  'unreachable',
  'expired',
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

const FEEDBACK_MACHINE: Record<string, string[]> = {
  pending_contact: ['contact_attempted', 'feedback_captured', 'unreachable', 'cancelled', 'expired'],
  contact_attempted: ['contact_attempted', 'feedback_captured', 'unreachable', 'cancelled', 'expired'],
  feedback_captured: ['under_review', 'assigned', 'converted_to_case', 'cancelled'],
  under_review: ['assigned', 'investigation_required', 'resolved', 'converted_to_case', 'cancelled'],
  assigned: [
    'investigation_required',
    'awaiting_internal_response',
    'resolved',
    'converted_to_case',
    'cancelled',
  ],
  investigation_required: ['awaiting_internal_response', 'resolved', 'converted_to_case'],
  awaiting_internal_response: ['awaiting_customer_confirmation', 'resolved', 'converted_to_case'],
  awaiting_customer_confirmation: ['resolved', 'reopened', 'converted_to_case'],
  resolved: ['awaiting_customer_confirmation', 'closed', 'reopened'],
  closed: ['reopened'],
  reopened: [
    'under_review',
    'assigned',
    'investigation_required',
    'resolved',
    'converted_to_case',
    'cancelled',
  ],
  converted_to_case: [],
  cancelled: [],
  unreachable: ['pending_contact', 'cancelled'],
  expired: [],
};

export function checkFeedbackTransition(from: string, to: string): TransitionResult {
  return transition(FEEDBACK_MACHINE, from, to);
}

export const FEEDBACK_TERMINAL: readonly string[] = ['closed', 'converted_to_case', 'cancelled', 'expired'];
export function isFeedbackTerminal(s: string): boolean {
  return FEEDBACK_TERMINAL.includes(s);
}
export function isFeedbackOpen(s: string): boolean {
  return !isFeedbackTerminal(s);
}

// --- spec lifecycle (questionnaire + sla policy) -----------------------------------------------
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
