/**
 * M32 error helpers. Validation errors use the platform's `.../problems/validation` type. A governance refusal (an
 * attempt to run an unsupported/unsafe query, publish an unvalidated or self-approved metric/report, read/export a
 * metric the caller is not entitled to, or export across a tenant boundary) is a 403 with a machine-readable reason code
 * — never silent, never a 500. Details never echo a metric value, a report body, source data or a secret.
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

/** A governance refusal (unsafe query, unvalidated/self-approved publish, missing entitlement, cross-tenant export). */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/analytics-governance',
    title: 'Analytics Governance',
    status: 403,
    detail: `the analytics-governance policy refuses this action (${reasonCode}).`,
    correlationId,
  });
}

/** A concurrency conflict — the expected version did not match (optimistic lock). */
export function versionConflict(correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/conflict',
    title: 'Conflict',
    status: 409,
    detail: 'the analytics definition was modified concurrently (stale version).',
    correlationId,
  });
}
