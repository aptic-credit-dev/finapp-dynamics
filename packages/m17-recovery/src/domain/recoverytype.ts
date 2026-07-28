/**
 * Recovery-type spec validation — PURE. A recovery type is a versioned, immutable-after-publish document (mirrors
 * m09 doctype / m16). It is DECLARATIVE configuration — defaults, applicable jurisdictions, eligible instruments +
 * strategies, support flags and references to an m06 workflow definition + an m17 SLA policy. There is NO
 * executable expression inside a recovery type; complex decisioning (strategy selection / risk / SLA / write-off
 * eligibility / closure) is delegated to the m07 rules engine (ADR-069). Procedures/notices/auctioneers are NOT
 * enumerated in service logic — they are configured here per tenant.
 */
import { CONFIDENTIALITY_LEVELS, RECOVERY_RISKS, PRIORITIES } from './limits.ts';

export const RECOVERY_TYPE_SCHEMA_VERSION = 1;

export interface RecoveryTypeSpec {
  readonly schemaVersion: number;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
  readonly jurisdictionApplicability?: readonly string[];
  readonly eligibleInstruments?: readonly string[];
  readonly eligibleStrategies?: readonly string[];
  readonly defaultConfidentiality?: string;
  readonly defaultPrivileged?: boolean;
  readonly defaultRisk?: string;
  readonly defaultPriority?: string;
  readonly workflowDefinitionCode?: string;
  readonly slaPolicyCode?: string;
  readonly requiredDocuments?: readonly string[];
  readonly requiredApprovals?: readonly string[];
  readonly demandSupport?: boolean;
  readonly negotiationSupport?: boolean;
  readonly arrangementSupport?: boolean;
  readonly enforcementSupport?: boolean;
  readonly securitySupport?: boolean;
  readonly agentSupport?: boolean;
  readonly writeOffSupport?: boolean;
  readonly externalAgentRequired?: boolean;
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

export function validateRecoveryTypeSpec(candidate: unknown): SpecValidation {
  const errors: SpecError[] = [];
  const push = (p: string, c: string): void => void errors.push({ path: p, code: c });
  if (typeof candidate !== 'object' || candidate === null)
    return { ok: false, errors: [{ path: '<root>', code: 'NOT_AN_OBJECT' }] };
  const s = candidate as Record<string, unknown>;
  if (s['schemaVersion'] !== RECOVERY_TYPE_SCHEMA_VERSION)
    push('schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION');
  if (typeof s['code'] !== 'string' || !IDENT_RE.test(s['code'])) push('code', 'INVALID_CODE');
  if (typeof s['name'] !== 'string' || s['name'].trim() === '') push('name', 'NAME_REQUIRED');
  const conf = s['defaultConfidentiality'];
  if (conf !== undefined && !(CONFIDENTIALITY_LEVELS as readonly unknown[]).includes(conf))
    push('defaultConfidentiality', 'INVALID_CONFIDENTIALITY');
  const risk = s['defaultRisk'];
  if (risk !== undefined && !(RECOVERY_RISKS as readonly unknown[]).includes(risk))
    push('defaultRisk', 'INVALID_RISK');
  const prio = s['defaultPriority'];
  if (prio !== undefined && !(PRIORITIES as readonly unknown[]).includes(prio))
    push('defaultPriority', 'INVALID_PRIORITY');
  if (!isStringArray(s['jurisdictionApplicability'])) push('jurisdictionApplicability', 'INVALID_LIST');
  if (!isStringArray(s['eligibleInstruments'])) push('eligibleInstruments', 'INVALID_LIST');
  if (!isStringArray(s['eligibleStrategies'])) push('eligibleStrategies', 'INVALID_LIST');
  if (!isStringArray(s['requiredDocuments'])) push('requiredDocuments', 'INVALID_LIST');
  if (!isStringArray(s['requiredApprovals'])) push('requiredApprovals', 'INVALID_LIST');
  return { ok: errors.length === 0, errors };
}
