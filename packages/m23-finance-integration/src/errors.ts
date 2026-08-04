/**
 * M23 error helpers. The kernel has no 400 constructor, so validation errors use the platform's
 * `.../problems/validation` type (mirrors m19/m20/m21/m22). Details never echo secrets, credentials, endpoints or
 * monetary amounts — M23 stores secret REFERENCES only, and carries money as opaque evidence it never transforms.
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
