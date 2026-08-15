/**
 * M40 error helpers. Validation errors use the platform's `.../problems/validation` type. A resilience-governance refusal (an
 * offline finalization of a controlled action, a self-approved restore/failover, a restore without the approval permission, a
 * blocked backup/restore executor, or a stale/expired offline request) is a 403 with a machine-readable reason code — never
 * silent, never a 500. Details never echo a secret, a credential, raw backup data or a full offline payload.
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

/** A resilience-governance refusal (offline finalization, self-approval, blocked executor, stale/expired request). */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/resilience-governance',
    title: 'Resilience Governance',
    status: 403,
    detail: `the resilience policy refuses this action (${reasonCode}).`,
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
    detail: 'the resilience record was modified concurrently (stale version).',
    correlationId,
  });
}
