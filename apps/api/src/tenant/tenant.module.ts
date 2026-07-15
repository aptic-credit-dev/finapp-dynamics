import { Module } from '@nestjs/common';
import pg from 'pg';
import { PgDb } from '@finapp/kernel/pg';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  ContextAuthz,
  OrgService,
  RecordingAudit,
  RecordingOutbox,
  TenantContextResolver,
  TenantService,
} from '@finapp/m01-tenant';
import { TenantController } from './tenant.controller.ts';

/**
 * M01 wiring.
 *
 * This is where the kernel's four tokens finally get providers. Stage 0 left them deliberately unbound;
 * Stage 1A binds `DB` for real and binds `AUTHZ`/`AUDIT`/`OUTBOX` to the clearly-marked stand-ins in
 * `@finapp/m01-tenant` (see adapters.ts).
 *
 * TEMPORARY: those three bindings must be replaced by their owning modules — AUTHZ by m02-identity,
 * AUDIT by m03-audit, OUTBOX by m06-workflow. Leaving a stand-in bound once its owner exists would be
 * the duplicate shared service CLAUDE.md warns about.
 */
@Module({
  controllers: [TenantController],
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
    { provide: AUTHZ, useClass: ContextAuthz },
    { provide: AUDIT, useClass: RecordingAudit },
    { provide: OUTBOX, useClass: RecordingOutbox },
    {
      provide: TenantService,
      inject: [DB, AUTHZ, AUDIT, OUTBOX],
      useFactory: (db: Db, authz: Authz, audit: Audit, outbox: Outbox<DomainEvent>) =>
        new TenantService(db, authz, audit, outbox),
    },
    {
      provide: OrgService,
      inject: [DB, AUTHZ, AUDIT, OUTBOX],
      useFactory: (db: Db, authz: Authz, audit: Audit, outbox: Outbox<DomainEvent>) =>
        new OrgService(db, authz, audit, outbox),
    },
    {
      provide: TenantContextResolver,
      inject: [DB],
      useFactory: (db: Db) => new TenantContextResolver(db),
    },
  ],
})
export class TenantModule {}
