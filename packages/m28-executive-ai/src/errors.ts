/**
 * M28 error helpers. Validation errors use the platform's `.../problems/validation` type. A governance refusal (an
 * attempt to make the copilot act, a prompt-injection/exfiltration attempt, or a request for data the caller cannot
 * see) is a 403 with a machine-readable reason code — never silent, never a 500. Details never echo the question text,
 * the answer, restricted content or a privileged narrative.
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

/** A governance refusal (read-only violation, prompt injection, not-entitled, sensitive without permission). */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/ai-governance',
    title: 'AI Governance',
    status: 403,
    detail: `the executive-copilot governance policy refuses this request (${reasonCode}).`,
    correlationId,
  });
}
