/**
 * M40 domain — the PURE, side-effect-free resilience rules (no DB, no clock). These are the load-bearing controls proven in the
 * smoke suite and enforced by the services + DB:
 *
 *  - THE OFFLINE FINALIZATION BLOCK (`evaluateOfflineFinalization`): a CONTROLLED offline request can be FINALIZED (applied)
 *    ONLY when (a) it has NOT expired, (b) it was re-validated ONLINE, and (c) the required m02 permission is held by the
 *    CURRENT online actor. An offline/mobile client may draft/queue but can never finalize a controlled action offline; a
 *    stale/expired/unvalidated request FAILS CLOSED. m40 never manufactures an approval nor auto-finalizes on reconnect.
 *  - MAKER-CHECKER / SoD (`evaluateSodGate` + `isHumanActor`): a restore/failover / DR test is decided by a HUMAN who is not the
 *    requester; `system`/`ai`/`automation`/null are never approvers.
 *  - LIFECYCLE guards (device / offline request / backup policy / restore request / DR plan) — only governed transitions.
 *  - RTO/RPO are integer seconds (`isValidObjective`); no float.
 */

export const M40_LIMITS = { maxPageSize: 200 } as const;

export const DEVICE_STATES = ['pending', 'registered', 'revoked'] as const;
export type DeviceState = (typeof DEVICE_STATES)[number];

export const SYNC_STATES = ['queued', 'validating', 'applied', 'rejected', 'expired'] as const;
export type SyncState = (typeof SYNC_STATES)[number];

export const BACKUP_STATES = ['draft', 'active', 'retired'] as const;
export type BackupState = (typeof BACKUP_STATES)[number];

export const RESTORE_STATES = [
  'draft',
  'review_pending',
  'approved',
  'executed',
  'rejected',
  'blocked',
] as const;
export type RestoreState = (typeof RESTORE_STATES)[number];

export const RESTORE_KINDS = ['restore', 'failover'] as const;
export type RestoreKind = (typeof RESTORE_KINDS)[number];

export const SIGNAL_KINDS = ['health', 'latency', 'dependency', 'backup_freshness', 'sync_health'] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const SIGNAL_STATES = ['ok', 'degraded', 'down', 'unknown'] as const;
export type SignalState = (typeof SIGNAL_STATES)[number];

export const SCOPES = ['platform', 'tenant'] as const;
export type Scope = (typeof SCOPES)[number];
export function isPlatformScope(scope: string): boolean {
  return scope === 'platform';
}

export const REASON_CODES = {
  // offline finalization
  offlineFinalizationBlocked: 'offline_finalization_blocked',
  offlineRevalidationRequired: 'offline_revalidation_required',
  offlineRbacRevalidationFailed: 'offline_rbac_revalidation_failed',
  offlineExpired: 'offline_request_expired',
  offlineApplied: 'offline_applied',
  // maker-checker
  notHumanApprover: 'approver_not_human',
  selfApproval: 'self_approval',
  approved: 'approved',
  // executor
  executorUnavailable: 'executor_unavailable',
  executed: 'executed',
  // lifecycle / structural
  invalidTransition: 'invalid_transition',
  structuralInvalid: 'structural_invalid',
  terminal: 'terminal_immutable',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

export interface GateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}

// ---- THE OFFLINE FINALIZATION BLOCK (load-bearing) ----

export interface OfflineFinalizationInput {
  /** Is the queued operation a CONTROLLED action (post/approve/release/consent/commercial/config/secret)? */
  readonly controlled: boolean;
  /** Was the request re-validated ONLINE (the owning module authorized it now)? */
  readonly validatedOnline: boolean;
  /** Does the CURRENT online actor hold the required m02 permission (a fresh re-validation, not a cached result)? */
  readonly requiredPermissionHeldOnline: boolean;
  /** Has the request expired (stale offline intent)? */
  readonly expired: boolean;
}

/**
 * Whether a queued offline request may be FINALIZED (applied). A CONTROLLED action requires: not expired AND re-validated
 * online AND the required permission held by the current online actor. A non-controlled (read/draft) op still may not finalize
 * if expired. Any missing condition FAILS CLOSED — no offline finalization of controlled actions, no stale authorization.
 */
export function evaluateOfflineFinalization(input: OfflineFinalizationInput): GateResult {
  if (input.expired) return { allowed: false, reasonCode: REASON_CODES.offlineExpired };
  if (input.controlled) {
    if (!input.validatedOnline)
      return { allowed: false, reasonCode: REASON_CODES.offlineFinalizationBlocked };
    if (!input.requiredPermissionHeldOnline)
      return { allowed: false, reasonCode: REASON_CODES.offlineRbacRevalidationFailed };
  }
  return { allowed: true, reasonCode: REASON_CODES.offlineApplied };
}

// ---- maker-checker (controlled restore/failover / DR test) ----

export function isHumanActor(actor: string | null | undefined): actor is string {
  if (actor === null || actor === undefined) return false;
  const a = actor.trim().toLowerCase();
  if (a === '') return false;
  return a !== 'system' && a !== 'ai' && a !== 'automation';
}

export function evaluateSodGate(requestedBy: string, approver: string | null): GateResult {
  if (!isHumanActor(approver)) return { allowed: false, reasonCode: REASON_CODES.notHumanApprover };
  if (approver === requestedBy) return { allowed: false, reasonCode: REASON_CODES.selfApproval };
  return { allowed: true, reasonCode: REASON_CODES.approved };
}

// ---- lifecycle guards ----

const RESTORE_TRANSITIONS: Record<RestoreState, readonly RestoreState[]> = {
  draft: ['review_pending', 'rejected'],
  review_pending: ['approved', 'rejected'],
  approved: ['executed', 'blocked', 'rejected'],
  blocked: ['executed', 'rejected'],
  executed: [],
  rejected: [],
};
export function isRestoreTransitionAllowed(from: RestoreState, to: RestoreState): boolean {
  return RESTORE_TRANSITIONS[from].includes(to);
}
export function isRestoreTerminal(state: RestoreState): boolean {
  return state === 'executed' || state === 'rejected';
}

// ---- validation ----

export function isThreeSegmentPermission(p: string): boolean {
  return typeof p === 'string' && p.split('.').length === 3 && !p.split('.').includes('');
}

/** RTO/RPO/retention are non-negative integer durations (no float, no negative). null (unspecified) is allowed. */
export function isValidObjective(value: number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  return Number.isInteger(value) && value >= 0;
}

export interface OfflineRequestDraft {
  readonly capabilityRef: string;
  readonly requiredPermission: string;
  readonly configSecretRef?: string | null;
}
export interface ValidationResult {
  readonly passed: boolean;
  readonly findings: readonly { code: string; ref: string }[];
}
/** An offline request is well-formed iff it names a capability + a 3-segment m02 permission and any secret is a secretref. */
export function validateOfflineRequest(draft: OfflineRequestDraft): ValidationResult {
  const findings: { code: string; ref: string }[] = [];
  if (!draft.capabilityRef) findings.push({ code: REASON_CODES.structuralInvalid, ref: 'capability_ref' });
  if (!isThreeSegmentPermission(draft.requiredPermission))
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'required_permission' });
  if (draft.configSecretRef != null && !isSecretReference(draft.configSecretRef))
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'config_secret_ref' });
  return { passed: findings.length === 0, findings };
}

export const SECRET_REFERENCE_PATTERN = /^secretref:[A-Za-z0-9_.:/-]{3,200}$/;
export function isSecretReference(value: string): boolean {
  return SECRET_REFERENCE_PATTERN.test(value);
}

export function clampPage(page?: number, size?: number): { limit: number; offset: number } {
  const s = Math.min(Math.max(1, Math.floor(size ?? 50)), M40_LIMITS.maxPageSize);
  const p = Math.max(1, Math.floor(page ?? 1));
  return { limit: s, offset: (p - 1) * s };
}
