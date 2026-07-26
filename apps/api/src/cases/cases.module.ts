import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  CaseRepository,
  CaseService,
  CaseWorkService,
  CaseDecisionService,
  CatalogService,
  M13Emitter,
  SystemClock,
} from '@finapp/m13-case';
import {
  FeedbackRepository,
  M12Emitter,
  RecordsService as FeedbackRecordsService,
} from '@finapp/m12-feedback';
import { ActorModule } from '../actor/actor.module.ts';
import { CaseCatalogController } from './catalog.controller.ts';
import { CasesController } from './cases.controller.ts';
import { CaseWorkController } from './work.controller.ts';
import { CaseDecisionController } from './decision.controller.ts';
import { M12FeedbackHandoffAdapter } from './handoff.adapter.ts';

/** DI tokens for the SLA/deadline clock port and the M12 handoff source. */
export const CASE_CLOCK = Symbol.for('finapp.m13.clock');
export const CASE_HANDOFF_SOURCE = Symbol.for('finapp.m13.handoff');

/**
 * M13-case wiring — the enterprise case-management platform: configurable case types + SLA policies, M12 feedback
 * handoff, triage, assignment, the full case lifecycle, parties, activities, tasks, issues, investigation,
 * evidence, deadlines, hearings, decisions, settlement, recovery boundary, closure, reopening, relationships and
 * analytics, all under `/api/v1/cases` (Stage 3.2).
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`; re-binding
 * any here would be a duplicate shared service. m13 owns NO outbox — every case.lifecycle / case.converted_to_matter
 * event flows through the one `M13Emitter` over the `OUTBOX` that m06 owns. Escalation reuses m08 (via event),
 * workflow m06, rules m07, documents m09, and the feedback handoff m12 (through the `M12FeedbackHandoffAdapter`
 * over m12's public `RecordsService` — m13 never reads m12's tables). The SLA/deadline `Clock` port is bound to
 * the real `SystemClock`; the DB-integration specs inject a `FixedClock`. Case handoff creates one case per
 * handoff (idempotent); the m14 boundary is the `case.converted_to_matter` event.
 */
@Module({
  imports: [ActorModule],
  controllers: [CaseCatalogController, CasesController, CaseWorkController, CaseDecisionController],
  providers: [
    { provide: CaseRepository, useFactory: () => new CaseRepository() },
    { provide: CASE_CLOCK, useFactory: () => new SystemClock() },
    {
      provide: M13Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M13Emitter(audit, outbox),
    },
    // The M12 handoff source: a real m12 RecordsService behind the adapter (m13 goes through m12's public API).
    {
      provide: CASE_HANDOFF_SOURCE,
      inject: [DB, AUTHZ, AUDIT, OUTBOX],
      useFactory: (db: Db, authz: Authz, audit: Audit, outbox: Outbox<DomainEvent>) =>
        new M12FeedbackHandoffAdapter(
          new FeedbackRecordsService(db, authz, new M12Emitter(audit, outbox), new FeedbackRepository()),
        ),
    },
    {
      provide: CatalogService,
      inject: [DB, AUTHZ, M13Emitter, CaseRepository],
      useFactory: (db: Db, authz: Authz, emitter: M13Emitter, repo: CaseRepository) =>
        new CatalogService(db, authz, emitter, repo),
    },
    {
      provide: CaseService,
      inject: [DB, AUTHZ, M13Emitter, CaseRepository, CASE_HANDOFF_SOURCE],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M13Emitter,
        repo: CaseRepository,
        handoff: M12FeedbackHandoffAdapter,
      ) => new CaseService(db, authz, emitter, repo, handoff),
    },
    {
      provide: CaseWorkService,
      inject: [DB, AUTHZ, M13Emitter, CaseRepository, CASE_CLOCK],
      useFactory: (db: Db, authz: Authz, emitter: M13Emitter, repo: CaseRepository, clock: SystemClock) =>
        new CaseWorkService(db, authz, emitter, repo, clock),
    },
    {
      provide: CaseDecisionService,
      inject: [DB, AUTHZ, M13Emitter, CaseRepository, CASE_CLOCK],
      useFactory: (db: Db, authz: Authz, emitter: M13Emitter, repo: CaseRepository, clock: SystemClock) =>
        new CaseDecisionService(db, authz, emitter, repo, clock),
    },
  ],
})
export class CasesModule {}
