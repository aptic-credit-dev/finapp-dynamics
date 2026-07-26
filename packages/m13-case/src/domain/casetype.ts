/**
 * Case-type spec validation (F1) — PURE. A case type is a versioned, immutable-after-publish document (mirrors
 * m09 doctype / m12 questionnaire). It is DECLARATIVE configuration — defaults, required roles/documents/
 * activities, support flags and references to an m06 workflow definition + an m13 SLA policy. There is NO
 * executable expression inside a case type; complex decisioning (severity / assignment / SLA selection / closure)
 * is delegated to the m07 rules engine (ADR-057). Legal case types are NOT enumerated in service logic — they are
 * configured here per tenant.
 */
import { CONFIDENTIALITY_LEVELS, PRIORITIES, SEVERITIES } from './limits.ts';

export const CASE_TYPE_SCHEMA_VERSION = 1;

export interface CaseTypeSpec {
  readonly schemaVersion: number;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
  readonly subtype?: string;
  readonly defaultClassification?: string;
  readonly defaultConfidentiality?: string;
  readonly defaultPriority?: string;
  readonly defaultSeverity?: string;
  readonly workflowDefinitionCode?: string;
  readonly slaPolicyCode?: string;
  readonly requiredRoles?: readonly string[];
  readonly requiredDocuments?: readonly string[];
  readonly requiredActivities?: readonly string[];
  readonly approvalRequired?: boolean;
  readonly hearingSupport?: boolean;
  readonly investigationSupport?: boolean;
  readonly recoverySupport?: boolean;
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

export function validateCaseTypeSpec(candidate: unknown): SpecValidation {
  const errors: SpecError[] = [];
  const push = (p: string, c: string): void => void errors.push({ path: p, code: c });
  if (typeof candidate !== 'object' || candidate === null)
    return { ok: false, errors: [{ path: '<root>', code: 'NOT_AN_OBJECT' }] };
  const s = candidate as Record<string, unknown>;
  if (s['schemaVersion'] !== CASE_TYPE_SCHEMA_VERSION) push('schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION');
  if (typeof s['code'] !== 'string' || !IDENT_RE.test(s['code'])) push('code', 'INVALID_CODE');
  if (typeof s['name'] !== 'string' || s['name'].trim() === '') push('name', 'NAME_REQUIRED');
  const conf = s['defaultConfidentiality'];
  if (conf !== undefined && !(CONFIDENTIALITY_LEVELS as readonly unknown[]).includes(conf))
    push('defaultConfidentiality', 'INVALID_CONFIDENTIALITY');
  const prio = s['defaultPriority'];
  if (prio !== undefined && !(PRIORITIES as readonly unknown[]).includes(prio))
    push('defaultPriority', 'INVALID_PRIORITY');
  const sev = s['defaultSeverity'];
  if (sev !== undefined && !(SEVERITIES as readonly unknown[]).includes(sev))
    push('defaultSeverity', 'INVALID_SEVERITY');
  if (!isStringArray(s['requiredRoles'])) push('requiredRoles', 'INVALID_LIST');
  if (!isStringArray(s['requiredDocuments'])) push('requiredDocuments', 'INVALID_LIST');
  if (!isStringArray(s['requiredActivities'])) push('requiredActivities', 'INVALID_LIST');
  return { ok: errors.length === 0, errors };
}
