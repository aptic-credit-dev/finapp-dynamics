import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  LegalRepository,
  MatterService,
  MatterWorkService,
  MatterLegalService,
  CatalogService,
  M14Emitter,
  SystemClock,
} from '@finapp/m14-legal';
import { ActorModule } from '../actor/actor.module.ts';
import { LegalCatalogController } from './catalog.controller.ts';
import { MattersController } from './matters.controller.ts';
import { LegalWorkController } from './work.controller.ts';
import { LegalAnalysisController } from './legal.controller.ts';

/** DI token for the SLA/deadline/limitation clock port (bound to the real system clock; tests inject a FixedClock). */
export const LEGAL_CLOCK = Symbol.for('finapp.m14.clock');

/**
 * M14-legal wiring — the enterprise legal-matter platform: configurable matter types + SLA policies +
 * jurisdictions, the M13 case conversion, legal instructions, triage-free intake, the full matter lifecycle,
 * parties, activities, tasks, issues, positions, opinions, pleadings, court diary, deadlines/limitation, external
 * counsel, costs/exposure references, settlement, judgment/outcome, appeal, enforcement references, closure,
 * reopening, relationships and analytics, all under `/api/v1/legal` (Stage 4.1).
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`; re-binding
 * any here would be a duplicate shared service. m14 owns NO outbox — every legal.lifecycle event flows through the
 * one `M14Emitter` over the `OUTBOX` that m06 owns. Escalation reuses m08 (via event), workflow m06, rules m07,
 * documents m09; the M13 conversion is EVENT-driven and idempotent (one matter per case) — m14 never reads m13's
 * tables and needs no callback. The SLA/deadline `Clock` port is bound to the real `SystemClock`; the
 * DB-integration specs inject a `FixedClock`. Costs/exposure/enforcement store finance + court references only.
 */
@Module({
  imports: [ActorModule],
  controllers: [LegalCatalogController, MattersController, LegalWorkController, LegalAnalysisController],
  providers: [
    { provide: LegalRepository, useFactory: () => new LegalRepository() },
    { provide: LEGAL_CLOCK, useFactory: () => new SystemClock() },
    {
      provide: M14Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M14Emitter(audit, outbox),
    },
    {
      provide: CatalogService,
      inject: [DB, AUTHZ, M14Emitter, LegalRepository],
      useFactory: (db: Db, authz: Authz, emitter: M14Emitter, repo: LegalRepository) =>
        new CatalogService(db, authz, emitter, repo),
    },
    {
      provide: MatterService,
      inject: [DB, AUTHZ, M14Emitter, LegalRepository],
      useFactory: (db: Db, authz: Authz, emitter: M14Emitter, repo: LegalRepository) =>
        new MatterService(db, authz, emitter, repo),
    },
    {
      provide: MatterWorkService,
      inject: [DB, AUTHZ, M14Emitter, LegalRepository, LEGAL_CLOCK],
      useFactory: (db: Db, authz: Authz, emitter: M14Emitter, repo: LegalRepository, clock: SystemClock) =>
        new MatterWorkService(db, authz, emitter, repo, clock),
    },
    {
      provide: MatterLegalService,
      inject: [DB, AUTHZ, M14Emitter, LegalRepository, LEGAL_CLOCK],
      useFactory: (db: Db, authz: Authz, emitter: M14Emitter, repo: LegalRepository, clock: SystemClock) =>
        new MatterLegalService(db, authz, emitter, repo, clock),
    },
  ],
})
export class LegalModule {}
