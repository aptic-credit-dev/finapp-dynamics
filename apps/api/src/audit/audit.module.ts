import { Module } from '@nestjs/common';
import { AUTHZ, DB } from '@finapp/kernel';
import type { Authz, Db } from '@finapp/kernel';
import { AuditQueryService, AuditRepository, AuditService } from '@finapp/m03-audit';
import { ActorModule } from '../actor/actor.module.ts';
import { AuditController } from './audit.controller.ts';

/**
 * M03-audit READ side — the investigation API under `/api/v1/audit`.
 *
 * The WRITE side (the `AUDIT` port → `AuditService`) is bound once in the global `PlatformModule`; this
 * module binds only the authorized query/export/integrity surface. It reuses that same `AuditService`
 * singleton (exported by PlatformModule) so exports and integrity checks are recorded through the one audit
 * path, and imports `ActorModule` for the actor boundary. It binds no kernel token.
 */
@Module({
  imports: [ActorModule],
  controllers: [AuditController],
  providers: [
    { provide: AuditRepository, useFactory: () => new AuditRepository() },
    {
      provide: AuditQueryService,
      inject: [DB, AUTHZ, AuditService, AuditRepository],
      useFactory: (db: Db, authz: Authz, audit: AuditService, repo: AuditRepository) =>
        new AuditQueryService(db, authz, audit, repo),
    },
  ],
})
export class AuditModule {}
