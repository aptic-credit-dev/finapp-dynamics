/**
 * M26 error helpers. Validation errors use the platform's `.../problems/validation` type. A governance refusal (an
 * attempt to act without a human legal decision, on a non-approved AI output, without required citations, or across the
 * ethical wall) is a 403 with a machine-readable reason code — never silent, never a 500. Details never echo legal
 * text, privileged narrative, document content or AI output.
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

/** A governance refusal (autonomous action / advisory-only / AI output not approved / missing citations / ethical wall). */
export function governanceForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/ai-governance',
    title: 'AI Governance',
    status: 403,
    detail: `the legal-AI governance policy refuses this action (${reasonCode}).`,
    correlationId,
  });
}
