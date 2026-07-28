/**
 * Proceeding-type spec validation — PURE. A proceeding type is a versioned, immutable-after-publish document
 * (mirrors m09 doctype / m14). It is DECLARATIVE configuration — defaults, applicable jurisdictions, eligible
 * forum types, procedural stages, required documents/approvals, support flags and references to an m06 workflow
 * definition + an m16 SLA policy. There is NO executable expression inside a proceeding type; complex decisioning
 * (litigation-risk / assignment / SLA selection / hearing-readiness / closure) is delegated to the m07 rules
 * engine (ADR-065). Court/tribunal/statute names are NOT enumerated in service logic — they are configured here
 * per tenant.
 */
import { CONFIDENTIALITY_LEVELS, LITIGATION_RISKS, PRIORITIES } from './limits.ts';

export const PROCEEDING_TYPE_SCHEMA_VERSION = 1;

export interface ProceedingTypeSpec {
  readonly schemaVersion: number;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
  readonly jurisdictionApplicability?: readonly string[];
  readonly eligibleForumTypes?: readonly string[];
  readonly proceduralStages?: readonly string[];
  readonly defaultConfidentiality?: string;
  readonly defaultPrivileged?: boolean;
  readonly defaultRisk?: string;
  readonly defaultPriority?: string;
  readonly workflowDefinitionCode?: string;
  readonly slaPolicyCode?: string;
  readonly requiredDocuments?: readonly string[];
  readonly requiredApprovals?: readonly string[];
  readonly filingRequired?: boolean;
  readonly serviceRequired?: boolean;
  readonly hearingSupport?: boolean;
  readonly witnessSupport?: boolean;
  readonly exhibitSupport?: boolean;
  readonly bundleSupport?: boolean;
  readonly orderSupport?: boolean;
  readonly appealSupport?: boolean;
  readonly complianceSupport?: boolean;
  readonly externalCounselRequired?: boolean;
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

export function validateProceedingTypeSpec(candidate: unknown): SpecValidation {
  const errors: SpecError[] = [];
  const push = (p: string, c: string): void => void errors.push({ path: p, code: c });
  if (typeof candidate !== 'object' || candidate === null)
    return { ok: false, errors: [{ path: '<root>', code: 'NOT_AN_OBJECT' }] };
  const s = candidate as Record<string, unknown>;
  if (s['schemaVersion'] !== PROCEEDING_TYPE_SCHEMA_VERSION)
    push('schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION');
  if (typeof s['code'] !== 'string' || !IDENT_RE.test(s['code'])) push('code', 'INVALID_CODE');
  if (typeof s['name'] !== 'string' || s['name'].trim() === '') push('name', 'NAME_REQUIRED');
  const conf = s['defaultConfidentiality'];
  if (conf !== undefined && !(CONFIDENTIALITY_LEVELS as readonly unknown[]).includes(conf))
    push('defaultConfidentiality', 'INVALID_CONFIDENTIALITY');
  const risk = s['defaultRisk'];
  if (risk !== undefined && !(LITIGATION_RISKS as readonly unknown[]).includes(risk))
    push('defaultRisk', 'INVALID_RISK');
  const prio = s['defaultPriority'];
  if (prio !== undefined && !(PRIORITIES as readonly unknown[]).includes(prio))
    push('defaultPriority', 'INVALID_PRIORITY');
  if (!isStringArray(s['jurisdictionApplicability'])) push('jurisdictionApplicability', 'INVALID_LIST');
  if (!isStringArray(s['eligibleForumTypes'])) push('eligibleForumTypes', 'INVALID_LIST');
  if (!isStringArray(s['proceduralStages'])) push('proceduralStages', 'INVALID_LIST');
  if (!isStringArray(s['requiredDocuments'])) push('requiredDocuments', 'INVALID_LIST');
  if (!isStringArray(s['requiredApprovals'])) push('requiredApprovals', 'INVALID_LIST');
  return { ok: errors.length === 0, errors };
}
