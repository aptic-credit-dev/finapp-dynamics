/**
 * M38 error helpers. Validation errors use the platform's `.../problems/validation` type. A governance refusal (activating an
 * automation that is unvalidated or self-approved, a step without its required permission, an invalid/too-frequent
 * recurrence, an unavailable capability, or a raw secret value) is a 403 with a machine-readable reason code — never silent,
 * never a 500. Details never echo a secret, executable content or a full downstream payload.
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

/** A governance refusal (unvalidated/self-approved activation, missing permission, invalid recurrence, unavailable capability). */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/automation-governance',
    title: 'Automation Governance',
    status: 403,
    detail: `the automation-governance policy refuses this action (${reasonCode}).`,
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
    detail: 'the automation record was modified concurrently (stale version).',
    correlationId,
  });
}
