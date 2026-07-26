/**
 * The M08 state machines — PURE transition checkers, the single choke point every service lifecycle mutation
 * goes through (mirrors m07's `checkRuleSetTransition`). Three machines:
 *
 *  - TEMPLATE VERSION: DRAFT → VALIDATED → PUBLISHED → ACTIVE → RETIRED → ARCHIVED (frozen at PUBLISHED).
 *  - NOTIFICATION REQUEST: requested → queued → processing → {delivered | failed → retry_scheduled → …} with
 *    terminal states delivered/exhausted/cancelled/expired/suppressed.
 *  - ESCALATION INSTANCE: pending → active → {acknowledged → resolved | resolved | cancelled | exhausted | expired}.
 *
 * Each checker returns the resulting status or a machine-readable reason it is invalid; callers fail closed on
 * `!ok`. No I/O, no clock.
 */

export interface TransitionResult {
  readonly ok: boolean;
  readonly to?: string;
  readonly reason?: string;
}

function transition(machine: Record<string, string[]>, from: string, action: string): TransitionResult {
  const forState = machine[from];
  if (forState === undefined) return { ok: false, reason: `unknown state "${from}"` };
  if (!forState.includes(action)) return { ok: false, reason: `cannot "${action}" from "${from}"` };
  return { ok: true, to: action };
}

// --- template version lifecycle -----------------------------------------------------------------
export const TEMPLATE_STATUSES = [
  'DRAFT',
  'VALIDATED',
  'PUBLISHED',
  'ACTIVE',
  'RETIRED',
  'ARCHIVED',
] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];
export const TEMPLATE_ACTIONS = ['validate', 'publish', 'activate', 'retire', 'archive'] as const;
export type TemplateAction = (typeof TEMPLATE_ACTIONS)[number];

/** Action name → resulting status (a template version transition names its target status directly). */
const TEMPLATE_MACHINE: Record<string, string[]> = {
  DRAFT: ['VALIDATED'],
  VALIDATED: ['PUBLISHED', 'DRAFT'],
  PUBLISHED: ['ACTIVE', 'RETIRED'],
  ACTIVE: ['RETIRED'],
  RETIRED: ['ARCHIVED'],
  ARCHIVED: [],
};
const TEMPLATE_ACTION_TARGET: Record<TemplateAction, string> = {
  validate: 'VALIDATED',
  publish: 'PUBLISHED',
  activate: 'ACTIVE',
  retire: 'RETIRED',
  archive: 'ARCHIVED',
};

export function checkTemplateTransition(from: string, action: TemplateAction): TransitionResult {
  return transition(TEMPLATE_MACHINE, from, TEMPLATE_ACTION_TARGET[action]);
}

/** A template version's content is frozen once it reaches PUBLISHED or later (ADR-039). */
export function isTemplateContentFrozen(status: string): boolean {
  return status === 'PUBLISHED' || status === 'ACTIVE' || status === 'RETIRED' || status === 'ARCHIVED';
}

// --- notification request lifecycle -------------------------------------------------------------
export const REQUEST_STATUSES = [
  'requested',
  'queued',
  'processing',
  'delivered',
  'failed',
  'retry_scheduled',
  'exhausted',
  'cancelled',
  'expired',
  'suppressed',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const REQUEST_MACHINE: Record<string, string[]> = {
  requested: ['queued', 'cancelled', 'suppressed', 'expired'],
  queued: ['processing', 'cancelled', 'expired'],
  processing: ['delivered', 'failed', 'cancelled'],
  failed: ['retry_scheduled', 'exhausted'],
  retry_scheduled: ['processing', 'cancelled', 'expired'],
  delivered: [],
  exhausted: [],
  cancelled: [],
  expired: [],
  suppressed: [],
};

export function checkRequestTransition(from: string, to: string): TransitionResult {
  return transition(REQUEST_MACHINE, from, to);
}

export const REQUEST_TERMINAL: readonly string[] = [
  'delivered',
  'exhausted',
  'cancelled',
  'expired',
  'suppressed',
];
export function isRequestTerminal(status: string): boolean {
  return REQUEST_TERMINAL.includes(status);
}

// --- escalation instance lifecycle --------------------------------------------------------------
export const ESCALATION_STATUSES = [
  'pending',
  'active',
  'acknowledged',
  'resolved',
  'cancelled',
  'exhausted',
  'expired',
] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

const ESCALATION_MACHINE: Record<string, string[]> = {
  pending: ['active', 'cancelled'],
  active: ['active', 'acknowledged', 'resolved', 'cancelled', 'exhausted', 'expired'],
  acknowledged: ['resolved', 'cancelled', 'expired'],
  resolved: [],
  cancelled: [],
  exhausted: [],
  expired: [],
};

export function checkEscalationTransition(from: string, to: string): TransitionResult {
  return transition(ESCALATION_MACHINE, from, to);
}

export const ESCALATION_TERMINAL: readonly string[] = ['resolved', 'cancelled', 'exhausted', 'expired'];
export function isEscalationTerminal(status: string): boolean {
  return ESCALATION_TERMINAL.includes(status);
}
