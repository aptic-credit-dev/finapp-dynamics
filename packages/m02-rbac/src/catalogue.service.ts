import type { Db } from '@finapp/kernel';
import { RbacRepository } from './repository.ts';

/** Read-only view of the governed permission catalogue (GET /rbac/permissions). */
export class CatalogueService {
  private readonly db: Db;
  private readonly repo: RbacRepository;
  constructor(db: Db, repo: RbacRepository = new RbacRepository()) {
    this.db = db;
    this.repo = repo;
  }
  async listPermissions(ctx: { correlationId: string }): Promise<
    { code: string; module: string; resource_type: string; risk: string; privileged: boolean; tenant_assignable: boolean; deprecated: boolean }[]
  > {
    return this.db.withSystem({ reason: 'list permission catalogue (m02-rbac)', correlationId: ctx.correlationId }, (tx) =>
      this.repo.listPermissions(tx),
    );
  }
}
