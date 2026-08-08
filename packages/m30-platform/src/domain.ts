/**
 * The M30 Platform-Foundation domain — PURE vocabulary, deterministic feature/config evaluation and the governance gates
 * (feature flags are NEVER an authorization substitute; a platform-ABSOLUTE control can never be weakened by a tenant
 * override; a secret is only ever an OPAQUE reference, never a value). No I/O. M30 is the canonical owner of governed
 * platform metadata, configuration, feature flags and the secret-reference seam; it stores ZERO secret values. Scope is
 * `platform` (control-plane) or `tenant`. There is no float here.
 */
export class PlatformError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PlatformError';
    this.code = code;
  }
}

export const M30_LIMITS = {
  maxPageSize: 200,
  defaultPageSize: 50,
  maxKeyLength: 200,
  maxReasonLength: 2000,
} as const;

// --- scope (platform control-plane vs tenant) -------------------------------------------------------------------
export const SCOPES = ['platform', 'tenant'] as const;
export type Scope = (typeof SCOPES)[number];
export function isScope(s: string): s is Scope {
  return (SCOPES as readonly string[]).includes(s);
}
export function isPlatformScope(s: string): boolean {
  return s === 'platform';
}

// --- metadata categories (controlled vocabulary — NOT an ungoverned key/value dump, NOT a tenant/identity mirror) --
export const METADATA_CATEGORIES = [
  'platform_info',
  'capability',
  'branding',
  'locale',
  'operational',
  'custom',
] as const;
export type MetadataCategory = (typeof METADATA_CATEGORIES)[number];
export function isMetadataCategory(s: string): s is MetadataCategory {
  return (METADATA_CATEGORIES as readonly string[]).includes(s);
}

// --- config value types -----------------------------------------------------------------------------------------
export const VALUE_TYPES = ['text', 'number', 'boolean', 'json', 'secret_ref'] as const;
export type ValueType = (typeof VALUE_TYPES)[number];
export function isValueType(s: string): s is ValueType {
  return (VALUE_TYPES as readonly string[]).includes(s);
}

// --- lifecycle statuses -----------------------------------------------------------------------------------------
export const SPEC_STATUSES = ['draft', 'active', 'superseded', 'retired'] as const;
export type SpecStatus = (typeof SPEC_STATUSES)[number];
export function isSpecFrozen(s: string): boolean {
  return s === 'active' || s === 'superseded' || s === 'retired';
}
export const SECRET_REF_STATUSES = ['active', 'rotated', 'revoked'] as const;
export type SecretRefStatus = (typeof SECRET_REF_STATUSES)[number];

// --- secret reference (an OPAQUE pointer — never a secret value; m24/repository convention) ----------------------
export const SECRET_REFERENCE_PATTERN = /^secretref:[A-Za-z0-9_.:/-]{3,200}$/;
export function isSecretReference(s: string): boolean {
  return SECRET_REFERENCE_PATTERN.test(s);
}

// --- reason codes -----------------------------------------------------------------------------------------------
export const REASON_CODES = {
  metadataUpdated: 'metadata_updated',
  configDefined: 'config_defined',
  configPublished: 'config_published',
  configValueSet: 'config_value_set',
  featureDefined: 'feature_defined',
  featureAssigned: 'feature_assigned',
  secretReferenceRegistered: 'secret_reference_registered',
  secretReferenceRotated: 'secret_reference_rotated',
  secretReferenceRevoked: 'secret_reference_revoked',
  // refusals (fail closed)
  absoluteControlNotOverridable: 'absolute_control_not_overridable',
  secretValueForbidden: 'secret_value_forbidden',
  invalidSecretReference: 'invalid_secret_reference',
  notAuthorizationSubstitute: 'feature_not_authorization_substitute',
  platformScopeForbidden: 'platform_scope_forbidden',
  secretUnavailable: 'secret_unavailable',
  staleVersion: 'stale_version',
  duplicateSuppressed: 'duplicate_suppressed',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

/**
 * THE FEATURE EVALUATION rule (deterministic). A flag's effective value is its tenant assignment, UNLESS it is a
 * platform-ABSOLUTE control — an absolute flag always evaluates to its platform default (a tenant override can never
 * weaken it). A feature flag is NEVER an authorization substitute: this returns only enabled/disabled; the caller must
 * still hold the RBAC permission (enforced by the service's authz.require) — a flag never grants what RBAC denies.
 */
export interface FeatureEvaluationInput {
  readonly defaultEnabled: boolean;
  readonly isAbsolute: boolean;
  readonly assignmentEnabled: boolean | null;
}
export function evaluateFeature(input: FeatureEvaluationInput): boolean {
  if (input.isAbsolute) return input.defaultEnabled; // absolute: tenant override ignored (cannot be weakened)
  return input.assignmentEnabled ?? input.defaultEnabled;
}

/**
 * THE ABSOLUTE-CONTROL gate for a feature assignment. A tenant may NOT create an assignment on a platform-absolute flag
 * (it can never weaken/override it). Fails closed.
 */
export interface AbsoluteGateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}
export function evaluateAbsoluteAssignmentGate(isAbsolute: boolean): AbsoluteGateResult {
  if (isAbsolute) return { allowed: false, reasonCode: REASON_CODES.absoluteControlNotOverridable };
  return { allowed: true, reasonCode: REASON_CODES.featureAssigned };
}

/**
 * THE SECRETS-SEAM gate for a config value. A secret-bearing config value must carry an OPAQUE secret reference (valid
 * secretref: shape) and NO plain value; a non-secret value must carry a plain value and NO reference. A raw secret value
 * is never accepted. Fails closed.
 */
export interface ConfigValueGateInput {
  readonly secretBearing: boolean;
  readonly hasPlainValue: boolean;
  readonly secretRef: string | null;
}
export interface ConfigValueGateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}
export function evaluateConfigValueGate(input: ConfigValueGateInput): ConfigValueGateResult {
  if (input.secretBearing) {
    if (input.hasPlainValue) return { allowed: false, reasonCode: REASON_CODES.secretValueForbidden };
    if (input.secretRef === null || !isSecretReference(input.secretRef))
      return { allowed: false, reasonCode: REASON_CODES.invalidSecretReference };
    return { allowed: true, reasonCode: REASON_CODES.configValueSet };
  }
  // non-secret: a plain value only, never a secret reference.
  if (input.secretRef !== null) return { allowed: false, reasonCode: REASON_CODES.secretValueForbidden };
  return { allowed: true, reasonCode: REASON_CODES.configValueSet };
}

// --- bounded pagination -----------------------------------------------------------------------------------------
export interface Page {
  readonly limit: number;
  readonly offset: number;
}
export function clampPage(limit: number | undefined, offset: number | undefined): Page {
  const l = limit === undefined || !Number.isFinite(limit) ? M30_LIMITS.defaultPageSize : Math.floor(limit);
  const o = offset === undefined || !Number.isFinite(offset) ? 0 : Math.floor(offset);
  return { limit: Math.max(1, Math.min(M30_LIMITS.maxPageSize, l)), offset: Math.max(0, o) };
}
