/**
 * M31 PURE domain — vocabulary, type guards, the maker-checker/SoD + publish gates, and the fail-closed design
 * VALIDATION. No I/O. Design validation REUSES the canonical sandboxed mechanisms (m06 `validateDefinition` +
 * `compileExpression`, m07 `validateRuleSet`) — there is NO eval/Function/vm/SQL/shell here; a prohibited execution
 * expression, a raw secret VALUE (a secret must be an opaque `secretref:` pointer), or a structurally-invalid design all
 * FAIL closed and block publication. A form design is DECLARATIVE only (typed fields, bounded validation, conditional
 * visibility referencing existing fields) — no executable code.
 */
import { validateDefinition, compileExpression, ExpressionError } from '@finapp/m06-workflow';
import { validateRuleSet } from '@finapp/m07-rules';
import { SECRET_REFERENCE_PATTERN, isSecretReference } from '@finapp/m30-platform';

export { SECRET_REFERENCE_PATTERN, isSecretReference };

export class StudioError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string, message?: string) {
    super(message ?? reasonCode);
    this.name = 'StudioError';
    this.reasonCode = reasonCode;
  }
}

export const M31_LIMITS = {
  maxSpecBytes: 262144,
  maxFindings: 100,
  maxFields: 500,
  maxSections: 100,
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

export const ARTIFACT_KINDS = ['workflow', 'rule', 'form'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export function isArtifactKind(s: string): s is ArtifactKind {
  return (ARTIFACT_KINDS as readonly string[]).includes(s);
}

export const VERSION_STATES = [
  'draft',
  'validating',
  'validated',
  'review_pending',
  'published',
  'superseded',
  'rejected',
  'archived',
] as const;
export type VersionState = (typeof VERSION_STATES)[number];
export function isVersionState(s: string): s is VersionState {
  return (VERSION_STATES as readonly string[]).includes(s);
}
/** A terminal, immutable version state (DB trigger enforces immutability once here). */
export function isVersionFrozen(s: string): boolean {
  return s === 'published' || s === 'superseded' || s === 'archived';
}

export const TARGET_ENGINES = ['workflow', 'rule', 'none'] as const;
export type TargetEngine = (typeof TARGET_ENGINES)[number];
/** The canonical runtime engine a design kind binds to at publish (a form binds to nothing external). */
export function targetEngineForKind(kind: ArtifactKind): TargetEngine {
  return kind === 'workflow' ? 'workflow' : kind === 'rule' ? 'rule' : 'none';
}

export const REASON_CODES = {
  projectCreated: 'project_created',
  artifactCreated: 'artifact_created',
  versionCreated: 'version_created',
  validationPassed: 'validation_passed',
  validationFailed: 'validation_failed',
  reviewRequested: 'review_requested',
  published: 'artifact_published',
  rejected: 'review_rejected',
  superseded: 'artifact_superseded',
  archived: 'artifact_archived',
  bindingCreated: 'binding_created',
  notValidated: 'not_validated',
  validationNotPassed: 'validation_not_passed',
  notHumanApprover: 'approver_not_human',
  selfApproval: 'self_approval_forbidden',
  missingBinding: 'binding_missing',
  capabilityUnavailable: 'integration_capability_unavailable',
  secretValueForbidden: 'secret_value_forbidden',
  invalidSecretReference: 'invalid_secret_reference',
  prohibitedExpression: 'prohibited_expression',
  invalidExpression: 'invalid_expression',
  specTooLarge: 'spec_too_large',
  structuralInvalid: 'structural_invalid',
  formInvalid: 'form_schema_invalid',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

/**
 * A human actor. `null`/blank and the reserved non-human identities (`system`, `ai`, `automation`) are NEVER human —
 * AI never approves/publishes a Studio artifact (mirrors m29 `isHumanActor`). Fail closed.
 */
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

/** Maker-checker / SoD: the approver must be a HUMAN and can never be the requester (author != approver). */
export function evaluateSodGate(requestedBy: string, approver: string | null): GateResult {
  if (!isHumanActor(approver)) return { allowed: false, reasonCode: REASON_CODES.notHumanApprover };
  if (approver === requestedBy) return { allowed: false, reasonCode: REASON_CODES.selfApproval };
  return { allowed: true, reasonCode: REASON_CODES.published };
}

export interface PublishGateInput {
  readonly validationPassed: boolean;
  readonly requestedBy: string;
  readonly approver: string | null;
  readonly hasBinding: boolean;
}

/** The full publish gate: passing validation + a human approver who is not the requester + a valid runtime binding. */
export function evaluatePublishGate(input: PublishGateInput): GateResult {
  if (!input.validationPassed) return { allowed: false, reasonCode: REASON_CODES.validationNotPassed };
  const sod = evaluateSodGate(input.requestedBy, input.approver);
  if (!sod.allowed) return sod;
  if (!input.hasBinding) return { allowed: false, reasonCode: REASON_CODES.missingBinding };
  return { allowed: true, reasonCode: REASON_CODES.published };
}

export interface ValidationFinding {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly ref?: string;
}
export interface ValidationOutcome {
  readonly passed: boolean;
  readonly findings: readonly ValidationFinding[];
}

// A bounded set of tokens that indicate an attempt to smuggle arbitrary code / SQL / shell into a DECLARATIVE design.
// Studio stores declarative metadata only; legitimate declarative conditions (e.g. `amount > 100`) match none of these.
const PROHIBITED_PATTERNS: readonly RegExp[] = [
  /\beval\s*\(/i,
  /\bFunction\s*\(/,
  /\brequire\s*\(/i,
  /\bimport\s*\(/i,
  /\bprocess\./i,
  /child_process/i,
  /\bexec(?:Sync)?\s*\(/i,
  /\b(?:DROP|DELETE|INSERT|UPDATE|SELECT|TRUNCATE|ALTER)\b[\s\S]*\b(?:FROM|INTO|TABLE|WHERE)\b/i,
  /\$\{[\s\S]*\}/,
  /[`]/,
  /\/(?:bin|etc|usr)\//i,
  /--\s|\/\*/,
];

// Field keys that must hold an OPAQUE secretref: pointer, never a literal secret value.
const SECRET_KEY_PATTERN =
  /(?:^|[._-])(?:password|passwd|secret|api[_-]?key|apikey|token|private[_-]?key|credential|client[_-]?secret)(?:$|[._-])/i;

interface ScanState {
  findings: ValidationFinding[];
}

function walkStrings(value: unknown, key: string, state: ScanState): void {
  if (state.findings.length >= M31_LIMITS.maxFindings) return;
  if (typeof value === 'string') {
    // Prohibited execution / SQL / shell smuggling — fail closed.
    for (const p of PROHIBITED_PATTERNS) {
      if (p.test(value)) {
        state.findings.push({ code: REASON_CODES.prohibitedExpression, severity: 'error', ref: key });
        break;
      }
    }
    // A secret-keyed field must be an opaque secretref: pointer, never a raw secret VALUE.
    if (SECRET_KEY_PATTERN.test(key)) {
      if (!isSecretReference(value)) {
        state.findings.push({ code: REASON_CODES.secretValueForbidden, severity: 'error', ref: key });
      }
    } else if (value.startsWith('secretref:') && !SECRET_REFERENCE_PATTERN.test(value)) {
      state.findings.push({ code: REASON_CODES.invalidSecretReference, severity: 'error', ref: key });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) walkStrings(value[i], `${key}[${i}]`, state);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walkStrings(v, key === '' ? k : `${key}.${k}`, state);
    }
  }
}

/** Deep-scan a design spec for prohibited execution expressions and raw secret values (both fail closed). */
export function scanSpecForProhibited(spec: unknown): readonly ValidationFinding[] {
  const state: ScanState = { findings: [] };
  walkStrings(spec, '', state);
  return state.findings;
}

// ---- Declarative form-schema validation (m31 is the canonical owner of reusable form definitions) ----

const FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'boolean',
  'date',
  'datetime',
  'select',
  'multiselect',
  'email',
  'phone',
] as const;
export function isFormFieldType(s: string): boolean {
  return (FORM_FIELD_TYPES as readonly string[]).includes(s);
}

export function validateFormSchema(raw: unknown): ValidationOutcome {
  const findings: ValidationFinding[] = [];
  const add = (code: string, ref?: string): void => {
    if (findings.length < M31_LIMITS.maxFindings)
      findings.push(ref !== undefined ? { code, severity: 'error', ref } : { code, severity: 'error' });
  };
  const spec = raw as Record<string, unknown> | null;
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    add(REASON_CODES.formInvalid, 'root');
    return { passed: false, findings };
  }
  if (spec['schemaVersion'] !== 1) add(REASON_CODES.formInvalid, 'schemaVersion');
  const formKey = spec['key'];
  if (typeof formKey !== 'string' || formKey.trim() === '') add(REASON_CODES.formInvalid, 'key');
  const sections = spec['sections'];
  if (!Array.isArray(sections)) {
    add(REASON_CODES.formInvalid, 'sections');
    return { passed: findings.length === 0, findings };
  }
  if (sections.length > M31_LIMITS.maxSections) add(REASON_CODES.formInvalid, 'sections');
  const fieldKeys = new Set<string>();
  let fieldCount = 0;
  for (let s = 0; s < sections.length; s++) {
    const section = sections[s] as Record<string, unknown> | null;
    if (section === null || typeof section !== 'object') {
      add(REASON_CODES.formInvalid, `sections[${s}]`);
      continue;
    }
    const fields = section['fields'];
    if (!Array.isArray(fields)) {
      add(REASON_CODES.formInvalid, `sections[${s}].fields`);
      continue;
    }
    for (let f = 0; f < fields.length; f++) {
      fieldCount++;
      if (fieldCount > M31_LIMITS.maxFields) {
        add(REASON_CODES.formInvalid, 'fields');
        break;
      }
      const field = fields[f] as Record<string, unknown> | null;
      const ref = `sections[${s}].fields[${f}]`;
      if (field === null || typeof field !== 'object') {
        add(REASON_CODES.formInvalid, ref);
        continue;
      }
      const fkey = field['key'];
      if (typeof fkey !== 'string' || fkey.trim() === '') add(REASON_CODES.formInvalid, `${ref}.key`);
      else if (fieldKeys.has(fkey)) add(REASON_CODES.formInvalid, `${ref}.key`);
      else fieldKeys.add(fkey);
      const ftype = field['type'];
      if (typeof ftype !== 'string' || !isFormFieldType(ftype)) add(REASON_CODES.formInvalid, `${ref}.type`);
    }
  }
  // Conditional-visibility metadata must reference an existing field key (declarative, no code).
  for (let s = 0; s < sections.length; s++) {
    const section = sections[s] as Record<string, unknown> | null;
    const fields = section?.['fields'];
    if (!Array.isArray(fields)) continue;
    for (let f = 0; f < fields.length; f++) {
      const field = fields[f] as Record<string, unknown> | null;
      const vw = field?.['visibleWhen'] as Record<string, unknown> | undefined;
      if (vw !== undefined) {
        const dependsOn = vw['field'];
        if (typeof dependsOn !== 'string' || !fieldKeys.has(dependsOn))
          add(REASON_CODES.formInvalid, `sections[${s}].fields[${f}].visibleWhen.field`);
      }
    }
  }
  return { passed: findings.length === 0, findings };
}

/**
 * Validate a design spec fail-closed. Structural validation is delegated to the CANONICAL validators (m06/m07) for
 * workflow/rule and to the declarative form validator; workflow conditions are compiled through the m06 SANDBOX
 * (`compileExpression` — no eval); every kind is additionally deep-scanned for prohibited execution expressions and raw
 * secret values. A design that produces any error finding cannot be published.
 */
export function validateArtifactSpec(kind: ArtifactKind, spec: unknown): ValidationOutcome {
  const findings: ValidationFinding[] = [];
  const push = (fs: readonly ValidationFinding[]): void => {
    for (const f of fs) if (findings.length < M31_LIMITS.maxFindings) findings.push(f);
  };

  const specBytes = JSON.stringify(spec ?? null).length;
  if (specBytes > M31_LIMITS.maxSpecBytes) {
    return { passed: false, findings: [{ code: REASON_CODES.specTooLarge, severity: 'error', ref: 'root' }] };
  }

  if (kind === 'workflow') {
    const result = validateDefinition(spec);
    if (!result.ok) {
      for (const e of result.errors)
        push([{ code: REASON_CODES.structuralInvalid, severity: 'error', ref: errRef(e) }]);
    }
    push(validateWorkflowConditions(spec));
  } else if (kind === 'rule') {
    const result = validateRuleSet(spec);
    if (!result.ok) {
      for (const e of result.errors)
        push([{ code: REASON_CODES.structuralInvalid, severity: 'error', ref: errRef(e) }]);
    }
  } else {
    push(validateFormSchema(spec).findings);
  }

  push(scanSpecForProhibited(spec));

  const passed = findings.every((f) => f.severity !== 'error');
  return { passed, findings };
}

function boundedRef(s: string): string {
  return s.length > 120 ? s.slice(0, 120) : s;
}

// Extract a bounded, machine-readable ref from a canonical validator error ({ path, code, message }) — never spec content.
function errRef(e: unknown): string {
  const o = e as { code?: unknown; message?: unknown };
  const raw = typeof o.code === 'string' ? o.code : typeof o.message === 'string' ? o.message : 'invalid';
  return boundedRef(raw);
}

// Compile every workflow transition condition through the m06 SANDBOX. A prohibited/invalid expression fails closed.
function validateWorkflowConditions(spec: unknown): readonly ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const s = spec as Record<string, unknown> | null;
  if (s === null || typeof s !== 'object') return findings;
  const variables = Array.isArray(s['variables'])
    ? (s['variables'] as unknown[])
        .map((v) => (v as { name?: unknown }).name)
        .filter((n): n is string => typeof n === 'string')
    : [];
  const transitions = Array.isArray(s['transitions']) ? (s['transitions'] as unknown[]) : [];
  for (let i = 0; i < transitions.length; i++) {
    const cond = (transitions[i] as { condition?: unknown }).condition;
    if (typeof cond === 'string' && cond.trim() !== '') {
      try {
        compileExpression(cond, variables);
      } catch (e) {
        const code =
          e instanceof ExpressionError ? REASON_CODES.invalidExpression : REASON_CODES.invalidExpression;
        findings.push({ code, severity: 'error', ref: `transitions[${i}].condition` });
      }
    }
  }
  return findings;
}

export interface Page {
  readonly limit: number;
  readonly offset: number;
}
export function clampPage(limit?: number, offset?: number): Page {
  const l =
    limit === undefined || limit <= 0 ? M31_LIMITS.defaultPageSize : Math.min(limit, M31_LIMITS.maxPageSize);
  const o = offset === undefined || offset < 0 ? 0 : offset;
  return { limit: l, offset: o };
}
