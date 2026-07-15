/**
 * Tenant code, environment code and organisational code validation.
 *
 * These codes are the human-facing, stable identifiers people type into support tickets, reconciliation
 * files and contracts. They are not the primary key — `id` is — so a code can be typo-checked and
 * rejected without threatening referential integrity.
 */

/** Lower snake_case, 3–40 chars, starts with a letter. */
export const TENANT_CODE_PATTERN = /^[a-z][a-z0-9_]{2,39}$/;

/** Shorter, same shape. Used for environments, entities, departments and branches. */
export const ORG_CODE_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

/**
 * Reserved because they collide with route segments, environment names, or read as a placeholder that
 * someone forgot to fill in. A tenant called `admin` or `null` is a support incident waiting to happen.
 */
const RESERVED_TENANT_CODES: readonly string[] = [
  'admin',
  'api',
  'system',
  'platform',
  'internal',
  'public',
  'default',
  'null',
  'undefined',
  'none',
  'test',
  'tenant',
  'tenants',
  'health',
];

export function validateTenantCode(code: string): string | null {
  if (!TENANT_CODE_PATTERN.test(code)) {
    return 'Tenant code must be lower snake_case, start with a letter, and be 3–40 characters.';
  }
  if (RESERVED_TENANT_CODES.includes(code)) {
    return `Tenant code "${code}" is reserved.`;
  }
  return null;
}

export function validateOrgCode(kind: string, code: string): string | null {
  if (!ORG_CODE_PATTERN.test(code)) {
    return `${kind} code must be lower snake_case, start with a letter, and be 2–40 characters.`;
  }
  return null;
}

/** ISO 4217 alpha-3, uppercase. Money is decimal-safe; the currency it is denominated in is not free text. */
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** ISO 3166-1 alpha-2, uppercase. */
export const COUNTRY_PATTERN = /^[A-Z]{2}$/;

/**
 * IANA timezone, e.g. `Africa/Nairobi`. Shape-checked here; resolved against the runtime's tz database
 * by `isKnownTimezone`, which is what actually catches `Africa/Nairobbi`.
 */
export const TIMEZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+$/;

export function isKnownTimezone(tz: string): boolean {
  try {
    // Throws RangeError for an unknown zone. Cheaper and always current versus shipping our own list.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function validateTimezone(tz: string): string | null {
  if (!TIMEZONE_PATTERN.test(tz)) return 'Timezone must be an IANA name such as "Africa/Nairobi".';
  if (!isKnownTimezone(tz)) return `Unknown timezone "${tz}".`;
  return null;
}

export function validateCurrency(currency: string): string | null {
  return CURRENCY_PATTERN.test(currency) ? null : 'Currency must be an ISO 4217 alpha-3 code such as "KES".';
}

export function validateCountry(country: string): string | null {
  return COUNTRY_PATTERN.test(country) ? null : 'Country must be an ISO 3166-1 alpha-2 code such as "KE".';
}
