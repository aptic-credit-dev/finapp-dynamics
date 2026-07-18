/**
 * Session and credential state machines — pure. Modelled exactly like m02-identity's lifecycles (action →
 * from → to, reason required on adverse outcomes), because it is a proven shape in this repo.
 */

export const SESSION_STATUSES = ['active', 'revoked', 'expired'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export function isSessionStatus(value: string): value is SessionStatus {
  return (SESSION_STATUSES as readonly string[]).includes(value);
}

export type SessionAction = 'refresh' | 'revoke' | 'expire';

export interface SessionTransition {
  readonly action: SessionAction;
  readonly from: readonly SessionStatus[];
  readonly to: SessionStatus;
  readonly reasonRequired: boolean;
}

export const SESSION_TRANSITIONS: readonly SessionTransition[] = [
  // Refresh keeps the session active (rotates its secrets); only an active session may refresh.
  { action: 'refresh', from: ['active'], to: 'active', reasonRequired: false },
  { action: 'revoke', from: ['active'], to: 'revoked', reasonRequired: true },
  { action: 'expire', from: ['active'], to: 'expired', reasonRequired: false },
];

/** `revoked` and `expired` are terminal — a session is never revived; the user logs in again. */
export const SESSION_TERMINAL: readonly SessionStatus[] = ['revoked', 'expired'];

export interface SessionTransitionCheck {
  readonly allowed: boolean;
  readonly to?: SessionStatus;
  readonly reason?: string;
}

export function checkSessionTransition(
  from: SessionStatus,
  action: SessionAction,
  opts: { reason?: string | undefined } = {},
): SessionTransitionCheck {
  const transition = SESSION_TRANSITIONS.find((t) => t.action === action);
  if (transition === undefined) return { allowed: false, reason: `Unknown action "${action}".` };
  if (SESSION_TERMINAL.includes(from)) {
    return { allowed: false, reason: `Session is ${from}, which is terminal.` };
  }
  if (!transition.from.includes(from)) {
    return { allowed: false, reason: `Cannot ${action} a ${from} session.` };
  }
  if (transition.reasonRequired && (opts.reason === undefined || opts.reason.trim() === '')) {
    return { allowed: false, reason: `Action "${action}" requires a reason.` };
  }
  return { allowed: true, to: transition.to };
}

/** A session admits a request only while active AND within both expiry bounds. */
export function sessionIsUsable(
  status: SessionStatus,
  nowMs: number,
  idleExpiresMs: number,
  absoluteExpiresMs: number,
): boolean {
  return status === 'active' && nowMs < idleExpiresMs && nowMs < absoluteExpiresMs;
}

// --- credential status ----------------------------------------------------------------------------
export const CREDENTIAL_STATUSES = ['active', 'disabled'] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];
export function isCredentialStatus(value: string): value is CredentialStatus {
  return (CREDENTIAL_STATUSES as readonly string[]).includes(value);
}
/** Only an active credential may be verified against. */
export function credentialIsUsable(status: CredentialStatus): boolean {
  return status === 'active';
}
