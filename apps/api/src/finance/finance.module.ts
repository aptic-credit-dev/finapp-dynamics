import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  FinanceRepository,
  CatalogService,
  ChartService,
  CalendarService,
  ConfigService,
  M19Emitter,
  SystemClock,
} from '@finapp/m19-finance';
import { ActorModule } from '../actor/actor.module.ts';
import { FinanceCatalogController } from './catalog.controller.ts';
import { FinanceChartController } from './chart.controller.ts';
import { FinanceCalendarController } from './calendar.controller.ts';
import { FinanceConfigController } from './config.controller.ts';

/** DI token for the finance effective-dating clock port (bound to the real system clock; tests inject a FixedClock). */
export const FINANCE_CLOCK = Symbol.for('finapp.m19.clock');

/**
 * M19-finance wiring — the finance operations FOUNDATION (Stage 3.1): accounting entities, the chart of accounts,
 * the fiscal calendar (periods whose open/closed/locked state is the cross-module posting gate), currencies + FX
 * rates, cost centres, analytical dimensions, tax codes/rates, payment terms and versioned finance configuration,
 * all under `/api/v1/finance`.
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`; re-binding
 * any here would be a duplicate shared service. m19 owns NO outbox — every `finance.lifecycle` event flows through
 * the one `M19Emitter` over the `OUTBOX` that m06 owns. m19 OWNS no journals, no postings, no reconciliation and no
 * approval workflow (m21/m15/m20/m22); it carries NO monetary amounts or balances — the only money-adjacent values
 * are EXACT-decimal FX + tax rates, kept as STRINGS end-to-end and never parsed to a float (ADR-007). The effective-
 * dating `Clock` port is bound to the real `SystemClock`; DB-integration specs inject a `FixedClock`.
 */
@Module({
  imports: [ActorModule],
  controllers: [
    FinanceCatalogController,
    FinanceChartController,
    FinanceCalendarController,
    FinanceConfigController,
  ],
  providers: [
    { provide: FinanceRepository, useFactory: () => new FinanceRepository() },
    { provide: FINANCE_CLOCK, useFactory: () => new SystemClock() },
    {
      provide: M19Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M19Emitter(audit, outbox),
    },
    {
      provide: CatalogService,
      inject: [DB, AUTHZ, M19Emitter, FinanceRepository],
      useFactory: (db: Db, authz: Authz, emitter: M19Emitter, repo: FinanceRepository) =>
        new CatalogService(db, authz, emitter, repo),
    },
    {
      provide: ChartService,
      inject: [DB, AUTHZ, M19Emitter, FinanceRepository],
      useFactory: (db: Db, authz: Authz, emitter: M19Emitter, repo: FinanceRepository) =>
        new ChartService(db, authz, emitter, repo),
    },
    {
      provide: CalendarService,
      inject: [DB, AUTHZ, M19Emitter, FinanceRepository],
      useFactory: (db: Db, authz: Authz, emitter: M19Emitter, repo: FinanceRepository) =>
        new CalendarService(db, authz, emitter, repo),
    },
    {
      provide: ConfigService,
      inject: [DB, AUTHZ, M19Emitter, FinanceRepository],
      useFactory: (db: Db, authz: Authz, emitter: M19Emitter, repo: FinanceRepository) =>
        new ConfigService(db, authz, emitter, repo),
    },
  ],
})
export class FinanceModule {}
