/**
 * Document-type and retention-policy specs (the immutable, versioned documents stored on
 * `document_type.spec` / `retention_policy.spec`, ADR-045). A document type declares allowed media types, max
 * size, required metadata fields (typed), a default classification, an optional retention policy code, and
 * approval/signature requirement flags. A retention policy declares a period, a trigger, a disposition action,
 * and a review requirement. Both are validated fail-closed at the VALIDATE step and frozen at publish.
 */
import { CLASSIFICATIONS } from './limits.ts';

export const TYPE_SCHEMA_VERSION = 1;
export const RETENTION_SCHEMA_VERSION = 1;

export const METADATA_FIELD_TYPES = ['string', 'number', 'boolean', 'date', 'enum'] as const;
export type MetadataFieldType = (typeof METADATA_FIELD_TYPES)[number];

export interface MetadataFieldSchema {
  readonly name: string;
  readonly type: MetadataFieldType;
  readonly required?: boolean;
  readonly searchable?: boolean;
  readonly enumValues?: readonly string[];
}

export interface DocumentTypeSpec {
  readonly schemaVersion: number;
  readonly code: string;
  readonly name: string;
  readonly allowedMediaTypes: readonly string[];
  readonly maxByteSize?: number;
  readonly defaultClassification: string;
  readonly retentionPolicyCode?: string;
  readonly requiredMetadata: readonly MetadataFieldSchema[];
  readonly approvalRequired: boolean;
  readonly signatureRequired: boolean;
  readonly scanRequired: boolean;
}

export const RETENTION_TRIGGERS = ['on_activation', 'on_creation', 'on_supersede', 'on_event'] as const;
export const DISPOSITION_ACTIONS = ['review', 'archive', 'destroy'] as const;

export interface RetentionPolicySpec {
  readonly schemaVersion: number;
  readonly code: string;
  readonly name: string;
  readonly retentionDays: number;
  readonly trigger: (typeof RETENTION_TRIGGERS)[number];
  readonly dispositionAction: (typeof DISPOSITION_ACTIONS)[number];
  readonly reviewRequired: boolean;
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
const MEDIA_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

export function validateDocumentTypeSpec(candidate: unknown): SpecValidation {
  const errors: SpecError[] = [];
  const push = (p: string, c: string): void => void errors.push({ path: p, code: c });
  if (typeof candidate !== 'object' || candidate === null) {
    return { ok: false, errors: [{ path: '<root>', code: 'NOT_AN_OBJECT' }] };
  }
  const s = candidate as Record<string, unknown>;
  if (s['schemaVersion'] !== TYPE_SCHEMA_VERSION) push('schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION');
  if (typeof s['code'] !== 'string' || !IDENT_RE.test(s['code'])) push('code', 'INVALID_CODE');
  if (typeof s['name'] !== 'string' || s['name'].trim() === '') push('name', 'NAME_REQUIRED');
  if (!(CLASSIFICATIONS as readonly unknown[]).includes(s['defaultClassification'])) {
    push('defaultClassification', 'INVALID_CLASSIFICATION');
  }
  for (const f of ['approvalRequired', 'signatureRequired', 'scanRequired']) {
    if (typeof s[f] !== 'boolean') push(f, 'MUST_BE_BOOLEAN');
  }
  const media = s['allowedMediaTypes'];
  if (!Array.isArray(media) || media.length === 0) {
    push('allowedMediaTypes', 'MEDIA_TYPES_REQUIRED');
  } else {
    media.forEach((m, i) => {
      if (typeof m !== 'string' || !MEDIA_RE.test(m))
        push(`allowedMediaTypes[${String(i)}]`, 'INVALID_MEDIA_TYPE');
    });
  }
  if (s['maxByteSize'] !== undefined) {
    const n = s['maxByteSize'];
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) push('maxByteSize', 'INVALID_MAX_SIZE');
  }
  const meta = s['requiredMetadata'];
  const seen = new Set<string>();
  if (!Array.isArray(meta)) {
    push('requiredMetadata', 'MUST_BE_ARRAY');
  } else {
    meta.forEach((f, i) => {
      if (typeof f !== 'object' || f === null) {
        push(`requiredMetadata[${String(i)}]`, 'INVALID_FIELD');
        return;
      }
      const ff = f as Record<string, unknown>;
      if (typeof ff['name'] !== 'string' || !IDENT_RE.test(ff['name'])) {
        push(`requiredMetadata[${String(i)}].name`, 'INVALID_FIELD_NAME');
      } else if (seen.has(ff['name'])) {
        push(`requiredMetadata[${String(i)}].name`, 'DUPLICATE_FIELD');
      } else {
        seen.add(ff['name']);
      }
      if (!(METADATA_FIELD_TYPES as readonly unknown[]).includes(ff['type'])) {
        push(`requiredMetadata[${String(i)}].type`, 'INVALID_FIELD_TYPE');
      }
      if (ff['type'] === 'enum' && (!Array.isArray(ff['enumValues']) || ff['enumValues'].length === 0)) {
        push(`requiredMetadata[${String(i)}].enumValues`, 'ENUM_VALUES_REQUIRED');
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

export function validateRetentionPolicySpec(candidate: unknown): SpecValidation {
  const errors: SpecError[] = [];
  const push = (p: string, c: string): void => void errors.push({ path: p, code: c });
  if (typeof candidate !== 'object' || candidate === null) {
    return { ok: false, errors: [{ path: '<root>', code: 'NOT_AN_OBJECT' }] };
  }
  const s = candidate as Record<string, unknown>;
  if (s['schemaVersion'] !== RETENTION_SCHEMA_VERSION) push('schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION');
  if (typeof s['code'] !== 'string' || !IDENT_RE.test(s['code'])) push('code', 'INVALID_CODE');
  if (typeof s['name'] !== 'string' || s['name'].trim() === '') push('name', 'NAME_REQUIRED');
  if (
    typeof s['retentionDays'] !== 'number' ||
    !Number.isInteger(s['retentionDays']) ||
    s['retentionDays'] < 0
  ) {
    push('retentionDays', 'INVALID_RETENTION_DAYS');
  }
  if (!(RETENTION_TRIGGERS as readonly unknown[]).includes(s['trigger'])) push('trigger', 'INVALID_TRIGGER');
  if (!(DISPOSITION_ACTIONS as readonly unknown[]).includes(s['dispositionAction']))
    push('dispositionAction', 'INVALID_ACTION');
  if (typeof s['reviewRequired'] !== 'boolean') push('reviewRequired', 'MUST_BE_BOOLEAN');
  return { ok: errors.length === 0, errors };
}
