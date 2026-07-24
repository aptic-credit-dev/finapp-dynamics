import { ProblemError } from '@finapp/kernel';
import type { DefinitionError } from './domain/definition.ts';

/**
 * 400 helper — the kernel exposes static constructors for 401/403/404/409/500 but not 400, so validation
 * errors use the repository's `.../problems/validation` type (mirrors apps/api/src/identity/http.ts and
 * m02-rbac's sod.service badRequest). Kept here so services surface a stable, typed 400.
 */
export function badRequest(detail: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/validation',
    title: 'Bad Request',
    status: 400,
    detail,
    correlationId,
  });
}

/** A 400 that carries the structured definition-validation errors (the author sees every problem). */
export function invalidDefinition(errors: readonly DefinitionError[], correlationId: string): ProblemError {
  const summary = errors
    .slice(0, 5)
    .map((e) => `${e.path || '<root>'}: ${e.code}`)
    .join('; ');
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/validation',
    title: 'Invalid workflow definition',
    status: 400,
    detail: `The definition is invalid (${String(errors.length)} problem(s)): ${summary}`,
    correlationId,
  });
}
