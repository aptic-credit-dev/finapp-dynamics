import { Global, Module } from '@nestjs/common';
import pg from 'pg';
import { PgDb } from '@finapp/kernel/pg';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Db } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';

/**
 * THE shared-service bindings. One provider per kernel token, for the whole process.
 *
 * WHY THIS MODULE EXISTS. Stage 1A bound `DB`/`AUTHZ`/`AUDIT`/`OUTBOX` inside `TenantModule`, which was
 * correct while m01 was the only module. Stage 1B adds a second feature module, and a second module
 * binding the same tokens would produce a second `pg.Pool` and a second `ContextAuthz` — two
 * implementations of a shared service, which CLAUDE.md names as the most common failure mode. It would
 * also be nearly invisible: everything would work, on twice the connections, with two audit buffers that
 * each hold half the story.
 *
 * `@Global` so a feature module gets these without importing anything. The tokens are the contract; where
 * they are bound is not a decision any consumer should have to make, or be able to differ on.
 *
 * STAGE 1D: `AUTHZ` is now bound to the persistent `RbacAuthz` (m02-rbac) — `ContextAuthz` and its
 * `x-permissions` input are DELETED. `RbacAuthz` checks `RequestContext.permissions`, which the actor
 * boundary now fills from persistent role assignments (the RBAC `PermissionResolver`), not a header.
 *   AUDIT  -> m03-audit (stand-in; in-memory).
 *   OUTBOX -> m06-workflow (stand-in; in-memory).
 */
@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Db => {
        const connectionString = process.env['DATABASE_URL'];
        if (connectionString === undefined || connectionString === '') {
          // Fail at boot rather than at the first query: a server that starts without a database only
          // discovers it when a user does.
          throw new Error('DATABASE_URL is not set. The API cannot start without a database.');
        }
        const pool = new pg.Pool({ connectionString });
        const appRole = process.env['DATABASE_APP_ROLE'];
        // Binding the app role here is what stops the API inheriting the migration user's privileges.
        // Without it, a deployment that connects as the owner silently loses FORCE-RLS protection.
        return new PgDb({ pool, ...(appRole === undefined ? {} : { appRole }) });
      },
    },
    { provide: AUTHZ, useClass: RbacAuthz },
    { provide: AUDIT, useClass: RecordingAudit },
    { provide: OUTBOX, useClass: RecordingOutbox },
  ],
  exports: [DB, AUTHZ, AUDIT, OUTBOX],
})
export class PlatformModule {}
