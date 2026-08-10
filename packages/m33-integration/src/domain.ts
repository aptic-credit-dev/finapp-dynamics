/**
 * M33 PURE domain — vocabulary, guards, the maker-checker/SoD + publish gates, and the SECRET-SEAM screening. No I/O.
 * THE SECRET RULE: a connection config must carry NO raw secret VALUE — a secret-keyed field must be an opaque `secretref:`
 * pointer (the m30 seam, reused here); a raw secret fails closed. THE RUNTIME RULE: connectors are FRAMEWORK-ONLY — the
 * runtime never performs a production call; an unavailable runtime fails closed. NO arbitrary code — capabilities are
 * declarative descriptors.
 */
import { SECRET_REFERENCE_PATTERN, isSecretReference } from '@finapp/m30-platform';

export { SECRET_REFERENCE_PATTERN, isSecretReference };

export class IntegrationError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string, message?: string) {
    super(message ?? reasonCode);
    this.name = 'IntegrationError';
    this.reasonCode = reasonCode;
  }
}

export const M33_LIMITS = {
  maxConfigBytes: 131072,
  maxCapabilities: 200,
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

export const AUTH_KINDS = ['none', 'api_key', 'oauth2', 'basic', 'secret_ref'] as const;
export function isAuthKind(s: string): boolean {
  return (AUTH_KINDS as readonly string[]).includes(s);
}
export const CATEGORIES = ['finance', 'crm', 'messaging', 'storage', 'analytics', 'custom'] as const;
export function isCategory(s: string): boolean {
  return (CATEGORIES as readonly string[]).includes(s);
}
export const DIRECTIONS = ['inbound', 'outbound'] as const;
export function isDirection(s: string): boolean {
  return (DIRECTIONS as readonly string[]).includes(s);
}
export const CAPABILITY_KINDS = ['read', 'action'] as const;
export function isCapabilityKind(s: string): boolean {
  return (CAPABILITY_KINDS as readonly string[]).includes(s);
}

export const CONNECTOR_STATES = [
  'draft',
  'validated',
  'review_pending',
  'published',
  'deprecated',
  'rejected',
] as const;
export type ConnectorState = (typeof CONNECTOR_STATES)[number];
export function isConnectorState(s: string): s is ConnectorState {
  return (CONNECTOR_STATES as readonly string[]).includes(s);
}
export function isConnectorFrozen(s: string): boolean {
  return s === 'rejected';
}

export const RUN_STATUSES = ['requested', 'running', 'succeeded', 'failed', 'blocked'] as const;
export function isRunStatus(s: string): boolean {
  return (RUN_STATUSES as readonly string[]).includes(s);
}

export const REASON_CODES = {
  connectorDefined: 'connector_defined',
  connectorValidated: 'connector_validated',
  capabilityRegistered: 'capability_registered',
  reviewRequested: 'review_requested',
  published: 'connector_published',
  deprecated: 'connector_deprecated',
  rejected: 'review_rejected',
  connectionCreated: 'connection_created',
  connectionUpdated: 'connection_updated',
  secretSet: 'connection_secret_set',
  runStarted: 'run_started',
  runSucceeded: 'run_succeeded',
  runFailed: 'run_failed',
  runBlocked: 'run_blocked',
  validationNotPassed: 'validation_not_passed',
  validationFailed: 'validation_failed',
  notHumanApprover: 'approver_not_human',
  selfApproval: 'self_approval_forbidden',
  secretValueForbidden: 'secret_value_forbidden',
  invalidSecretReference: 'invalid_secret_reference',
  runtimeUnavailable: 'connector_runtime_unavailable',
  unregisteredCapability: 'unregistered_capability',
  connectorNotPublished: 'connector_not_published',
  structuralInvalid: 'structural_invalid',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

// ---- maker-checker (connector publication is a controlled action) ----

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

// ---- SECRET SEAM screening (no raw secret VALUE in a connection config) ----

const SECRET_KEY_PATTERN =
  /(?:^|[._-])(?:password|passwd|secret|api[_-]?key|apikey|token|private[_-]?key|credential|client[_-]?secret|access[_-]?token)(?:$|[._-])/i;

export interface ValidationFinding {
  readonly code: string;
  readonly ref?: string;
}

function walk(value: unknown, key: string, findings: ValidationFinding[]): void {
  if (findings.length >= M33_LIMITS.maxFindings) return;
  if (typeof value === 'string') {
    if (SECRET_KEY_PATTERN.test(key) && !isSecretReference(value)) {
      // a secret-keyed field in a connection config must be an opaque secretref: pointer, never a raw value.
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

/** Screen a connection config for raw secret VALUES — a secret must be an opaque `secretref:` pointer (m30 seam). */
export function screenConnectionConfig(config: unknown): readonly ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  walk(config, '', findings);
  return findings;
}

// ---- connector definition validation (fail closed) ----

export interface ValidationOutcome {
  readonly passed: boolean;
  readonly findings: readonly ValidationFinding[];
}

/** A connector definition is valid if its key/auth_kind/category are well-formed and its config is bounded. Fail closed. */
export function validateConnectorDefinition(input: {
  connectorKey: string;
  authKind: string;
  category: string;
}): ValidationOutcome {
  const findings: ValidationFinding[] = [];
  if (input.connectorKey.trim() === '')
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'connector_key' });
  if (!isAuthKind(input.authKind)) findings.push({ code: REASON_CODES.structuralInvalid, ref: 'auth_kind' });
  if (!isCategory(input.category)) findings.push({ code: REASON_CODES.structuralInvalid, ref: 'category' });
  return { passed: findings.length === 0, findings };
}

export interface Page {
  readonly limit: number;
  readonly offset: number;
}
export function clampPage(limit?: number, offset?: number): Page {
  const l =
    limit === undefined || limit <= 0 ? M33_LIMITS.defaultPageSize : Math.min(limit, M33_LIMITS.maxPageSize);
  const o = offset === undefined || offset < 0 ? 0 : offset;
  return { limit: l, offset: o };
}
