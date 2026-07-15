/**
 * Login-identifier and email normalization — pure, and the most opinionated file in M02.
 *
 * Normalization decides who is the same person. Get it wrong in one direction and two people share an
 * account; wrong in the other and one person cannot be offboarded because they exist twice.
 */

/**
 * Normalizes an email for UNIQUENESS comparison. The original is always stored alongside, untouched.
 *
 * WHAT THIS DOES: trim, lowercase.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: strip dots, or drop `+tags`.
 *
 * Those are Gmail's rules, not the internet's. RFC 5321 says the local part is owned and interpreted by
 * the receiving domain — `a.b@corp.com` and `ab@corp.com` are two different mailboxes at most employers,
 * and folding them would silently merge two colleagues into one account. Applying one provider's folding
 * rules to every domain is a guess, and the failure mode is a person acting as someone else.
 *
 * Lowercasing is itself a compromise: the local part is technically case-sensitive. In practice no real
 * mail system relies on that, and treating `A@x.com` and `a@x.com` as different people causes far more
 * harm than the theoretical case it protects.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Normalizes a username/login identifier for uniqueness comparison.
 *
 * Trim + lowercase only. No unicode folding: confusable-character folding (Cyrillic `а` vs Latin `a`) is
 * a real concern, but folding is the wrong fix — it merges distinct users. Confusables are rejected below
 * instead, which fails closed rather than silently combining accounts.
 */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** RFC-5322-shaped, pragmatically. Deliberately not the full grammar — that regex is a liability. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function validateEmail(email: string): string | null {
  if (email.trim() === '') return 'Email is required.';
  if (email.length > 320) return 'Email must be 320 characters or fewer.';
  if (!EMAIL_PATTERN.test(email.trim())) return 'Email is not a valid address.';
  return null;
}

/** ASCII only, 3–64 chars, starts with a letter. Restrictive on purpose — see normalizeUsername. */
export const USERNAME_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/;

export function validateUsername(username: string): string | null {
  const normalized = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(normalized)) {
    return 'Username must be 3–64 characters, start with a letter, and use only a–z, 0–9, dot, underscore or hyphen.';
  }
  // Rejected rather than folded: a login that renders identically to another is an impersonation vector,
  // and folding them together would merge two real people into one account.
  if (containsNonAscii(username)) {
    return 'Username must be ASCII. Non-ASCII characters can render identically to ASCII ones.';
  }
  return null;
}

function containsNonAscii(value: string): boolean {
  // Anything outside printable ASCII. Rejecting beats folding: folding merges two real people.
  return /[^\x20-\x7E]/.test(value);
}

/**
 * Service and system account names.
 *
 * A separate, stricter namespace with a mandatory prefix so a human login can never be mistaken for a
 * machine one, in a log or in an audit entry.
 */
export const SERVICE_ACCOUNT_PATTERN = /^svc_[a-z][a-z0-9_]{2,60}$/;
export const SYSTEM_ACCOUNT_PATTERN = /^sys_[a-z][a-z0-9_]{2,60}$/;

export function validateServiceAccountName(name: string): string | null {
  return SERVICE_ACCOUNT_PATTERN.test(name)
    ? null
    : 'Service account names must match svc_<lower_snake_case>, 6–64 characters.';
}

export function validateSystemAccountName(name: string): string | null {
  return SYSTEM_ACCOUNT_PATTERN.test(name)
    ? null
    : 'System account names must match sys_<lower_snake_case>, 6–64 characters.';
}

/**
 * E.164 phone — READINESS ONLY (§7).
 *
 * Shape-checked, never verified and never used for identity. Real normalization needs a country policy
 * and a maintained library (`OPEN_QUESTIONS` has no decision on either), and a half-correct phone
 * normalizer that silently mangles a country's numbers is worse than none.
 */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function validatePhoneReadiness(phone: string): string | null {
  return E164_PATTERN.test(phone) ? null : 'Phone must be E.164, e.g. +254712345678.';
}

/**
 * The uniqueness key for an external auth subject: issuer + subject.
 *
 * NOT the subject alone. A subject is only unique within its issuer, so two IdPs can legitimately both
 * issue subject `12345` — keying on the subject alone would let a second IdP's user collide with, and
 * potentially take over, an existing account.
 */
export function authSubjectKey(issuer: string, subject: string): string {
  return `${issuer.trim().toLowerCase()}|${subject.trim()}`;
}

export function validateAuthSubject(input: {
  providerCode: string;
  issuer: string;
  subject: string;
}): string[] {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(input.providerCode)) {
    problems.push('providerCode must be lower snake_case, 2–40 characters.');
  }
  if (input.issuer.trim() === '') problems.push('issuer is required.');
  // The subject is opaque and case-SENSITIVE — never lowercase it. Some IdPs issue base64 subjects where
  // case is meaningful, and folding it would collide two distinct users.
  if (input.subject.trim() === '') problems.push('subject is required.');
  return problems;
}
