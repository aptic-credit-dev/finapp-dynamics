import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  M32Emitter,
  AnalyticsRepository,
  AnalyticsDatasetService,
  AnalyticsMetricService,
  AnalyticsReportService,
  AnalyticsQueryService,
  AnalyticsMaterializationService,
  AnalyticsExportService,
  AnalyticsScheduleService,
  M32ExecutiveAnalyticsAdapter,
  type MaterializationSourcePort,
} from '@finapp/m32-analytics';
import { FeedbackService } from '@finapp/m12-feedback';
import { ActorModule } from '../actor/actor.module.ts';
import { FeedbackModule } from '../feedback/feedback.module.ts';
import { AnalyticsDefinitionsController } from './definitions.controller.ts';
import { AnalyticsRuntimeController } from './runtime.controller.ts';
import { FeedbackMaterializationSource, RoutingMaterializationSource } from './materialization-sources.ts';

/**
 * `/api/v1/analytics` (m32). Governed reporting/analytics builder — datasets, metrics, reports, the governed semantic
 * query, materialization, exports and schedules. All services take the kernel ports; m32 owns no engine. The
 * materialization SOURCE is a DETERMINISTIC offline double (real source adapters / m33 wire in behind the port later),
 * and `M32ExecutiveAnalyticsAdapter` is the real implementation of M28's ExecutiveAnalyticsPort (provided for the copilot
 * to consume; the query service is its entitlement-filtered, citation-bearing provider).
 */
export const M32_MATERIALIZATION_SOURCE = Symbol.for('finapp.m32.materialization-source');

@Module({
  imports: [ActorModule, FeedbackModule],
  controllers: [AnalyticsDefinitionsController, AnalyticsRuntimeController],
  providers: [
    { provide: AnalyticsRepository, useFactory: () => new AnalyticsRepository() },
    {
      provide: M32Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M32Emitter(audit, outbox),
    },
    {
      // The materialization source ROUTES by dataset.source_module: a REAL adapter binds `m12-feedback` to the
      // canonical feedback aggregate read seam (so a feedback dataset materializes genuine live counts); any other
      // source falls back to the deterministic fixture double. No source module's private tables are ever read.
      provide: M32_MATERIALIZATION_SOURCE,
      inject: [FeedbackService],
      useFactory: (feedback: FeedbackService) =>
        new RoutingMaterializationSource({
          'm12-feedback': new FeedbackMaterializationSource(feedback),
        }),
    },
    {
      provide: AnalyticsDatasetService,
      inject: [DB, AUTHZ, M32Emitter, AnalyticsRepository],
      useFactory: (db: Db, authz: Authz, emitter: M32Emitter, repo: AnalyticsRepository) =>
        new AnalyticsDatasetService(db, authz, emitter, repo),
    },
    {
      provide: AnalyticsMetricService,
      inject: [DB, AUTHZ, M32Emitter, AnalyticsRepository],
      useFactory: (db: Db, authz: Authz, emitter: M32Emitter, repo: AnalyticsRepository) =>
        new AnalyticsMetricService(db, authz, emitter, repo),
    },
    {
      provide: AnalyticsReportService,
      inject: [DB, AUTHZ, M32Emitter, AnalyticsRepository],
      useFactory: (db: Db, authz: Authz, emitter: M32Emitter, repo: AnalyticsRepository) =>
        new AnalyticsReportService(db, authz, emitter, repo),
    },
    {
      provide: AnalyticsQueryService,
      inject: [DB, AUTHZ, M32Emitter, AnalyticsRepository],
      useFactory: (db: Db, authz: Authz, emitter: M32Emitter, repo: AnalyticsRepository) =>
        new AnalyticsQueryService(db, authz, emitter, repo),
    },
    {
      provide: AnalyticsMaterializationService,
      inject: [DB, AUTHZ, M32Emitter, M32_MATERIALIZATION_SOURCE, AnalyticsRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M32Emitter,
        source: MaterializationSourcePort,
        repo: AnalyticsRepository,
      ) => new AnalyticsMaterializationService(db, authz, emitter, source, repo),
    },
    {
      provide: AnalyticsExportService,
      inject: [DB, AUTHZ, M32Emitter, AnalyticsQueryService, AnalyticsRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M32Emitter,
        query: AnalyticsQueryService,
        repo: AnalyticsRepository,
      ) => new AnalyticsExportService(db, authz, emitter, query, repo),
    },
    {
      provide: AnalyticsScheduleService,
      inject: [DB, AUTHZ, M32Emitter, AnalyticsRepository],
      useFactory: (db: Db, authz: Authz, emitter: M32Emitter, repo: AnalyticsRepository) =>
        new AnalyticsScheduleService(db, authz, emitter, repo),
    },
    {
      provide: M32ExecutiveAnalyticsAdapter,
      inject: [AnalyticsQueryService],
      useFactory: (query: AnalyticsQueryService) => new M32ExecutiveAnalyticsAdapter(query),
    },
  ],
  exports: [M32ExecutiveAnalyticsAdapter],
})
export class AnalyticsModule {}
