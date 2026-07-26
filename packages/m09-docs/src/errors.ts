/**
 * M09 error helpers. The kernel has no 400 constructor, so validation errors use the repository's
 * `.../problems/validation` type (mirrors m06/m07/m08). Details never echo raw content, storage credentials,
 * signed URLs, or encryption keys.
 */
import { ProblemError } from '@finapp/kernel';
import type { SpecError } from './domain/doctype.ts';
import type { MetadataError } from './domain/metadata.ts';

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
  errors: readonly SpecError[],
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

export function invalidMetadata(errors: readonly MetadataError[], correlationId: string): ProblemError {
  const summary = errors
    .slice(0, 5)
    .map((e) => `${e.name}: ${e.code}`)
    .join('; ');
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/validation',
    title: 'Invalid document metadata',
    status: 400,
    detail: `The metadata is invalid (${String(errors.length)} problem(s)): ${summary}`,
    correlationId,
  });
}
