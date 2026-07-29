/**
 * The M18 state machine — a PURE transition checker, the single choke point every publishable legal-knowledge
 * object (knowledge record, template, clause) goes through (mirrors m07/m08/m09/m12/m13/m14/m16/m17). One shared
 * PUBLISHABLE lifecycle: draft → under_review → (changes_requested / approved → published) → superseded /
 * withdrawn → archived, with reopened. Published content is immutable — a change is a NEW version (supersession),
 * never an in-place edit (ADR-074). The choke point returns the resulting status or a machine-readable reason;
 * callers fail closed on `!ok`. The configurable taxonomy uses a simple active/retired flag, not this lifecycle.
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

// --- publishable knowledge lifecycle -----------------------------------------------------------
export const PUBLISHABLE_STATUSES = [
  'draft',
  'under_review',
  'changes_requested',
  'approved',
  'published',
  'superseded',
  'withdrawn',
  'archived',
  'reopened',
] as const;
export type PublishableStatus = (typeof PUBLISHABLE_STATUSES)[number];

const PUBLISHABLE_MACHINE: Record<string, string[]> = {
  draft: ['under_review', 'withdrawn'],
  under_review: ['changes_requested', 'approved', 'draft', 'withdrawn'],
  changes_requested: ['draft', 'under_review', 'withdrawn'],
  approved: ['published', 'changes_requested', 'withdrawn'],
  published: ['superseded', 'withdrawn', 'archived'],
  superseded: ['archived'],
  withdrawn: ['reopened', 'archived'],
  reopened: ['under_review', 'draft', 'withdrawn'],
  archived: [],
};

export function checkPublishableTransition(from: string, to: string): TransitionResult {
  return transition(PUBLISHABLE_MACHINE, from, to);
}

/** Fully terminal — no further work (a withdrawn record is reopenable, so it is NOT terminal here). */
export const PUBLISHABLE_TERMINAL: readonly string[] = ['archived'];
export function isPublishableTerminal(s: string): boolean {
  return PUBLISHABLE_TERMINAL.includes(s);
}
/** Content is immutable once published (or beyond) — a change requires a new version (supersession). */
export function isPublishableFrozen(s: string): boolean {
  return s === 'published' || s === 'superseded' || s === 'withdrawn' || s === 'archived';
}
/** Whether the record is still in an active editorial/published state (not withdrawn/archived). */
export function isPublishableOpen(s: string): boolean {
  return s !== 'withdrawn' && !isPublishableTerminal(s);
}
export function isPublished(s: string): boolean {
  return s === 'published';
}
