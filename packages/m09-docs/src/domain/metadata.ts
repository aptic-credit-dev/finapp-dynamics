/**
 * Typed metadata validation (prompt §E7). Document metadata is validated against the document type's declared
 * required-metadata schema: required fields present, types matched, unknown fields rejected, bounded key/value
 * sizes. Metadata is a constrained typed map — never unbounded arbitrary JSON (ADR-045). Produces a normalized
 * value map.
 */
import { DOC_LIMITS } from './limits.ts';
import type { MetadataFieldSchema } from './doctype.ts';

export type MetadataValue = string | number | boolean;

export interface MetadataError {
  readonly name: string;
  readonly code: string;
}
export interface MetadataValidation {
  readonly ok: boolean;
  readonly errors: readonly MetadataError[];
  readonly values: Readonly<Record<string, MetadataValue>>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/;

function typeMatches(field: MetadataFieldSchema, value: unknown): value is MetadataValue {
  switch (field.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && ISO_DATE_RE.test(value);
    case 'enum':
      return typeof value === 'string' && (field.enumValues ?? []).includes(value);
    default:
      return false;
  }
}

export function validateMetadata(
  schema: readonly MetadataFieldSchema[],
  provided: unknown,
): MetadataValidation {
  const errors: MetadataError[] = [];
  const values: Record<string, MetadataValue> = {};
  if (typeof provided !== 'object' || provided === null || Array.isArray(provided)) {
    return { ok: false, errors: [{ name: '<root>', code: 'METADATA_MUST_BE_OBJECT' }], values };
  }
  const bag = provided as Record<string, unknown>;
  const keys = Object.keys(bag);
  if (keys.length > DOC_LIMITS.maxMetadataKeys) {
    return { ok: false, errors: [{ name: '<root>', code: 'TOO_MANY_METADATA_KEYS' }], values };
  }
  const declared = new Map(schema.map((f) => [f.name, f]));
  for (const key of keys) {
    if (key.length > DOC_LIMITS.maxMetadataKeyChars) errors.push({ name: key, code: 'KEY_TOO_LONG' });
    if (!declared.has(key)) errors.push({ name: key, code: 'UNKNOWN_METADATA_FIELD' });
  }
  for (const field of schema) {
    const present = Object.prototype.hasOwnProperty.call(bag, field.name);
    if (!present) {
      if (field.required === true) errors.push({ name: field.name, code: 'MISSING_REQUIRED' });
      continue;
    }
    const raw = bag[field.name];
    if (!typeMatches(field, raw)) {
      errors.push({ name: field.name, code: 'TYPE_MISMATCH' });
      continue;
    }
    if (typeof raw === 'string' && raw.length > DOC_LIMITS.maxMetadataValueChars) {
      errors.push({ name: field.name, code: 'VALUE_TOO_LONG' });
      continue;
    }
    values[field.name] = raw;
  }
  return { ok: errors.length === 0, errors, values };
}
