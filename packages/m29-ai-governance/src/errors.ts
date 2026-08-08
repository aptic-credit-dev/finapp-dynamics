/**
 * M29 error helpers. Validation errors use the platform's `.../problems/validation` type. A governance refusal (an
 * attempt at AI self-approval, self-approval by the proposer, approval without a passing evaluation, a policy violation,
 * or waiving an absolute control) is a 403 with a machine-readable reason code — never silent, never a 500. Details
 * never echo prompts, outputs, restricted content or secrets.
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

/** A governance refusal (AI/self approval, missing evaluation, policy violation, non-waivable absolute control). */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/ai-governance',
    title: 'AI Governance',
    status: 403,
    detail: `the AI-governance policy refuses this action (${reasonCode}).`,
    correlationId,
  });
}
