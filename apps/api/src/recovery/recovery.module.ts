import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  RecoveryRepository,
  RecoveryService,
  RecoveryWorkService,
  CatalogService,
  M17Emitter,
  SystemClock,
} from '@finapp/m17-recovery';
import { ActorModule } from '../actor/actor.module.ts';
import { RecoveryCatalogController } from './catalog.controller.ts';
import { RecoveriesController } from './recoveries.controller.ts';
import { RecoveryController } from './recovery.controller.ts';

/** DI token for the SLA/deadline/limitation clock port (bound to the real system clock; tests inject a FixedClock). */
export const RECOVERY_CLOCK = Symbol.for('finapp.m17.clock');

/**
 * M17-recovery wiring — the enterprise recovery & enforcement management platform: configurable recovery types +
 * SLA policies, the M16 enforcement referral, recovery cases, debtor parties, strategy, enforceable instruments,
 * demands, negotiations, repayment arrangements + installments, enforcement actions, security/collateral, external
 * agents + reports, recovery receipts, waivers, write-off recommendations, outcomes, deadlines/limitation, cost
 * references, closure, reopening, relationships and analytics, all under `/api/v1/recovery` (Stage 4.3).
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`; re-binding
 * any here would be a duplicate shared service. m17 owns NO outbox — every recovery.lifecycle event flows through
 * the one `M17Emitter` over the `OUTBOX` that m06 owns. Escalation/notifications reuse m08 (via event), workflow
 * m06, rules m07, documents m09; the M16 referral is a GOVERNED INBOUND CONTRACT and idempotent (one recovery per
 * referral key) — m17 never reads m16/m14 tables. The SLA/deadline `Clock` port is bound to the real `SystemClock`;
 * the DB-integration specs inject a `FixedClock`. ALL amounts are REFERENCES only — no cash application, ledger
 * posting, or accounting write-off (ADR-071).
 */
@Module({
  imports: [ActorModule],
  controllers: [RecoveryCatalogController, RecoveriesController, RecoveryController],
  providers: [
    { provide: RecoveryRepository, useFactory: () => new RecoveryRepository() },
    { provide: RECOVERY_CLOCK, useFactory: () => new SystemClock() },
    {
      provide: M17Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M17Emitter(audit, outbox),
    },
    {
      provide: CatalogService,
      inject: [DB, AUTHZ, M17Emitter, RecoveryRepository],
      useFactory: (db: Db, authz: Authz, emitter: M17Emitter, repo: RecoveryRepository) =>
        new CatalogService(db, authz, emitter, repo),
    },
    {
      provide: RecoveryService,
      inject: [DB, AUTHZ, M17Emitter, RecoveryRepository],
      useFactory: (db: Db, authz: Authz, emitter: M17Emitter, repo: RecoveryRepository) =>
        new RecoveryService(db, authz, emitter, repo),
    },
    {
      provide: RecoveryWorkService,
      inject: [DB, AUTHZ, M17Emitter, RecoveryRepository, RECOVERY_CLOCK],
      useFactory: (db: Db, authz: Authz, emitter: M17Emitter, repo: RecoveryRepository, clock: SystemClock) =>
        new RecoveryWorkService(db, authz, emitter, repo, clock),
    },
  ],
})
export class RecoveryModule {}
