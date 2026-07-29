/**
 * M19 error helpers. The kernel has no 400 constructor, so validation errors use the repository's
 * `.../problems/validation` type (mirrors m06/m07/m08/m09/m12/m13/m14/m16/m17/m18). Details never echo monetary
 * amounts, balances or secrets — finance foundation carries reference/config data only.
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
