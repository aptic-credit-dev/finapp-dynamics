/**
 * Stage-7 migration MAPPING specification — deterministic, versioned, checksummed. Provider-neutral. Money is
 * integer MINOR UNITS (no float). Transforms are a FIXED allowlist (no eval / no arbitrary code).
 */
import { createHash } from 'node:crypto';

const TRANSFORMS = {
  none: (v) => v,
  trim: (v) => (typeof v === 'string' ? v.trim() : v),
  lower: (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
};

/** The authoritative, versioned source→destination mapping (synthetic staging landing tables). */
export const MAPPING = {
  version: '1.0.0',
  entities: [
    {
      key: 'tenant',
      source: 'tenants',
      dest: 'mig_tenant',
      naturalKey: ['tenant_code'],
      fields: [
        { src: 'code', dst: 'tenant_code', required: true, transform: 'trim', validate: 'ident_like' },
        { src: 'legalName', dst: 'legal_name', required: true, transform: 'trim' },
      ],
      control: 'tenant_count',
    },
    {
      key: 'identity',
      source: 'identities',
      dest: 'mig_identity',
      naturalKey: ['tenant_code', 'email_norm'],
      fields: [
        { src: 'tenantCode', dst: 'tenant_code', required: true, transform: 'trim' },
        { src: 'email', dst: 'email_norm', required: true, transform: 'lower', validate: 'email' },
        { src: 'name', dst: 'display_name', required: true, transform: 'trim' },
      ],
      control: 'identity_count',
    },
    {
      key: 'ledger',
      source: 'ledger',
      dest: 'mig_ledger',
      naturalKey: ['tenant_code', 'source_id'],
      fields: [
        { src: 'tenantCode', dst: 'tenant_code', required: true, transform: 'trim' },
        { src: 'account', dst: 'account', required: true, transform: 'trim' },
        { src: 'amountMinor', dst: 'amount_minor', required: true, validate: 'integer' },
        { src: 'currency', dst: 'currency', required: true, transform: 'trim', validate: 'currency' },
      ],
      control: 'ledger_minor_total',
    },
  ],
};

export function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stable(v[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(v);
}

export function mappingChecksum(m = MAPPING) {
  return createHash('sha256').update(stable(m)).digest('hex');
}

const VALIDATORS = {
  ident_like: (v) => typeof v === 'string' && /^[a-z][a-z0-9_]{2,39}$/.test(v),
  email: (v) => typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
  integer: (v) => Number.isInteger(v),
  currency: (v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v),
  none: () => true,
};

/** Validate the mapping shape itself — only known transforms/validators, valid dest identifiers. */
export function validateMapping(m = MAPPING) {
  const errs = [];
  if (!m.version) errs.push('missing version');
  for (const e of m.entities ?? []) {
    if (!/^[a-z_][a-z0-9_]*$/.test(e.dest)) errs.push(`unsafe dest table: ${e.dest}`);
    for (const f of e.fields) {
      if (!/^[a-z_][a-z0-9_]*$/.test(f.dst)) errs.push(`unsafe dest column: ${f.dst}`);
      if (f.transform && !(f.transform in TRANSFORMS)) errs.push(`unknown transform: ${f.transform}`);
      if (f.validate && !(f.validate in VALIDATORS)) errs.push(`unknown validator: ${f.validate}`);
    }
  }
  return errs;
}

/** Transform + validate ONE source record for an entity. Returns {ok, row} or {ok:false, reason}. */
export function transformRecord(entity, srcRecord) {
  const row = {};
  for (const f of entity.fields) {
    const raw = srcRecord[f.src];
    const val = TRANSFORMS[f.transform ?? 'none'](raw);
    if (f.required && (val === undefined || val === null || val === '')) {
      return { ok: false, reason: `missing_required:${f.dst}` };
    }
    if (f.validate && val !== undefined && val !== null && !VALIDATORS[f.validate](val)) {
      return { ok: false, reason: `invalid:${f.dst}` };
    }
    row[f.dst] = val;
  }
  return { ok: true, row };
}
