/**
 * M33 error helpers. Validation errors use the platform's `.../problems/validation` type. A governance refusal (an attempt
 * to publish an unvalidated or self-approved connector, store a raw secret VALUE instead of a reference, execute a
 * production/unavailable connector runtime, or use an unregistered capability) is a 403 with a machine-readable reason code
 * — never silent, never a 500. Details never echo a connection config value, a secret, or an external payload.
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

/** A governance refusal (unvalidated/self-approved publish, secret value, unavailable runtime, unregistered capability). */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/integration-governance',
    title: 'Integration Governance',
    status: 403,
    detail: `the integration-governance policy refuses this action (${reasonCode}).`,
    correlationId,
  });
}

/** A concurrency conflict — the expected version did not match (optimistic lock). */
export function versionConflict(correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/conflict',
    title: 'Conflict',
    status: 409,
    detail: 'the integration record was modified concurrently (stale version).',
    correlationId,
  });
}
