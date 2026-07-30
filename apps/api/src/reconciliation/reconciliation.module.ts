import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  ReconRepository,
  CatalogService,
  ImportService,
  ReconciliationService,
  MatchService,
  M15Emitter,
  SystemClock,
} from '@finapp/m15-recon';
import { ActorModule } from '../actor/actor.module.ts';
import { ReconciliationCatalogController } from './catalog.controller.ts';
import { ReconciliationImportController } from './import.controller.ts';
import { ReconciliationRunController } from './reconciliation.controller.ts';
import { ReconciliationMatchController } from './match.controller.ts';

/** DI token for the reconciliation clock port (bound to the real system clock; tests inject a FixedClock). */
export const RECON_CLOCK = Symbol.for('finapp.m15.clock');

/**
 * M15-recon wiring — bank RECONCILIATION + the matching engine (Stage 3): bank accounts, statement + ledger
 * ingestion (duplicate-protected), versioned matching rulesets, reconciliation runs, the deterministic matching
 * ORCHESTRATION (via the PURE m15a engine), candidates + matches + match lines, exceptions + aging, manual
 * review/override (append-only evidence), run summaries + notes, all under `/api/v1/reconciliation`.
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`; re-binding any
 * here would be a duplicate shared service. m15 owns NO outbox — every `reconciliation.lifecycle` event flows through
 * the one `M15Emitter` over the `OUTBOX` that m06 owns. m15 owns only `recon_*`; it owns no chart of accounts (m19),
 * GL reconciliation (m20), journals/postings (m21) or approvals (m22) — those are referenced by opaque id. MONEY IS
 * INTEGER MINOR UNITS end-to-end (STRING on the wire), never a float (ADR-007). The `Clock` port is bound to the real
 * `SystemClock`; DB-integration specs inject a `FixedClock`.
 */
@Module({
  imports: [ActorModule],
  controllers: [
    ReconciliationCatalogController,
    ReconciliationImportController,
    ReconciliationRunController,
    ReconciliationMatchController,
  ],
  providers: [
    { provide: ReconRepository, useFactory: () => new ReconRepository() },
    { provide: RECON_CLOCK, useFactory: () => new SystemClock() },
    {
      provide: M15Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M15Emitter(audit, outbox),
    },
    {
      provide: CatalogService,
      inject: [DB, AUTHZ, M15Emitter, ReconRepository],
      useFactory: (db: Db, authz: Authz, emitter: M15Emitter, repo: ReconRepository) =>
        new CatalogService(db, authz, emitter, repo),
    },
    {
      provide: ImportService,
      inject: [DB, AUTHZ, M15Emitter, ReconRepository],
      useFactory: (db: Db, authz: Authz, emitter: M15Emitter, repo: ReconRepository) =>
        new ImportService(db, authz, emitter, repo),
    },
    {
      provide: ReconciliationService,
      inject: [DB, AUTHZ, M15Emitter, ReconRepository],
      useFactory: (db: Db, authz: Authz, emitter: M15Emitter, repo: ReconRepository) =>
        new ReconciliationService(db, authz, emitter, repo),
    },
    {
      provide: MatchService,
      inject: [DB, AUTHZ, M15Emitter, ReconRepository],
      useFactory: (db: Db, authz: Authz, emitter: M15Emitter, repo: ReconRepository) =>
        new MatchService(db, authz, emitter, repo),
    },
  ],
})
export class ReconciliationModule {}
