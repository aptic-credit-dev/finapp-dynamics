/**
 * M25 error helpers. Validation errors use the platform's `.../problems/validation` type. A governance refusal (an
 * attempt to act without a human decision, or on a non-approved AI output) is a 403 with a machine-readable reason code
 * — never silent, never a 500. Details never echo feedback/case narrative, customer contact or AI content.
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

/** A governance refusal (autonomous action / recommends-only / AI output not human-approved). Fails closed. */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/ai-governance',
    title: 'AI Governance',
    status: 403,
    detail: `the operational-AI governance policy refuses this action (${reasonCode}).`,
    correlationId,
  });
}
