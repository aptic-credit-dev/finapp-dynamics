/**
 * M35 PURE domain — vocabulary, guards, the maker-checker/SoD + publish gates, the CREDENTIAL actor gate (human-only), and
 * the SECRET-SEAM validation for API credentials. No I/O. THE FACADE RULE: an API product exposes only ALLOW-LISTED
 * operations, and every exposed operation must carry the m02 permission it requires (a 3-segment permission) — the
 * developer portal NEVER bypasses m02 RBAC or m01 tenancy. THE SECRET RULE: an API credential persists NO plaintext — it is
 * a one-way `sha256:` hash XOR an opaque `secretref:` pointer (the m30 seam). THE HUMAN RULE: credential issuance/rotation/
 * revocation, product publication and subscription approval are decided by a HUMAN (never null/system/ai/automation). m35
 * consumes m33/m34 by OPAQUE reference and executes nothing — no arbitrary code.
 */
import { SECRET_REFERENCE_PATTERN, isSecretReference } from '@finapp/m30-platform';

export { SECRET_REFERENCE_PATTERN, isSecretReference };

export class DevportalError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string, message?: string) {
    super(message ?? reasonCode);
    this.name = 'DevportalError';
    this.reasonCode = reasonCode;
  }
}

export const M35_LIMITS = {
  maxScopes: 128,
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

/** A product's exposure. `public` = exposed on the public API gateway; it requires the control-plane permission. */
export const VISIBILITIES = ['private', 'tenant', 'public'] as const;
export function isVisibility(s: string): boolean {
  return (VISIBILITIES as readonly string[]).includes(s);
}
export function isPublicVisibility(s: string): boolean {
  return s === 'public';
}

export const CATEGORIES = ['data', 'integration', 'workflow', 'finance', 'custom'] as const;
export function isCategory(s: string): boolean {
  return (CATEGORIES as readonly string[]).includes(s);
}

/** Where a product's operations originate. m35 references a connector/marketplace listing by OPAQUE id (reads no m33/m34 table). */
export const SOURCE_KINDS = ['internal', 'connector', 'marketplace'] as const;
export function isSourceKind(s: string): boolean {
  return (SOURCE_KINDS as readonly string[]).includes(s);
}

export const PRODUCT_STATES = [
  'draft',
  'validated',
  'review_pending',
  'published',
  'deprecated',
  'rejected',
] as const;
export type ProductState = (typeof PRODUCT_STATES)[number];
export function isProductState(s: string): s is ProductState {
  return (PRODUCT_STATES as readonly string[]).includes(s);
}
export function isProductFrozen(s: string): boolean {
  return s === 'rejected';
}

export const APP_STATUSES = ['active', 'suspended', 'revoked'] as const;
export function isAppStatus(s: string): boolean {
  return (APP_STATUSES as readonly string[]).includes(s);
}

export const CREDENTIAL_STATUSES = ['active', 'rotated', 'revoked'] as const;
export function isCredentialStatus(s: string): boolean {
  return (CREDENTIAL_STATUSES as readonly string[]).includes(s);
}

export const SUBSCRIPTION_STATUSES = ['requested', 'active', 'suspended', 'revoked'] as const;
export function isSubscriptionStatus(s: string): boolean {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(s);
}

export const REASON_CODES = {
  appRegistered: 'app_registered',
  appSuspended: 'app_suspended',
  productDefined: 'product_defined',
  productValidated: 'product_validated',
  scopeAdded: 'scope_added',
  reviewRequested: 'review_requested',
  published: 'product_published',
  deprecated: 'product_deprecated',
  rejected: 'review_rejected',
  credentialIssued: 'credential_issued',
  credentialRotated: 'credential_rotated',
  credentialRevoked: 'credential_revoked',
  subscriptionRequested: 'subscription_requested',
  subscriptionActivated: 'subscription_activated',
  subscriptionSuspended: 'subscription_suspended',
  validationNotPassed: 'validation_not_passed',
  validationFailed: 'validation_failed',
  notHumanApprover: 'approver_not_human',
  selfApproval: 'self_approval_forbidden',
  notHumanCredential: 'credential_actor_not_human',
  secretValueForbidden: 'secret_value_forbidden',
  invalidSecretReference: 'invalid_secret_reference',
  missingRequiredPermission: 'exposed_operation_missing_permission',
  sourceUnavailable: 'source_unavailable',
  quotaUnavailable: 'quota_unavailable',
  quotaDenied: 'quota_denied',
  publicExposureForbidden: 'public_exposure_forbidden',
  productNotPublished: 'product_not_published',
  structuralInvalid: 'structural_invalid',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

// ---- maker-checker + human governance (controlled actions) ----

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

/** A controlled decision needs a HUMAN approver who is NOT the requester (SoD). AI/system/automation are refused. */
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

/** Credential issuance/rotation/revocation must be performed by a HUMAN — never null/system/ai/automation. AI never issues. */
export function evaluateCredentialActorGate(actor: string | null): GateResult {
  if (!isHumanActor(actor)) return { allowed: false, reasonCode: REASON_CODES.notHumanCredential };
  return { allowed: true, reasonCode: REASON_CODES.credentialIssued };
}

// ---- SECRET SEAM for API credentials (NO plaintext; sha256 hash XOR opaque secretref pointer) ----

export const SECRET_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
export function isSecretHash(v: string): boolean {
  return SECRET_HASH_PATTERN.test(v);
}

export interface ValidationFinding {
  readonly code: string;
  readonly ref?: string;
}

export interface CredentialSecret {
  readonly secretHash: string | null;
  readonly secretRef: string | null;
}

/** A credential material is valid iff EXACTLY ONE of {a well-formed sha256: hash, an opaque secretref:} is present. Never a
 * plaintext value. Fail closed. */
export function validateCredentialSecret(input: CredentialSecret): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const hash = input.secretHash !== null && input.secretHash !== '' ? input.secretHash : null;
  const ref = input.secretRef !== null && input.secretRef !== '' ? input.secretRef : null;
  if ((hash !== null) === (ref !== null)) {
    findings.push({ code: REASON_CODES.secretValueForbidden, ref: 'secret' });
    return findings;
  }
  if (hash !== null && !isSecretHash(hash))
    findings.push({ code: REASON_CODES.secretValueForbidden, ref: 'secret_hash' });
  if (ref !== null && !isSecretReference(ref))
    findings.push({ code: REASON_CODES.invalidSecretReference, ref: 'secret_ref' });
  return findings;
}

// ---- the FACADE rule: every exposed operation carries the m02 permission it requires ----

export function isThreeSegmentPermission(p: string): boolean {
  const parts = p.split('.');
  return parts.length === 3 && parts.every((s) => s.trim() !== '');
}

export interface ExposedOperation {
  readonly operationRef: string;
  readonly requiredPermission: string;
}

/** Screen a product's exposed operations: each must name an operation AND carry a 3-segment m02 permission (the governed
 * facade NEVER exposes an operation without the RBAC permission that guards it). Fail closed. */
export function screenExposedOperations(ops: readonly ExposedOperation[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const op of ops) {
    if (findings.length >= M35_LIMITS.maxFindings) break;
    if (op.operationRef.trim() === '')
      findings.push({ code: REASON_CODES.structuralInvalid, ref: 'operation_ref' });
    if (!isThreeSegmentPermission(op.requiredPermission))
      findings.push({ code: REASON_CODES.missingRequiredPermission, ref: op.operationRef });
  }
  return findings;
}

// ---- product validation (fail closed) ----

export interface ValidationOutcome {
  readonly passed: boolean;
  readonly findings: readonly ValidationFinding[];
}

/** A product is valid if its key/category/visibility/source are well-formed AND every exposed operation carries a required
 * permission (the facade rule). The source's AVAILABILITY is checked against m33/m34 through the fail-closed port at publish
 * (not here). Fail closed. */
export function validateProduct(input: {
  productKey: string;
  category: string;
  visibility: string;
  sourceKind: string;
  operations: readonly ExposedOperation[];
}): ValidationOutcome {
  const findings: ValidationFinding[] = [];
  if (input.productKey.trim() === '')
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'product_key' });
  if (!isCategory(input.category)) findings.push({ code: REASON_CODES.structuralInvalid, ref: 'category' });
  if (!isVisibility(input.visibility))
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'visibility' });
  if (!isSourceKind(input.sourceKind))
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'source_kind' });
  if (input.operations.length === 0)
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'operations' });
  findings.push(...screenExposedOperations(input.operations));
  return { passed: findings.length === 0, findings };
}

export interface Page {
  readonly limit: number;
  readonly offset: number;
}
export function clampPage(limit?: number, offset?: number): Page {
  const l =
    limit === undefined || limit <= 0 ? M35_LIMITS.defaultPageSize : Math.min(limit, M35_LIMITS.maxPageSize);
  const o = offset === undefined || offset < 0 ? 0 : offset;
  return { limit: l, offset: o };
}
