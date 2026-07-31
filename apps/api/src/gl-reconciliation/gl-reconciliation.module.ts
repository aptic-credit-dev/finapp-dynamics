import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  GlreconRepository,
  CatalogService,
  ImportService,
  ReconciliationService,
  MatchService,
  CertificationService,
  RecommendationService,
  M20Emitter,
  SystemClock,
} from '@finapp/m20-glrecon';
import { ActorModule } from '../actor/actor.module.ts';
import { GlreconCatalogController } from './catalog.controller.ts';
import { GlreconImportController } from './import.controller.ts';
import { GlreconRunController } from './reconciliation.controller.ts';
import { GlreconMatchController } from './match.controller.ts';
import { GlreconCertificationController } from './certification.controller.ts';
import { GlreconRecommendationController } from './recommendation.controller.ts';

/** DI token for the GL-reconciliation clock port (bound to the real system clock; tests inject a FixedClock). */
export const GLRECON_CLOCK = Symbol.for('finapp.m20.clock');

/**
 * M20-glrecon wiring — GENERAL-LEDGER RECONCILIATION (Stage 3): GL accounts, GL + source ingestion (duplicate-
 * protected), the balance invariant (opening + debits − credits = calculated closing), versioned matching rulesets,
 * reconciliation runs, the deterministic matching ORCHESTRATION (via the REUSED m15a engine), candidates + matches +
 * match lines, reconciling items, exceptions + aging, manual review/override (append-only evidence), balance
 * certification (with a privileged override for open blockers), and DRAFT journal recommendations, all under
 * `/api/v1/gl-reconciliation`.
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`; re-binding any
 * here would be a duplicate shared service. m20 owns NO outbox — every `glrecon.lifecycle` event flows through the one
 * `M20Emitter` over the `OUTBOX` that m06 owns. m20 owns only `gl_*`; it owns no chart of accounts (m19), bank
 * reconciliation (m15), journal posting (m21) or approvals (m22) — those are referenced by opaque id. It NEVER posts a
 * journal or writes to the GL. MONEY IS INTEGER MINOR UNITS end-to-end (STRING on the wire), never a float (ADR-007).
 * The `Clock` port is bound to the real `SystemClock`; DB-integration specs inject a `FixedClock`.
 */
@Module({
  imports: [ActorModule],
  controllers: [
    GlreconCatalogController,
    GlreconImportController,
    GlreconRunController,
    GlreconMatchController,
    GlreconCertificationController,
    GlreconRecommendationController,
  ],
  providers: [
    { provide: GlreconRepository, useFactory: () => new GlreconRepository() },
    { provide: GLRECON_CLOCK, useFactory: () => new SystemClock() },
    {
      provide: M20Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M20Emitter(audit, outbox),
    },
    {
      provide: CatalogService,
      inject: [DB, AUTHZ, M20Emitter, GlreconRepository],
      useFactory: (db: Db, authz: Authz, emitter: M20Emitter, repo: GlreconRepository) =>
        new CatalogService(db, authz, emitter, repo),
    },
    {
      provide: ImportService,
      inject: [DB, AUTHZ, M20Emitter, GlreconRepository],
      useFactory: (db: Db, authz: Authz, emitter: M20Emitter, repo: GlreconRepository) =>
        new ImportService(db, authz, emitter, repo),
    },
    {
      provide: ReconciliationService,
      inject: [DB, AUTHZ, M20Emitter, GlreconRepository],
      useFactory: (db: Db, authz: Authz, emitter: M20Emitter, repo: GlreconRepository) =>
        new ReconciliationService(db, authz, emitter, repo),
    },
    {
      provide: MatchService,
      inject: [DB, AUTHZ, M20Emitter, GlreconRepository],
      useFactory: (db: Db, authz: Authz, emitter: M20Emitter, repo: GlreconRepository) =>
        new MatchService(db, authz, emitter, repo),
    },
    {
      provide: CertificationService,
      inject: [DB, AUTHZ, M20Emitter, GlreconRepository],
      useFactory: (db: Db, authz: Authz, emitter: M20Emitter, repo: GlreconRepository) =>
        new CertificationService(db, authz, emitter, repo),
    },
    {
      provide: RecommendationService,
      inject: [DB, AUTHZ, M20Emitter, GlreconRepository],
      useFactory: (db: Db, authz: Authz, emitter: M20Emitter, repo: GlreconRepository) =>
        new RecommendationService(db, authz, emitter, repo),
    },
  ],
})
export class GlReconciliationModule {}
