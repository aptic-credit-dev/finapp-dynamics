/**
 * M36 PURE domain — vocabulary, guards, the maker-checker/SoD + approval gates, the ENDPOINT-URL allow-list (SSRF
 * prevention), event-family/type FILTER matching, and the SECRET-SEAM re-export. No I/O. THE APPROVAL RULE: activating an
 * external webhook endpoint (that egresses tenant data) must be approved by a HUMAN who is not the requester. THE URL RULE:
 * an endpoint URL must be https to a PUBLIC host — never localhost/loopback/private/link-local (metadata) — fail closed.
 * THE SUBSCRIPTION RULE: a subscription may only target a REGISTERED domain-event family (no arbitrary family). THE SECRET
 * RULE: an endpoint's signing secret is an opaque `secretref:` pointer (the m30 seam) — never a value. m36 delivers only
 * through a fail-closed port and executes no arbitrary code.
 */
import { DOMAIN_EVENT_FAMILIES } from '@finapp/contracts';
import { SECRET_REFERENCE_PATTERN, isSecretReference } from '@finapp/m30-platform';

export { SECRET_REFERENCE_PATTERN, isSecretReference };

export class EventsError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string, message?: string) {
    super(message ?? reasonCode);
    this.name = 'EventsError';
    this.reasonCode = reasonCode;
  }
}

export const M36_LIMITS = {
  maxFindings: 100,
  maxPageSize: 200,
  defaultPageSize: 50,
  maxDeliveryAttempts: 8,
} as const;

export const SCOPES = ['platform', 'tenant'] as const;
export type Scope = (typeof SCOPES)[number];
export function isScope(s: string): s is Scope {
  return (SCOPES as readonly string[]).includes(s);
}
export function isPlatformScope(s: string): boolean {
  return s === 'platform';
}

export const ENDPOINT_STATES = ['draft', 'review_pending', 'active', 'suspended', 'rejected'] as const;
export type EndpointState = (typeof ENDPOINT_STATES)[number];
export function isEndpointState(s: string): s is EndpointState {
  return (ENDPOINT_STATES as readonly string[]).includes(s);
}
export function isEndpointFrozen(s: string): boolean {
  return s === 'rejected';
}

export const SUBSCRIPTION_STATUSES = ['active', 'paused'] as const;
export function isSubscriptionStatus(s: string): boolean {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(s);
}

export const DELIVERY_STATUSES = ['delivered', 'failed', 'blocked', 'dead_letter'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export function isDeliveryStatus(s: string): boolean {
  return (DELIVERY_STATUSES as readonly string[]).includes(s);
}

export const STREAM_STATUSES = ['active', 'paused'] as const;
export function isStreamStatus(s: string): boolean {
  return (STREAM_STATUSES as readonly string[]).includes(s);
}

export const REASON_CODES = {
  endpointRegistered: 'endpoint_registered',
  reviewRequested: 'review_requested',
  endpointApproved: 'endpoint_approved',
  endpointRejected: 'endpoint_rejected',
  endpointSuspended: 'endpoint_suspended',
  subscriptionAdded: 'subscription_added',
  deliveryAttempted: 'delivery_attempted',
  deliverySucceeded: 'delivery_succeeded',
  deliveryFailed: 'delivery_failed',
  deliveryBlocked: 'delivery_blocked',
  deliveryReplayed: 'delivery_replayed',
  streamCreated: 'stream_created',
  streamPaused: 'stream_paused',
  cursorAdvanced: 'cursor_advanced',
  validationNotPassed: 'validation_not_passed',
  notHumanApprover: 'approver_not_human',
  selfApproval: 'self_approval_forbidden',
  insecureUrl: 'endpoint_url_insecure',
  privateUrl: 'endpoint_url_private',
  malformedUrl: 'endpoint_url_malformed',
  invalidSecretReference: 'invalid_secret_reference',
  unknownEventFamily: 'unknown_event_family',
  deliveryRuntimeUnavailable: 'delivery_runtime_unavailable',
  endpointNotActive: 'endpoint_not_active',
  structuralInvalid: 'structural_invalid',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

// ---- maker-checker (controlled endpoint activation) ----

export function isHumanActor(actor: string | null | undefined): actor is string {
  if (actor === null || actor === undefined) return false;
  const a = actor.trim().toLowerCase();
  if (a === '') return false;
  return a !== 'system' && a !== 'ai' && a !== 'automation';
}

export interface GateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}

export function evaluateSodGate(requestedBy: string, approver: string | null): GateResult {
  if (!isHumanActor(approver)) return { allowed: false, reasonCode: REASON_CODES.notHumanApprover };
  if (approver === requestedBy) return { allowed: false, reasonCode: REASON_CODES.selfApproval };
  return { allowed: true, reasonCode: REASON_CODES.endpointApproved };
}

export interface ApprovalGateInput {
  readonly validationPassed: boolean;
  readonly requestedBy: string;
  readonly approver: string | null;
}
export function evaluateApprovalGate(input: ApprovalGateInput): GateResult {
  if (!input.validationPassed) return { allowed: false, reasonCode: REASON_CODES.validationNotPassed };
  return evaluateSodGate(input.requestedBy, input.approver);
}

// ---- endpoint URL allow-list (SSRF prevention; fail closed) ----

export interface ValidationFinding {
  readonly code: string;
  readonly ref?: string;
}

/** A host is private/loopback/link-local (incl. the cloud metadata address) — never an allowed webhook target. */
function isPrivateOrLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal'))
    return true;
  if (h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80'))
    return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m === null) return false; // a DNS name that is not obviously internal — resolution is the runtime's fail-closed concern
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10 || a === 0 || a === 169) return true; // loopback / private / this-host / link-local (169.254)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/** An endpoint URL must be a well-formed https URL to a PUBLIC host. Fail closed (any doubt -> rejected). */
export function validateEndpointUrl(url: string): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    findings.push({ code: REASON_CODES.malformedUrl, ref: 'url' });
    return findings;
  }
  if (parsed.protocol !== 'https:') findings.push({ code: REASON_CODES.insecureUrl, ref: 'url' });
  if (parsed.username !== '' || parsed.password !== '')
    findings.push({ code: REASON_CODES.insecureUrl, ref: 'url' });
  if (parsed.hostname === '' || isPrivateOrLoopbackHost(parsed.hostname))
    findings.push({ code: REASON_CODES.privateUrl, ref: 'url' });
  return findings;
}

// ---- subscription filter (only a REGISTERED domain-event family; type is exact or '*') ----

export function isRegisteredEventFamily(family: string): boolean {
  return DOMAIN_EVENT_FAMILIES.includes(family);
}

/** A delivery matches a subscription iff the family matches and the subscribed type is the wildcard '*' or the exact type. */
export function eventMatchesSubscription(
  sub: { eventFamily: string; eventType: string },
  event: { family: string; type: string },
): boolean {
  if (sub.eventFamily !== event.family) return false;
  return sub.eventType === '*' || sub.eventType === event.type;
}

// ---- endpoint validation (fail closed) ----

export interface ValidationOutcome {
  readonly passed: boolean;
  readonly findings: readonly ValidationFinding[];
}

/** An endpoint is valid if its URL is an https public target and (if present) its signing secret is an opaque reference. */
export function validateEndpoint(input: { url: string; signingSecretRef: string | null }): ValidationOutcome {
  const findings: ValidationFinding[] = [...validateEndpointUrl(input.url)];
  if (input.signingSecretRef !== null && !isSecretReference(input.signingSecretRef))
    findings.push({ code: REASON_CODES.invalidSecretReference, ref: 'signing_secret_ref' });
  return { passed: findings.length === 0, findings };
}

export interface Page {
  readonly limit: number;
  readonly offset: number;
}
export function clampPage(limit?: number, offset?: number): Page {
  const l =
    limit === undefined || limit <= 0 ? M36_LIMITS.defaultPageSize : Math.min(limit, M36_LIMITS.maxPageSize);
  const o = offset === undefined || offset < 0 ? 0 : offset;
  return { limit: l, offset: o };
}
