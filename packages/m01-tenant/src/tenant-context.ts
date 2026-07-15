import { ProblemError, type Db, type RequestContext } from '@finapp/kernel';
import { TenantRepository } from './repository.ts';
import { allowsBusinessReads } from './domain/tenant-status.ts';

/**
 * Server-side tenant resolution — the authoritative answer to "which tenant is this request for?".
 *
 * THE RULE (M01 §3.5): a tenant id supplied by the client is a CLAIM, never a fact. This resolver takes
 * the claim, verifies the tenant exists and its status permits the operation, and only then mints a
 * `RequestContext`. Nothing else in the platform is allowed to construct tenant context from a header.
 *
 * WHAT IS DELIBERATELY MISSING UNTIL m02-identity:
 *   The claim is verified to be a REAL, USABLE tenant — but not that THIS CALLER is entitled to it.
 *   That check needs an authenticated actor and their tenant membership, which is m02's job. Until then
 *   the header is trusted for *identity of tenant*, and the platform is not multi-actor-safe: anyone who
 *   can reach the API can name any tenant. This is why M01 alone is not shippable, and it is stated
 *   plainly in the completion report rather than hidden behind a resolver that looks finished.
 */
export class TenantContextResolver {
  // Explicit fields, not parameter properties — strip-types cannot compile those.
  private readonly db: Db;
  private readonly repo: TenantRepository;

  constructor(db: Db, repo: TenantRepository = new TenantRepository()) {
    this.db = db;
    this.repo = repo;
  }

  /**
   * Resolves and validates a claimed tenant id.
   *
   * Fails closed at every step: no claim, malformed claim, unknown tenant, or a status that forbids the
   * operation all end in a refusal with a stated reason.
   */
  async resolve(input: {
    claimedTenantId: string | undefined;
    correlationId: string;
    permissions: readonly string[];
    actor?: string | undefined;
  }): Promise<RequestContext> {
    const claimed = input.claimedTenantId;
    if (claimed === undefined || claimed.trim() === '') {
      throw ProblemError.forbidden(
        'No tenant context. Supply x-tenant-id for a tenant-scoped request.',
        input.correlationId,
      );
    }
    if (!UUID_PATTERN.test(claimed)) {
      // Rejected before it reaches SQL. `NULLIF(...)::uuid` in every policy would raise on a malformed
      // value, turning a bad header into a 500 that looks like a server fault.
      throw ProblemError.forbidden('Invalid tenant identifier.', input.correlationId);
    }

    // The lookup runs in system context because we cannot enter the tenant's own context to find out
    // whether that tenant exists — that is circular. This is the narrowest possible use of the escape:
    // one row, by primary key, to answer exactly "is this a real tenant, and may it be used".
    const tenant = await this.db.withSystem(
      { reason: 'tenant context resolution (m01)', correlationId: input.correlationId },
      (tx) => this.repo.findById(tx, claimed),
    );

    // Same message and status for "does not exist" and "not usable": a caller probing tenant ids must not
    // be able to tell a real tenant from an imaginary one.
    if (tenant === null) {
      throw ProblemError.forbidden('Unknown or inaccessible tenant.', input.correlationId);
    }
    if (!allowsBusinessReads(tenant.status)) {
      throw ProblemError.forbidden('Unknown or inaccessible tenant.', input.correlationId);
    }

    return {
      tenantId: tenant.id,
      correlationId: input.correlationId,
      permissions: input.permissions,
      ...(input.actor === undefined ? {} : { userId: input.actor }),
    };
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export { UUID_PATTERN };
