/**
 * M34 error helpers. Validation errors use the platform's `.../problems/validation` type. A governance refusal (an attempt
 * to publish an unvalidated or self-approved listing, consent as a non-human, store a raw secret value, install a listing
 * whose connector is unavailable, or upgrade without approval) is a 403 with a machine-readable reason code — never
 * silent, never a 500. Details never echo a config value, a secret, or an external payload.
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

/** A governance refusal (unvalidated/self-approved publish, non-human consent, secret value, unavailable connector). */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/marketplace-governance',
    title: 'Marketplace Governance',
    status: 403,
    detail: `the marketplace-governance policy refuses this action (${reasonCode}).`,
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
    detail: 'the marketplace record was modified concurrently (stale version).',
    correlationId,
  });
}
