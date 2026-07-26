/**
 * Notification template spec + variable schema (the immutable, versioned document stored on
 * `notification_template_version.spec`, ADR-039). A template declares its channel, an optional subject
 * template, a body template, and a typed variable schema. The spec is validated fail-closed at the VALIDATE
 * lifecycle step and frozen at publish (content_hash) — exactly like m07's rule-set spec (ADR-032 mirror).
 *
 * Templates are DATA: the only dynamic construct is `{{ variableName }}` substitution over declared, typed
 * variables. There is no expression language, no logic, no host code — injection is impossible by construction
 * (ADR-040). See render.ts for the safe renderer.
 */
import { CHANNELS, channelHasSubject, isChannel, type Channel } from './channels.ts';
import { NOTIFY_LIMITS } from './limits.ts';
import { extractPlaceholders, hasMalformedPlaceholder } from './render.ts';

export const TEMPLATE_SCHEMA_VERSION = 1;

export const VARIABLE_TYPES = ['string', 'number', 'boolean', 'date'] as const;
export type VariableType = (typeof VARIABLE_TYPES)[number];

export interface VariableSchema {
  readonly name: string;
  readonly type: VariableType;
  readonly required?: boolean;
}

export interface TemplateSpec {
  readonly schemaVersion: number;
  readonly code: string;
  readonly name: string;
  readonly channel: Channel;
  readonly locale?: string;
  readonly subjectTemplate?: string;
  readonly bodyTemplate: string;
  readonly variables: readonly VariableSchema[];
}

export interface TemplateError {
  readonly path: string;
  readonly code: string;
}

export interface TemplateValidation {
  readonly ok: boolean;
  readonly errors: readonly TemplateError[];
}

const IDENT_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

/** Validate a candidate template spec fail-closed. Returns every problem at once (the author sees them all). */
export function validateTemplateSpec(candidate: unknown): TemplateValidation {
  const errors: TemplateError[] = [];
  const push = (path: string, code: string): void => void errors.push({ path, code });

  if (typeof candidate !== 'object' || candidate === null) {
    return { ok: false, errors: [{ path: '<root>', code: 'NOT_AN_OBJECT' }] };
  }
  const spec = candidate as Record<string, unknown>;

  if (spec['schemaVersion'] !== TEMPLATE_SCHEMA_VERSION) push('schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION');
  if (typeof spec['code'] !== 'string' || !IDENT_RE.test(spec['code'])) push('code', 'INVALID_CODE');
  if (typeof spec['name'] !== 'string' || spec['name'].trim() === '') push('name', 'NAME_REQUIRED');
  if (!isChannel(spec['channel'])) push('channel', 'INVALID_CHANNEL');
  if (
    spec['locale'] !== undefined &&
    (typeof spec['locale'] !== 'string' || !LOCALE_RE.test(spec['locale']))
  ) {
    push('locale', 'INVALID_LOCALE');
  }

  const channel = isChannel(spec['channel']) ? spec['channel'] : null;

  // Body template ------------------------------------------------------------------------------
  const body = spec['bodyTemplate'];
  if (typeof body !== 'string' || body === '') {
    push('bodyTemplate', 'BODY_REQUIRED');
  } else if (body.length > NOTIFY_LIMITS.maxTemplateChars) {
    push('bodyTemplate', 'BODY_TOO_LARGE');
  }

  // Subject template ---------------------------------------------------------------------------
  const subject = spec['subjectTemplate'];
  if (subject !== undefined) {
    if (typeof subject !== 'string') {
      push('subjectTemplate', 'INVALID_SUBJECT');
    } else if (subject.length > NOTIFY_LIMITS.maxTemplateChars) {
      push('subjectTemplate', 'SUBJECT_TOO_LARGE');
    } else if (channel !== null && !channelHasSubject(channel)) {
      push('subjectTemplate', 'SUBJECT_NOT_SUPPORTED_FOR_CHANNEL');
    }
  }

  // Variables ----------------------------------------------------------------------------------
  const vars = spec['variables'];
  const declared = new Set<string>();
  if (!Array.isArray(vars)) {
    push('variables', 'VARIABLES_MUST_BE_ARRAY');
  } else {
    if (vars.length > NOTIFY_LIMITS.maxVariables) push('variables', 'TOO_MANY_VARIABLES');
    vars.forEach((v, i) => {
      if (typeof v !== 'object' || v === null) {
        push(`variables[${String(i)}]`, 'INVALID_VARIABLE');
        return;
      }
      const vv = v as Record<string, unknown>;
      if (typeof vv['name'] !== 'string' || !IDENT_RE.test(vv['name'])) {
        push(`variables[${String(i)}].name`, 'INVALID_VARIABLE_NAME');
      } else if (declared.has(vv['name'])) {
        push(`variables[${String(i)}].name`, 'DUPLICATE_VARIABLE');
      } else {
        declared.add(vv['name']);
      }
      if (!(VARIABLE_TYPES as readonly unknown[]).includes(vv['type'])) {
        push(`variables[${String(i)}].type`, 'INVALID_VARIABLE_TYPE');
      }
    });
  }

  // Placeholders must be well-formed and reference a declared variable ---------------------------
  for (const [field, tpl] of [
    ['bodyTemplate', body],
    ['subjectTemplate', subject],
  ] as const) {
    if (typeof tpl !== 'string') continue;
    if (hasMalformedPlaceholder(tpl)) push(field, 'MALFORMED_PLACEHOLDER');
    const placeholders = extractPlaceholders(tpl);
    if (placeholders.length > NOTIFY_LIMITS.maxPlaceholders) push(field, 'TOO_MANY_PLACEHOLDERS');
    for (const name of placeholders) {
      if (!declared.has(name)) push(field, `UNKNOWN_PLACEHOLDER:${name}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** The declared variables of a valid spec, or empty. */
export function templateVariables(spec: TemplateSpec): readonly VariableSchema[] {
  return spec.variables;
}

export { CHANNELS };
