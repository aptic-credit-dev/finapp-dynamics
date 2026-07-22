import type { Authz, Db, RequestContext, SystemContext } from '@finapp/kernel';
import { RbacRepository } from './repository.ts';
import { RBAC_PERMISSIONS } from './permissions.ts';

/** The caller's proven context — tenant or platform — always carrying its resolved permissions. */
type AuthorizedContext = RequestContext | (SystemContext & { readonly permissions: readonly string[] });

/** Read-only view of the governed permission catalogue (GET /rbac/permissions). */
export class CatalogueService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly repo: RbacRepository;
  constructor(db: Db, authz: Authz, repo: RbacRepository = new RbacRepository()) {
    this.db = db;
    this.authz = authz;
    this.repo = repo;
  }
  async listPermissions(ctx: AuthorizedContext): Promise<
    {
      code: string;
      module: string;
      resource_type: string;
      risk: string;
      privileged: boolean;
      tenant_assignable: boolean;
      deprecated: boolean;
    }[]
  > {
    await this.authz.require(ctx, RBAC_PERMISSIONS.permissionView);
    return this.db.withSystem(
      { reason: 'list permission catalogue (m02-rbac)', correlationId: ctx.correlationId },
      (tx) => this.repo.listPermissions(tx),
    );
  }
}
