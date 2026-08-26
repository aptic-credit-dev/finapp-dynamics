import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  CatalogService,
  FeedbackRepository,
  FeedbackService,
  M12Emitter,
  RecordsService,
  SystemClock,
} from '@finapp/m12-feedback';
import { ActorModule } from '../actor/actor.module.ts';
import { FeedbackCatalogController } from './catalog.controller.ts';
import { FeedbackController } from './feedback.controller.ts';
import { FeedbackRecordsController } from './records.controller.ts';

/** DI token for the SLA clock port (bound to the real system clock here; tests inject a FixedClock). */
export const FEEDBACK_CLOCK = Symbol.for('finapp.m12.clock');

/**
 * M12-feedback wiring — the enterprise feedback platform: source-transaction ingestion, the contact queue,
 * questionnaires, SLA policies, the full feedback-record lifecycle, classification, assignment, resolution,
 * closure, SLA tracking, escalation, M13 case handoff and duplicate/related linking, all under
 * `/api/v1/feedback` (Stage 3.1).
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`; re-binding
 * any here would be a duplicate shared service. m12 owns NO outbox — every feedback.lifecycle event flows through
 * the one `M12Emitter` over the `OUTBOX` that m06 owns. Escalation reuses m08 (via event) and case handoff to m13
 * is a pending record + event — m12 builds no second escalation engine and no case table. The SLA `Clock` port is
 * bound to the real `SystemClock`; the DB-integration specs inject a `FixedClock` for deterministic SLA math.
 */
@Module({
  imports: [ActorModule],
  controllers: [FeedbackCatalogController, FeedbackController, FeedbackRecordsController],
  providers: [
    { provide: FeedbackRepository, useFactory: () => new FeedbackRepository() },
    { provide: FEEDBACK_CLOCK, useFactory: () => new SystemClock() },
    {
      provide: M12Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M12Emitter(audit, outbox),
    },
    {
      provide: CatalogService,
      inject: [DB, AUTHZ, M12Emitter, FeedbackRepository],
      useFactory: (db: Db, authz: Authz, emitter: M12Emitter, repo: FeedbackRepository) =>
        new CatalogService(db, authz, emitter, repo),
    },
    {
      provide: FeedbackService,
      inject: [DB, AUTHZ, M12Emitter, FeedbackRepository],
      useFactory: (db: Db, authz: Authz, emitter: M12Emitter, repo: FeedbackRepository) =>
        new FeedbackService(db, authz, emitter, repo),
    },
    {
      provide: RecordsService,
      inject: [DB, AUTHZ, M12Emitter, FeedbackRepository, FEEDBACK_CLOCK],
      useFactory: (db: Db, authz: Authz, emitter: M12Emitter, repo: FeedbackRepository, clock: SystemClock) =>
        new RecordsService(db, authz, emitter, repo, clock),
    },
  ],
  // FeedbackService is exported so the m32 analytics module can bind its REAL feedback materialization source to
  // this canonical, permission-gated aggregate read seam (FeedbackService.analytics) — never m12's private tables.
  exports: [FeedbackService],
})
export class FeedbackModule {}
