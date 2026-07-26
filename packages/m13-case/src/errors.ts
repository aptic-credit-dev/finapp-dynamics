/**
 * M13 error helpers. The kernel has no 400 constructor, so validation errors use the repository's
 * `.../problems/validation` type (mirrors m06/m07/m08/m09/m12). Details never echo privileged notes, private
 * party contacts, correspondence bodies, or confidential settlement terms.
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

export function invalidSpec(
  title: string,
  errors: readonly { path: string; code: string }[],
  correlationId: string,
): ProblemError {
  const summary = errors
    .slice(0, 5)
    .map((e) => `${e.path || '<root>'}: ${e.code}`)
    .join('; ');
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/validation',
    title,
    status: 400,
    detail: `${title} (${String(errors.length)} problem(s)): ${summary}`,
    correlationId,
  });
}
