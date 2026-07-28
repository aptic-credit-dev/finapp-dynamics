import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  LitigationRepository,
  ProceedingService,
  LitigationWorkService,
  CatalogService,
  M16Emitter,
  SystemClock,
} from '@finapp/m16-litigation';
import { ActorModule } from '../actor/actor.module.ts';
import { LitigationCatalogController } from './catalog.controller.ts';
import { ProceedingsController } from './proceedings.controller.ts';
import { LitigationController } from './litigation.controller.ts';

/** DI token for the SLA/deadline/limitation clock port (bound to the real system clock; tests inject a FixedClock). */
export const LITIGATION_CLOCK = Symbol.for('finapp.m16.clock');

/**
 * M16-litigation wiring — the enterprise litigation & adjudicative proceedings platform: configurable proceeding
 * types + SLA policies, the M14 matter referral, proceedings, parties, claims, filings, service of process,
 * appearances + diary, proceeding records, witnesses, experts, exhibits, hearing bundles, orders, compliance
 * obligations, rulings/judgments, appeals, litigation deadlines/limitation, cost references, closure, reopening,
 * relationships and analytics, all under `/api/v1/litigation` (Stage 4.2).
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`; re-binding
 * any here would be a duplicate shared service. m16 owns NO outbox — every litigation.lifecycle event flows
 * through the one `M16Emitter` over the `OUTBOX` that m06 owns. Escalation reuses m08 (via event), workflow m06,
 * rules m07, documents m09; the M14 referral is a GOVERNED INBOUND CONTRACT and idempotent (one proceeding per
 * referral key) — m16 never reads m14's tables. The SLA/deadline `Clock` port is bound to the real `SystemClock`;
 * the DB-integration specs inject a `FixedClock`. Costs store court + finance references only. M17
 * enforcement / M18 knowledge are downstream boundaries reached by safe events only.
 */
@Module({
  imports: [ActorModule],
  controllers: [LitigationCatalogController, ProceedingsController, LitigationController],
  providers: [
    { provide: LitigationRepository, useFactory: () => new LitigationRepository() },
    { provide: LITIGATION_CLOCK, useFactory: () => new SystemClock() },
    {
      provide: M16Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M16Emitter(audit, outbox),
    },
    {
      provide: CatalogService,
      inject: [DB, AUTHZ, M16Emitter, LitigationRepository],
      useFactory: (db: Db, authz: Authz, emitter: M16Emitter, repo: LitigationRepository) =>
        new CatalogService(db, authz, emitter, repo),
    },
    {
      provide: ProceedingService,
      inject: [DB, AUTHZ, M16Emitter, LitigationRepository],
      useFactory: (db: Db, authz: Authz, emitter: M16Emitter, repo: LitigationRepository) =>
        new ProceedingService(db, authz, emitter, repo),
    },
    {
      provide: LitigationWorkService,
      inject: [DB, AUTHZ, M16Emitter, LitigationRepository, LITIGATION_CLOCK],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M16Emitter,
        repo: LitigationRepository,
        clock: SystemClock,
      ) => new LitigationWorkService(db, authz, emitter, repo, clock),
    },
  ],
})
export class LitigationModule {}
