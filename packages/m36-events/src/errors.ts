/**
 * M36 error helpers. Validation errors use the platform's `.../problems/validation` type. A governance refusal (approving
 * an endpoint that is unvalidated or self-approved, registering a private/insecure URL, subscribing to an unknown event
 * family, delivering through an unavailable runtime, or storing a raw signing secret) is a 403 with a machine-readable
 * reason code — never silent, never a 500. Details never echo a signing secret, an event payload body or an endpoint credential.
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

/** A governance refusal (unvalidated/self-approved endpoint, private/insecure URL, unknown family, unavailable runtime). */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/events-governance',
    title: 'Events Governance',
    status: 403,
    detail: `the events-governance policy refuses this action (${reasonCode}).`,
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

/** A concurrency conflict — the expected version did not match (optimistic lock). */
export function versionConflict(correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/conflict',
    title: 'Conflict',
    status: 409,
    detail: 'the events record was modified concurrently (stale version).',
    correlationId,
  });
}
