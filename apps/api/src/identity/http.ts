import { ProblemError } from '@finapp/kernel';
import type { ScopedRequest, TenantScopedRequest } from '@finapp/m02-identity';

/**
 * Request-shaping helpers for the identity controllers.
 *
 * The same manual-validation convention m01's controller uses: explicit checks returning `ProblemError`,
 * no validation framework. A pipe would be less code, but the rules here — `expectedVersion` mandatory on
 * every mutation, "clear it" distinguishable from "leave it" — are decisions, and decisions belong where
 * a reviewer reads them.
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

/**
 * Narrows a request to the tenant-scoped case, or refuses.
 *
 * Membership is tenant business and `MembershipService` takes a `RequestContext` — there is no
 * membership without a tenant. The refusal reuses m01's wording verbatim so that "you did not name a
 * tenant" reads identically wherever a caller meets it.
 */
export function requireTenantScope(scoped: ScopedRequest): TenantScopedRequest {
  if (scoped.scope !== 'tenant') {
    throw ProblemError.forbidden(
      'No tenant context. Supply x-tenant-id for a tenant-scoped request.',
      scoped.correlationId,
    );
  }
  return scoped;
}

export function requireString(value: unknown, field: string, correlationId: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${field} is required.`, correlationId);
  }
  return value;
}

export function optionalString<K extends string>(value: unknown, field: K): Partial<Record<K, string>> {
  return typeof value === 'string' ? ({ [field]: value } as Record<K, string>) : {};
}

/**
 * A field that may be set to a value or explicitly cleared.
 *
 * `'field' in body` rather than a truthiness check: `null` means "clear it" and absence means "leave it",
 * and collapsing the two makes a PATCH unable to erase a value it can set.
 */
export function nullableString<K extends string>(
  body: Record<string, unknown>,
  field: K,
): Partial<Record<K, string | null>> {
  if (!(field in body)) return {};
  const value = body[field];
  if (value === null) return { [field]: null } as Record<K, null>;
  return typeof value === 'string' ? ({ [field]: value } as Record<K, string>) : {};
}

/**
 * `expectedVersion` is mandatory on every mutation.
 *
 * Optimistic concurrency only works if the client states what it thinks it is changing. Let it omit the
 * version and the last writer silently wins — which for a lifecycle transition means one administrator's
 * suspension quietly undoing another's.
 */
export function requireVersion(value: unknown, correlationId: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw badRequest('expectedVersion is required and must be a positive integer.', correlationId);
  }
  return value;
}

/** Bounded server-side. An unbounded `limit` is a denial-of-service the caller gets to choose. */
export function optionalLimit(raw: string | undefined, correlationId: string): { limit?: number } {
  if (raw === undefined) return {};
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw badRequest('limit must be a positive integer.', correlationId);
  return { limit: parsed };
}

export function optionalOffset(raw: string | undefined, correlationId: string): { offset?: number } {
  if (raw === undefined) return {};
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw badRequest('offset must be a non-negative integer.', correlationId);
  return { offset: parsed };
}

export interface ActionBody {
  reason?: unknown;
  expectedVersion?: unknown;
}

export function actionOpts(
  body: ActionBody,
  correlationId: string,
): { reason?: string; expectedVersion: number } {
  return {
    expectedVersion: requireVersion(body.expectedVersion, correlationId),
    ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
  };
}
