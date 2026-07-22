import type { Db } from '@finapp/kernel';
import { RbacRepository } from './repository.ts';

/**
 * Resolves an actor's EFFECTIVE permissions from persistent role assignments — the authoritative source
 * that replaces the `x-permissions` header. Called once per request by the API's actor boundary; the result
 * is placed on `RequestContext.permissions`, so the client never supplies authority and nothing is cached
 * across requests (immediate revocation).
 *
 * Platform-role permissions are read in SYSTEM context (global plane); tenant-role permissions are read IN
 * THE ACTOR'S TENANT context, so RLS proves a tenant only ever contributes its own assignments — an
 * assignment in tenant A can never leak permissions into tenant B.
 */
export class PermissionResolver {
  private readonly db: Db;
  private readonly repo: RbacRepository;

  constructor(db: Db, repo: RbacRepository = new RbacRepository()) {
    this.db = db;
    this.repo = repo;
  }

  async resolve(input: {
    identityId: string;
    tenantId?: string | undefined;
    correlationId: string;
  }): Promise<string[]> {
    const now = new Date();
    const platform = await this.db.withSystem(
      { reason: 'resolve platform permissions (m02-rbac)', correlationId: input.correlationId },
      (tx) => this.repo.resolvePlatformPermissions(tx, input.identityId, now),
    );
    if (input.tenantId === undefined) return [...new Set(platform)];

    const tenant = await this.db.withTenant(
      {
        tenantId: input.tenantId,
        userId: input.identityId,
        correlationId: input.correlationId,
        permissions: [],
      },
      (tx) => this.repo.resolveTenantPermissions(tx, input.identityId, now),
    );
    return [...new Set([...platform, ...tenant])];
  }
}
