/**
 * M07 error helpers. The kernel exposes static ProblemError constructors for 401/403/404/409/500 but not
 * 400, so validation errors use the repository's `.../problems/validation` type (mirrors m06's errors.ts).
 * Kept here so services surface a stable, typed 400 for a malformed spec or bad evaluation input.
 */
import { ProblemError } from '@finapp/kernel';
import type { RuleSetError } from './domain/ruleset.ts';

export function badRequest(detail: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/validation',
    title: 'Bad Request',
    status: 400,
    detail,
    correlationId,
  });
}

/** A 400 that carries the structured rule-set validation errors (the author sees every problem at once). */
export function invalidRuleSet(errors: readonly RuleSetError[], correlationId: string): ProblemError {
  const summary = errors
    .slice(0, 5)
    .map((e) => `${e.path || '<root>'}: ${e.code}`)
    .join('; ');
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/validation',
    title: 'Invalid rule set',
    status: 400,
    detail: `The rule set is invalid (${String(errors.length)} problem(s)): ${summary}`,
    correlationId,
  });
}
