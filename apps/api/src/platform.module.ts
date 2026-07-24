import { Global, Module } from '@nestjs/common';
import pg from 'pg';
import { PgDb } from '@finapp/kernel/pg';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Db } from '@finapp/kernel';
import { RbacAuthz } from '@finapp/m02-rbac';
import { AuditService } from '@finapp/m03-audit';
import { WorkflowOutbox } from '@finapp/m06-workflow';

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
 * STAGE 1D: `AUTHZ` is bound to the persistent `RbacAuthz` (m02-rbac) — `ContextAuthz` and its
 * `x-permissions` input are DELETED. `RbacAuthz` checks `RequestContext.permissions`, which the actor
 * boundary now fills from persistent role assignments (the RBAC `PermissionResolver`), not a header.
 *
 * STAGE 2.1: `AUDIT` is now bound to the persistent `AuditService` (m03-audit) — the in-memory
 * `RecordingAudit` stand-in is retired from production. Every audited action now writes a hash-chained,
 * append-only, tenant-isolated row in the caller's transaction. `RecordingAudit` survives only as a test
 * double. `AUDIT` and the concrete `AuditService` resolve to the SAME instance so the audit module can use
 * the richer recording API without a second implementation.
 *
 * STAGE 2.2: `OUTBOX` is now bound to the persistent `WorkflowOutbox` (m06-workflow) — the ONE durable
 * transactional outbox (ADR-004/023). Every module's domain events now enqueue a row in
 * `workflow_event_outbox` in the caller's transaction; the in-memory `RecordingOutbox` is retired from
 * production and survives only as a test double. Because every caller already invokes `publish(tx, event)`
 * inside its transaction, the swap changed no call site.
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
    {
      provide: AuditService,
      inject: [DB],
      useFactory: (db: Db) => new AuditService(db),
    },
    // AUDIT and the concrete AuditService are the same singleton: modules that only need the port get the
    // port; m03's own query/export/integrity paths get the richer methods.
    { provide: AUDIT, useExisting: AuditService },
    { provide: OUTBOX, useClass: WorkflowOutbox },
  ],
  exports: [DB, AUTHZ, AUDIT, AuditService, OUTBOX],
})
export class PlatformModule {}
