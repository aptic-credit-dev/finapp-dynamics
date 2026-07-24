import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  DefinitionService,
  IncidentService,
  InstanceService,
  M06Emitter,
  SlaService,
  TaskService,
  WorkflowRepository,
} from '@finapp/m06-workflow';
import { ActorModule } from '../actor/actor.module.ts';
import { DefinitionsController } from './definitions.controller.ts';
import { InstancesController } from './instances.controller.ts';
import { TasksController } from './tasks.controller.ts';
import { IncidentsController } from './incidents.controller.ts';

/**
 * M06-workflow wiring — definitions, instances, human tasks and incidents, all under `/api/v1/workflow` (D2).
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`, the one
 * place they are bound; re-binding any here would be a duplicate shared service. m06 OWNS the single
 * transactional outbox, so every domain event flows through the one `M06Emitter` over that `OUTBOX`.
 * `ActorModule` supplies the actor boundary and is imported, not rebuilt.
 *
 * One `WorkflowRepository` and one `M06Emitter` are shared by every service, so there is a single audit/outbox
 * path and a single set of queries for the whole module.
 */
@Module({
  imports: [ActorModule],
  controllers: [DefinitionsController, InstancesController, TasksController, IncidentsController],
  providers: [
    { provide: WorkflowRepository, useFactory: () => new WorkflowRepository() },
    {
      provide: M06Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M06Emitter(audit, outbox),
    },
    {
      provide: SlaService,
      inject: [DB, M06Emitter, WorkflowRepository],
      useFactory: (db: Db, emitter: M06Emitter, repo: WorkflowRepository) =>
        new SlaService(db, emitter, repo),
    },
    {
      provide: DefinitionService,
      inject: [DB, AUTHZ, M06Emitter, WorkflowRepository],
      useFactory: (db: Db, authz: Authz, emitter: M06Emitter, repo: WorkflowRepository) =>
        new DefinitionService(db, authz, emitter, repo),
    },
    {
      provide: InstanceService,
      inject: [DB, AUTHZ, M06Emitter, WorkflowRepository, SlaService],
      useFactory: (db: Db, authz: Authz, emitter: M06Emitter, repo: WorkflowRepository, sla: SlaService) =>
        new InstanceService(db, authz, emitter, repo, sla),
    },
    {
      provide: TaskService,
      inject: [DB, AUTHZ, M06Emitter, InstanceService, WorkflowRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M06Emitter,
        instances: InstanceService,
        repo: WorkflowRepository,
      ) => new TaskService(db, authz, emitter, instances, repo),
    },
    {
      provide: IncidentService,
      inject: [DB, AUTHZ, M06Emitter, InstanceService, WorkflowRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M06Emitter,
        instances: InstanceService,
        repo: WorkflowRepository,
      ) => new IncidentService(db, authz, emitter, instances, repo),
    },
  ],
})
export class WorkflowModule {}
