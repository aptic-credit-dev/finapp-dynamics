/**
 * M30 error helpers. Validation errors use the platform's `.../problems/validation` type. A governance refusal (an
 * attempt to override an absolute control, store a secret value, use a feature as an authorization substitute, or take a
 * platform-scoped action without the control-plane permission) is a 403 with a machine-readable reason code — never
 * silent, never a 500. Details never echo configuration values, secret values or secret references.
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

/** A governance refusal (absolute control, secret value, platform scope, invalid secret reference). */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/platform-governance',
    title: 'Platform Governance',
    status: 403,
    detail: `the platform-governance policy refuses this action (${reasonCode}).`,
    correlationId,
  });
}
