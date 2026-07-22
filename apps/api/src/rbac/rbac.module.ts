import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  AssignmentService,
  BootstrapService,
  CatalogueService,
  RbacEmitter,
  RbacRepository,
  RoleService,
  SodService,
} from '@finapp/m02-rbac';
import { ActorModule } from '../actor/actor.module.ts';
import { RolesController } from './roles.controller.ts';
import { AssignmentsController } from './assignments.controller.ts';
import { SodController } from './sod.controller.ts';
import { CatalogueController } from './catalogue.controller.ts';

/**
 * M02-rbac wiring — roles, assignments, segregation of duties and the permission catalogue, all under
 * `/api/v1/rbac` (D2).
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`, the
 * one place they are bound — `AUTHZ` in particular is `RbacAuthz`, this module's own authorizer, so the
 * services enforce permissions through the same adapter that fills the context. Re-binding any of them here
 * would be a duplicate shared service. `ActorModule` supplies the actor boundary and is imported, not rebuilt.
 *
 * One `RbacEmitter` and one `RbacRepository` are shared by every service, so there is a single audit/outbox
 * path and a single set of queries for the whole module.
 */
@Module({
  imports: [ActorModule],
  controllers: [RolesController, AssignmentsController, SodController, CatalogueController],
  providers: [
    { provide: RbacRepository, useFactory: () => new RbacRepository() },
    {
      provide: RbacEmitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new RbacEmitter(audit, outbox),
    },
    {
      provide: RoleService,
      inject: [DB, AUTHZ, RbacEmitter, RbacRepository],
      useFactory: (db: Db, authz: Authz, emitter: RbacEmitter, repo: RbacRepository) =>
        new RoleService(db, authz, emitter, repo),
    },
    {
      provide: SodService,
      inject: [DB, AUTHZ, RbacEmitter, RbacRepository],
      useFactory: (db: Db, authz: Authz, emitter: RbacEmitter, repo: RbacRepository) =>
        new SodService(db, authz, emitter, repo),
    },
    {
      provide: AssignmentService,
      inject: [DB, AUTHZ, RbacEmitter, SodService, RbacRepository],
      useFactory: (db: Db, authz: Authz, emitter: RbacEmitter, sod: SodService, repo: RbacRepository) =>
        new AssignmentService(db, authz, emitter, sod, repo),
    },
    {
      provide: CatalogueService,
      inject: [DB, AUTHZ, RbacRepository],
      useFactory: (db: Db, authz: Authz, repo: RbacRepository) => new CatalogueService(db, authz, repo),
    },
    {
      // Not a controller — the first-admin bootstrap (ADR-020) is invoked ONCE from main.ts at boot, never
      // from an HTTP route. Exported so the host can resolve and run it.
      provide: BootstrapService,
      inject: [DB, RbacEmitter, RbacRepository],
      useFactory: (db: Db, emitter: RbacEmitter, repo: RbacRepository) =>
        new BootstrapService(db, emitter, repo),
    },
  ],
  exports: [BootstrapService],
})
export class RbacModule {}
