/**
 * M22 error helpers. The kernel has no 400 constructor, so validation errors use the platform's
 * `.../problems/validation` type (mirrors m06/m07/m19/m20/m21). A SoD block is a 403 with a machine-readable reason
 * code — never a 500, and never silent. Details never echo subject narratives, monetary amounts or secrets.
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

/** A Segregation-of-Duties block. Fails closed with a clear reason (CLAUDE.md safety default). */
export function sodForbidden(reasonCode: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/segregation-of-duties',
    title: 'Segregation of Duties',
    status: 403,
    detail: `the actor may not act as checker on this request (${reasonCode}).`,
    correlationId,
  });
}
