/**
 * M41 error helpers. Validation errors use the platform's `.../problems/validation` type. A security-governance refusal (a
 * denied posture on the RBAC∧security stack, a self-approved secret rotate/revoke/destroy/reveal, an unavailable secret/crypto
 * provider, a DLP block, or a cross-tenant secret access) is a 403 with a machine-readable reason code — never silent, never a
 * 500. Details NEVER echo a secret value, ciphertext, a token, a credential or raw restricted content.
 */
import { ProblemError } from '@finapp/kernel';

export function badRequest(detail: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/validation',
    title: 'Bad Request',
    status: 400,
    detail,
    correlationId,
  });
}

/** A security-governance refusal (denied posture, self-approval, unavailable provider, DLP block, cross-tenant access). */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/security-governance',
    title: 'Security Governance',
    status: 403,
    detail: `the security policy refuses this action (${reasonCode}).`,
    correlationId,
  });
}

/** A missing record — a cross-tenant reference resolves to nothing under RLS. */
export function notFound(detail: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/not-found',
    title: 'Not Found',
    status: 404,
    detail,
    correlationId,
  });
}

/** A concurrency conflict — the expected version did not match (optimistic lock) or a rotation lost the race. */
export function versionConflict(correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/conflict',
    title: 'Conflict',
    status: 409,
    detail: 'the security record was modified concurrently (stale version).',
    correlationId,
  });
}
