import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  EvaluationService,
  M07Emitter,
  RuleSetService,
  RulesRepository,
  TestService,
} from '@finapp/m07-rules';
import { ActorModule } from '../actor/actor.module.ts';
import { RuleSetsController } from './rule-sets.controller.ts';
import { EvaluationsController } from './evaluations.controller.ts';
import { TestsController } from './tests.controller.ts';

/**
 * M07-rules wiring — rule set authoring/lifecycle, evaluation/replay/simulation, and stored tests, all under
 * `/api/v1/rules` (Stage 2.3).
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`, the one
 * place they are bound; re-binding any here would be a duplicate shared service. m07 does NOT own an outbox —
 * every rules.lifecycle event flows through the one `M07Emitter` over the `OUTBOX` that m06 owns. `ActorModule`
 * supplies the actor boundary and is imported, not rebuilt. One `RulesRepository` and one `M07Emitter` are
 * shared by every service, so there is a single audit/outbox path and a single set of queries for the module.
 */
@Module({
  imports: [ActorModule],
  controllers: [RuleSetsController, EvaluationsController, TestsController],
  providers: [
    { provide: RulesRepository, useFactory: () => new RulesRepository() },
    {
      provide: M07Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M07Emitter(audit, outbox),
    },
    {
      provide: RuleSetService,
      inject: [DB, AUTHZ, M07Emitter, RulesRepository],
      useFactory: (db: Db, authz: Authz, emitter: M07Emitter, repo: RulesRepository) =>
        new RuleSetService(db, authz, emitter, repo),
    },
    {
      provide: EvaluationService,
      inject: [DB, AUTHZ, M07Emitter, RulesRepository],
      useFactory: (db: Db, authz: Authz, emitter: M07Emitter, repo: RulesRepository) =>
        new EvaluationService(db, authz, emitter, repo),
    },
    {
      provide: TestService,
      inject: [DB, AUTHZ, M07Emitter, RulesRepository],
      useFactory: (db: Db, authz: Authz, emitter: M07Emitter, repo: RulesRepository) =>
        new TestService(db, authz, emitter, repo),
    },
  ],
})
export class RulesModule {}
