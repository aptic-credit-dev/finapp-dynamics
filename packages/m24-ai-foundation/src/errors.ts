/**
 * M24 error helpers. Validation errors use the platform's `.../problems/validation` type. A governance refusal (DLP
 * block, unapproved-provider routing, autonomous-action attempt, missing citations) is a 403 with a machine-readable
 * reason code — never silent, never a 500. Details never echo prompt/output content, secrets or restricted data.
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

/** A governance refusal (DLP / unapproved provider / autonomous action / missing citations). Fails closed. */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/ai-governance',
    title: 'AI Governance',
    status: 403,
    detail: `the AI governance policy refuses this action (${reasonCode}).`,
    correlationId,
  });
}
