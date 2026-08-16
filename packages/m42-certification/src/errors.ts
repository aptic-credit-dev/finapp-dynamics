/**
 * M42 error helpers. Validation is 400; a certification-governance refusal (self-approval/self-certification, a non-human
 * certifier, an attempt to waive an absolute control, an attempt to set GO directly, or a decision issued while blockers remain)
 * is a 403 with a machine-readable reason code — never silent, never a 500. A cross-tenant reference resolves to 404 (no
 * disclosure). Details carry ids/reason codes only — never a secret, credential or raw evidence body.
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

/** A certification-governance refusal (self-approval/self-certification, non-human actor, absolute-waiver, blockers remain). */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/certification-governance',
    title: 'Certification Governance',
    status: 403,
    detail: `the certification policy refuses this action (${reasonCode}).`,
    correlationId,
  });
}

export function notFound(detail: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/not-found',
    title: 'Not Found',
    status: 404,
    detail,
    correlationId,
  });
}

export function versionConflict(correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/conflict',
    title: 'Conflict',
    status: 409,
    detail: 'the certification record was modified concurrently (stale version).',
    correlationId,
  });
}
