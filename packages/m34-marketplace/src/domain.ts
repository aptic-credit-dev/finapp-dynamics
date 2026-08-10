/**
 * M34 PURE domain — vocabulary, guards, the maker-checker/SoD + publish gates, the CONSENT gate (human-only), and the
 * SECRET-SEAM screening. No I/O. THE CONSENT RULE: consent to a connector's data access must be granted by a HUMAN
 * (never null/system/ai/automation) and is revocable. THE SECRET RULE: an install config carries NO raw secret VALUE — a
 * secret-keyed field must be an opaque `secretref:` pointer (the m30 seam); a raw secret fails closed. m34 consumes m33
 * connectors by OPAQUE reference and executes nothing — no arbitrary code.
 */
import { SECRET_REFERENCE_PATTERN, isSecretReference } from '@finapp/m30-platform';

export { SECRET_REFERENCE_PATTERN, isSecretReference };

export class MarketplaceError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string, message?: string) {
    super(message ?? reasonCode);
    this.name = 'MarketplaceError';
    this.reasonCode = reasonCode;
  }
}

export const M34_LIMITS = {
  maxConfigBytes: 131072,
  maxScopes: 64,
  maxFindings: 100,
  maxPageSize: 200,
  defaultPageSize: 50,
} as const;

export const SCOPES = ['platform', 'tenant'] as const;
export type Scope = (typeof SCOPES)[number];
export function isScope(s: string): s is Scope {
  return (SCOPES as readonly string[]).includes(s);
}
export function isPlatformScope(s: string): boolean {
  return s === 'platform';
}

export const VISIBILITIES = ['private', 'tenant', 'public'] as const;
export function isVisibility(s: string): boolean {
  return (VISIBILITIES as readonly string[]).includes(s);
}
export const CATEGORIES = ['finance', 'crm', 'messaging', 'storage', 'analytics', 'custom'] as const;
export function isCategory(s: string): boolean {
  return (CATEGORIES as readonly string[]).includes(s);
}
export const CONSENT_SCOPES = ['read', 'write', 'admin'] as const;
export function isConsentScope(s: string): boolean {
  return (CONSENT_SCOPES as readonly string[]).includes(s);
}

export const LISTING_STATES = [
  'draft',
  'validated',
  'review_pending',
  'published',
  'deprecated',
  'rejected',
] as const;
export type ListingState = (typeof LISTING_STATES)[number];
export function isListingState(s: string): s is ListingState {
  return (LISTING_STATES as readonly string[]).includes(s);
}
export function isListingFrozen(s: string): boolean {
  return s === 'rejected';
}

export const INSTALL_STATUSES = [
  'requested',
  'consent_pending',
  'active',
  'suspended',
  'uninstalled',
] as const;
export function isInstallStatus(s: string): boolean {
  return (INSTALL_STATUSES as readonly string[]).includes(s);
}

export const REASON_CODES = {
  listingDefined: 'listing_defined',
  listingValidated: 'listing_validated',
  capabilityAdded: 'capability_added',
  reviewRequested: 'review_requested',
  published: 'listing_published',
  deprecated: 'listing_deprecated',
  rejected: 'review_rejected',
  installRequested: 'install_requested',
  installActivated: 'install_activated',
  installSuspended: 'install_suspended',
  secretSet: 'install_secret_set',
  consentGranted: 'consent_granted',
  consentRevoked: 'consent_revoked',
  upgradeApplied: 'upgrade_applied',
  validationNotPassed: 'validation_not_passed',
  validationFailed: 'validation_failed',
  notHumanApprover: 'approver_not_human',
  selfApproval: 'self_approval_forbidden',
  notHumanConsent: 'consent_not_human',
  consentRequired: 'consent_required',
  secretValueForbidden: 'secret_value_forbidden',
  invalidSecretReference: 'invalid_secret_reference',
  connectorUnavailable: 'connector_unavailable',
  listingNotPublished: 'listing_not_published',
  structuralInvalid: 'structural_invalid',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

// ---- maker-checker + consent (controlled actions) ----

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
  return { allowed: true, reasonCode: REASON_CODES.published };
}

export interface PublishGateInput {
  readonly validationPassed: boolean;
  readonly requestedBy: string;
  readonly approver: string | null;
}
export function evaluatePublishGate(input: PublishGateInput): GateResult {
  if (!input.validationPassed) return { allowed: false, reasonCode: REASON_CODES.validationNotPassed };
  return evaluateSodGate(input.requestedBy, input.approver);
}

/** Consent to a connector's data access must be granted by a HUMAN — never null/system/ai/automation. AI never consents. */
export function evaluateConsentGate(grantedBy: string | null): GateResult {
  if (!isHumanActor(grantedBy)) return { allowed: false, reasonCode: REASON_CODES.notHumanConsent };
  return { allowed: true, reasonCode: REASON_CODES.consentGranted };
}

// ---- SECRET SEAM screening (no raw secret VALUE in an install config) ----

const SECRET_KEY_PATTERN =
  /(?:^|[._-])(?:password|passwd|secret|api[_-]?key|apikey|token|private[_-]?key|credential|client[_-]?secret|access[_-]?token)(?:$|[._-])/i;

export interface ValidationFinding {
  readonly code: string;
  readonly ref?: string;
}

function walk(value: unknown, key: string, findings: ValidationFinding[]): void {
  if (findings.length >= M34_LIMITS.maxFindings) return;
  if (typeof value === 'string') {
    if (SECRET_KEY_PATTERN.test(key) && !isSecretReference(value)) {
      findings.push({ code: REASON_CODES.secretValueForbidden, ref: key });
    } else if (value.startsWith('secretref:') && !SECRET_REFERENCE_PATTERN.test(value)) {
      findings.push({ code: REASON_CODES.invalidSecretReference, ref: key });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) walk(value[i], `${key}[${i}]`, findings);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      walk(v, key === '' ? k : `${key}.${k}`, findings);
  }
}

/** Screen an install config for raw secret VALUES — a secret must be an opaque `secretref:` pointer (m30 seam). */
export function screenInstallConfig(config: unknown): readonly ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  walk(config, '', findings);
  return findings;
}

// ---- listing validation (fail closed) ----

export interface ValidationOutcome {
  readonly passed: boolean;
  readonly findings: readonly ValidationFinding[];
}

/** A listing is valid if its key/connector_ref/category/visibility are well-formed. The connector_ref's AVAILABILITY is
 * checked against m33 through the fail-closed port at publish (not here). Fail closed. */
export function validateListing(input: {
  listingKey: string;
  connectorRef: string;
  category: string;
  visibility: string;
}): ValidationOutcome {
  const findings: ValidationFinding[] = [];
  if (input.listingKey.trim() === '')
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'listing_key' });
  if (input.connectorRef.trim() === '')
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'connector_ref' });
  if (!isCategory(input.category)) findings.push({ code: REASON_CODES.structuralInvalid, ref: 'category' });
  if (!isVisibility(input.visibility))
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'visibility' });
  return { passed: findings.length === 0, findings };
}

export interface Page {
  readonly limit: number;
  readonly offset: number;
}
export function clampPage(limit?: number, offset?: number): Page {
  const l =
    limit === undefined || limit <= 0 ? M34_LIMITS.defaultPageSize : Math.min(limit, M34_LIMITS.maxPageSize);
  const o = offset === undefined || offset < 0 ? 0 : offset;
  return { limit: l, offset: o };
}
