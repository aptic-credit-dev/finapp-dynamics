/**
 * The M23 finance-integration state machines — PURE transition checkers, the single choke points for the integration
 * destination (versioned config) and the integration execution. Callers fail closed on `!ok`. There is NO direct status
 * mutation elsewhere: every change goes through a service that consults one of these machines, records append-only
 * history, and CAS-guards the write. Terminal states (`acknowledged` / `exhausted` / `cancelled`) have no outgoing
 * edges. Because M23 is FRAMEWORK ONLY, `dispatched` records intent only — the machine never implies an external call.
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

// --- integration destination (versioned; one active per system_code+scope) ----------------------------
const DESTINATION_MACHINE: Record<string, string[]> = {
  draft: ['enabled', 'retired'],
  enabled: ['disabled', 'retired'],
  disabled: ['enabled', 'retired'],
  retired: [],
};
export function checkDestinationTransition(from: string, to: string): TransitionResult {
  return transition(DESTINATION_MACHINE, from, to);
}
export function isDestinationDispatchable(s: string): boolean {
  return s === 'enabled';
}

// --- integration execution (Framework-Only lifecycle) -------------------------------------------------
const EXECUTION_MACHINE: Record<string, string[]> = {
  prepared: ['ready', 'cancelled'],
  ready: ['dispatched', 'cancelled'],
  dispatched: ['acknowledged', 'failed'], // Framework Only: no external call is made; result is recorded evidence
  failed: ['retryable', 'exhausted', 'cancelled'],
  retryable: ['ready', 'exhausted', 'cancelled'], // a retry goes back to 'ready' (bounded by max attempts)
  acknowledged: [], // terminal success
  exhausted: [], // terminal (retries exhausted)
  cancelled: [], // terminal
};
export function checkExecutionTransition(from: string, to: string): TransitionResult {
  return transition(EXECUTION_MACHINE, from, to);
}
export function isExecutionTerminal(s: string): boolean {
  return s === 'acknowledged' || s === 'exhausted' || s === 'cancelled';
}
export function isExecutionActionable(s: string): boolean {
  return !isExecutionTerminal(s);
}

// --- versioned spec (destination version / config; immutable-after-publish) ---------------------------
const SPEC_MACHINE: Record<string, string[]> = {
  draft: ['active', 'retired'],
  active: ['superseded', 'retired'],
  superseded: ['retired'],
  retired: [],
};
export function checkSpecTransition(from: string, to: string): TransitionResult {
  return transition(SPEC_MACHINE, from, to);
}
export function isSpecFrozen(s: string): boolean {
  return s === 'active' || s === 'superseded' || s === 'retired';
}
