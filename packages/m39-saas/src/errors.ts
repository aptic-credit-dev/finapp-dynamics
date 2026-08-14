/**
 * M39 error helpers. Validation errors use the platform's `.../problems/validation` type. A commercial-governance refusal (a
 * denied access on the RBAC∧entitlement∧flag stack, a self-approved plan publish/override, an over-quota reservation, an
 * override without the control-plane permission, or a plan-immutability violation) is a 403 with a machine-readable reason
 * code — never silent, never a 500. Details never echo a secret, a credential, a full customer payload or personal data.
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

/** A commercial-governance refusal (denied access, self-approval, over-quota, missing control-plane authority, immutability). */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/saas-governance',
    title: 'Commercial SaaS Governance',
    status: 403,
    detail: `the commercial-SaaS policy refuses this action (${reasonCode}).`,
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

/** A concurrency conflict — the expected version did not match (optimistic lock) or a quota row moved under us. */
export function versionConflict(correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/conflict',
    title: 'Conflict',
    status: 409,
    detail: 'the commercial record was modified concurrently (stale version).',
    correlationId,
  });
}
