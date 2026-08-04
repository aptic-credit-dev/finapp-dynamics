/**
 * M04 error helpers. Validation errors use the platform's `.../problems/validation` type (mirrors m19/m20/m21/m22/m23).
 * A platform-vs-tenant scope violation is a 403 with a machine-readable reason code — never silent, never a 500.
 * Details never echo passwords, tokens, secret references, contact data or confidential narratives.
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

/** A platform-vs-tenant boundary violation (e.g. a tenant admin attempting a platform operation). Fails closed. */
export function scopeForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/admin-scope',
    title: 'Forbidden',
    status: 403,
    detail: `the caller's scope does not permit this admin action (${reasonCode}).`,
    correlationId,
  });
}
