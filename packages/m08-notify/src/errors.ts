/**
 * M08 error helpers. The kernel exposes static ProblemError constructors for 401/403/404/409/500 but not 400,
 * so validation errors use the repository's `.../problems/validation` type (mirrors m06/m07 errors.ts). Kept
 * here so services surface a stable, typed 400 for a malformed template/spec or bad request input. Details
 * never echo secrets, destinations, or raw variable values.
 */
import { ProblemError } from '@finapp/kernel';
import type { TemplateError } from './domain/template.ts';
import type { VariableError } from './domain/variables.ts';

export function badRequest(detail: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/validation',
    title: 'Bad Request',
    status: 400,
    detail,
    correlationId,
  });
}

/** A 400 carrying the structured template validation errors (the author sees every problem at once). */
export function invalidTemplate(errors: readonly TemplateError[], correlationId: string): ProblemError {
  const summary = errors
    .slice(0, 5)
    .map((e) => `${e.path || '<root>'}: ${e.code}`)
    .join('; ');
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/validation',
    title: 'Invalid notification template',
    status: 400,
    detail: `The template is invalid (${String(errors.length)} problem(s)): ${summary}`,
    correlationId,
  });
}

/** A 400 carrying the structured variable validation errors. Names only — never the offending values. */
export function invalidVariables(errors: readonly VariableError[], correlationId: string): ProblemError {
  const summary = errors
    .slice(0, 5)
    .map((e) => `${e.name}: ${e.code}`)
    .join('; ');
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/validation',
    title: 'Invalid notification variables',
    status: 400,
    detail: `The supplied variables are invalid (${String(errors.length)} problem(s)): ${summary}`,
    correlationId,
  });
}
