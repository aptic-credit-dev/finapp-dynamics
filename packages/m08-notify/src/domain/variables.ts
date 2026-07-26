/**
 * Variable validation — checks the values supplied on a notification request against a template's declared,
 * typed variable schema (prompt §E3). Fail-closed: a missing required variable, an unknown variable, a
 * type mismatch, or an over-limit set is rejected deterministically. Produces the normalized scalar map the
 * safe renderer consumes.
 */
import { NOTIFY_LIMITS } from './limits.ts';
import type { RenderValue } from './render.ts';
import type { VariableSchema } from './template.ts';

export interface VariableError {
  readonly name: string;
  readonly code: string;
}

export interface VariableValidation {
  readonly ok: boolean;
  readonly errors: readonly VariableError[];
  readonly values: Readonly<Record<string, RenderValue>>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/;

function typeMatches(type: VariableSchema['type'], value: unknown): value is RenderValue {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && ISO_DATE_RE.test(value);
    default:
      return false;
  }
}

/**
 * Validate `provided` against `schema`. Unknown keys are an error (not silently dropped) so a caller learns
 * when a variable name is wrong rather than shipping a blank in the message.
 */
export function validateVariables(schema: readonly VariableSchema[], provided: unknown): VariableValidation {
  const errors: VariableError[] = [];
  const values: Record<string, RenderValue> = {};

  if (typeof provided !== 'object' || provided === null || Array.isArray(provided)) {
    return { ok: false, errors: [{ name: '<root>', code: 'VARIABLES_MUST_BE_OBJECT' }], values };
  }
  const bag = provided as Record<string, unknown>;
  const keys = Object.keys(bag);
  if (keys.length > NOTIFY_LIMITS.maxSuppliedVariables) {
    return { ok: false, errors: [{ name: '<root>', code: 'TOO_MANY_VARIABLES' }], values };
  }

  const declared = new Map(schema.map((v) => [v.name, v]));

  for (const key of keys) {
    if (!declared.has(key)) errors.push({ name: key, code: 'UNKNOWN_VARIABLE' });
  }

  for (const v of schema) {
    const present = Object.prototype.hasOwnProperty.call(bag, v.name);
    if (!present) {
      if (v.required === true) errors.push({ name: v.name, code: 'MISSING_REQUIRED' });
      continue;
    }
    const raw = bag[v.name];
    if (!typeMatches(v.type, raw)) {
      errors.push({ name: v.name, code: 'TYPE_MISMATCH' });
      continue;
    }
    if (typeof raw === 'string' && raw.length > NOTIFY_LIMITS.maxVariableValueChars) {
      errors.push({ name: v.name, code: 'VALUE_TOO_LARGE' });
      continue;
    }
    values[v.name] = raw;
  }

  return { ok: errors.length === 0, errors, values };
}
