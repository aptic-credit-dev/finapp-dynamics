/**
 * M35 error helpers. Validation errors use the platform's `.../problems/validation` type. A governance refusal (an attempt
 * to publish an unvalidated or self-approved product, expose an operation without its permission, publish a public product
 * without the control-plane permission, persist a plaintext credential, subscribe beyond quota, or issue a credential as a
 * non-human) is a 403 with a machine-readable reason code — never silent, never a 500. Details never echo a secret, an API
 * credential, a config value or an external payload.
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

/** A governance refusal (unvalidated/self-approved publish, missing operation permission, plaintext secret, quota denied). */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/devportal-governance',
    title: 'Developer Portal Governance',
    status: 403,
    detail: `the developer-portal governance policy refuses this action (${reasonCode}).`,
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
    detail: 'the developer-portal record was modified concurrently (stale version).',
    correlationId,
  });
}
