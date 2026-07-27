/**
 * Matter-type spec validation (G1) — PURE. A matter type is a versioned, immutable-after-publish document (mirrors
 * m09 doctype / m13). It is DECLARATIVE configuration — defaults, applicable jurisdictions, required roles/
 * documents/approvals, support flags and references to an m06 workflow definition + an m14 SLA policy. There is NO
 * executable expression inside a matter type; complex decisioning (legal-risk / assignment / SLA selection /
 * closure) is delegated to the m07 rules engine (ADR-061). Legal categories are NOT enumerated in service logic —
 * they are configured here per tenant.
 */
import { CONFIDENTIALITY_LEVELS, LEGAL_RISKS, PRIORITIES } from './limits.ts';

export const MATTER_TYPE_SCHEMA_VERSION = 1;

export interface MatterTypeSpec {
  readonly schemaVersion: number;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
  readonly subtype?: string;
  readonly jurisdictionApplicability?: readonly string[];
  readonly defaultConfidentiality?: string;
  readonly defaultPrivileged?: boolean;
  readonly defaultRisk?: string;
  readonly defaultPriority?: string;
  readonly workflowDefinitionCode?: string;
  readonly slaPolicyCode?: string;
  readonly deadlinePolicyCode?: string;
  readonly requiredRoles?: readonly string[];
  readonly requiredDocuments?: readonly string[];
  readonly requiredApprovals?: readonly string[];
  readonly courtEventSupport?: boolean;
  readonly settlementSupport?: boolean;
  readonly externalCounselSupport?: boolean;
  readonly appealSupport?: boolean;
  readonly enforcementSupport?: boolean;
  readonly regulatoryReporting?: boolean;
}

export interface SpecError {
  readonly path: string;
  readonly code: string;
}
export interface SpecValidation {
  readonly ok: boolean;
  readonly errors: readonly SpecError[];
}

const IDENT_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
function isStringArray(v: unknown): boolean {
  return v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
}

export function validateMatterTypeSpec(candidate: unknown): SpecValidation {
  const errors: SpecError[] = [];
  const push = (p: string, c: string): void => void errors.push({ path: p, code: c });
  if (typeof candidate !== 'object' || candidate === null)
    return { ok: false, errors: [{ path: '<root>', code: 'NOT_AN_OBJECT' }] };
  const s = candidate as Record<string, unknown>;
  if (s['schemaVersion'] !== MATTER_TYPE_SCHEMA_VERSION) push('schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION');
  if (typeof s['code'] !== 'string' || !IDENT_RE.test(s['code'])) push('code', 'INVALID_CODE');
  if (typeof s['name'] !== 'string' || s['name'].trim() === '') push('name', 'NAME_REQUIRED');
  const conf = s['defaultConfidentiality'];
  if (conf !== undefined && !(CONFIDENTIALITY_LEVELS as readonly unknown[]).includes(conf))
    push('defaultConfidentiality', 'INVALID_CONFIDENTIALITY');
  const risk = s['defaultRisk'];
  if (risk !== undefined && !(LEGAL_RISKS as readonly unknown[]).includes(risk))
    push('defaultRisk', 'INVALID_RISK');
  const prio = s['defaultPriority'];
  if (prio !== undefined && !(PRIORITIES as readonly unknown[]).includes(prio))
    push('defaultPriority', 'INVALID_PRIORITY');
  if (!isStringArray(s['jurisdictionApplicability'])) push('jurisdictionApplicability', 'INVALID_LIST');
  if (!isStringArray(s['requiredRoles'])) push('requiredRoles', 'INVALID_LIST');
  if (!isStringArray(s['requiredDocuments'])) push('requiredDocuments', 'INVALID_LIST');
  if (!isStringArray(s['requiredApprovals'])) push('requiredApprovals', 'INVALID_LIST');
  return { ok: errors.length === 0, errors };
}
