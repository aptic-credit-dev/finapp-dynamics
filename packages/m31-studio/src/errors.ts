/**
 * M31 error helpers. Validation errors use the platform's `.../problems/validation` type. A governance refusal (an
 * attempt to publish a design that failed validation, self-approve a design, bind to an unavailable capability, store a
 * secret VALUE or use a prohibited execution expression) is a 403 with a machine-readable reason code — never silent,
 * never a 500. Details never echo a design spec, a form field, a configuration value or a secret.
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

/** A governance refusal (failed validation, self-approval/SoD, unavailable capability, secret value, prohibited expr). */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/studio-governance',
    title: 'Studio Governance',
    status: 403,
    detail: `the studio-governance policy refuses this action (${reasonCode}).`,
    correlationId,
  });
}

/** A concurrency conflict — the expected version did not match (optimistic lock). */
export function versionConflict(correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/conflict',
    title: 'Conflict',
    status: 409,
    detail: 'the artifact was modified concurrently (stale version).',
    correlationId,
  });
}
