/**
 * The M09 state machines — PURE transition checkers, the single choke point every service lifecycle mutation
 * goes through (mirrors m07/m08). Machines:
 *  - DOCUMENT:  draft → active → {superseded | archived | withdrawn} → disposed.
 *  - VERSION:   pending → committed → active → superseded (a committed version is immutable).
 *  - TYPE / RETENTION spec: DRAFT → VALIDATED → PUBLISHED → ACTIVE → RETIRED → ARCHIVED (frozen at PUBLISHED).
 *  - DISPOSITION: eligible → pending_review → {approved → disposed | rejected | cancelled | blocked_by_hold}.
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

// --- document ----------------------------------------------------------------------------------
export const DOCUMENT_STATUSES = [
  'draft',
  'active',
  'superseded',
  'archived',
  'withdrawn',
  'disposed',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
const DOCUMENT_MACHINE: Record<string, string[]> = {
  draft: ['active', 'withdrawn'],
  active: ['superseded', 'archived', 'withdrawn'],
  superseded: ['archived', 'withdrawn'],
  archived: ['disposed', 'withdrawn'],
  withdrawn: ['disposed'],
  disposed: [],
};
export function checkDocumentTransition(from: string, to: string): TransitionResult {
  return transition(DOCUMENT_MACHINE, from, to);
}
export const DOCUMENT_TERMINAL: readonly string[] = ['disposed'];
export function isDocumentTerminal(s: string): boolean {
  return DOCUMENT_TERMINAL.includes(s);
}

// --- version -----------------------------------------------------------------------------------
export const VERSION_STATUSES = ['pending', 'committed', 'active', 'superseded'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];
const VERSION_MACHINE: Record<string, string[]> = {
  pending: ['committed'],
  committed: ['active'],
  active: ['superseded'],
  superseded: [],
};
export function checkVersionTransition(from: string, to: string): TransitionResult {
  return transition(VERSION_MACHINE, from, to);
}
/** A committed (or later) version's metadata is immutable evidence (ADR-045). */
export function isVersionCommitted(status: string): boolean {
  return status === 'committed' || status === 'active' || status === 'superseded';
}

// --- type / retention spec (shared immutable-spec machine) -------------------------------------
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

// --- disposition -------------------------------------------------------------------------------
export const DISPOSITION_STATUSES = [
  'eligible',
  'pending_review',
  'approved',
  'rejected',
  'disposed',
  'cancelled',
  'blocked_by_hold',
] as const;
export type DispositionStatus = (typeof DISPOSITION_STATUSES)[number];
const DISPOSITION_MACHINE: Record<string, string[]> = {
  eligible: ['pending_review', 'cancelled', 'blocked_by_hold'],
  pending_review: ['approved', 'rejected', 'cancelled', 'blocked_by_hold'],
  approved: ['disposed', 'cancelled', 'blocked_by_hold'],
  rejected: [],
  disposed: [],
  cancelled: [],
  blocked_by_hold: ['eligible', 'cancelled'],
};
export function checkDispositionTransition(from: string, to: string): TransitionResult {
  return transition(DISPOSITION_MACHINE, from, to);
}
export const DISPOSITION_TERMINAL: readonly string[] = ['disposed', 'rejected', 'cancelled'];
export function isDispositionTerminal(s: string): boolean {
  return DISPOSITION_TERMINAL.includes(s);
}
