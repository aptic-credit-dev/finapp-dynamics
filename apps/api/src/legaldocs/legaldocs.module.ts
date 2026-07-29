import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  LegalDocsRepository,
  CatalogService,
  KnowledgeService,
  LibraryService,
  M18Emitter,
  SystemClock,
} from '@finapp/m18-legaldocs';
import { ActorModule } from '../actor/actor.module.ts';
import { LegalDocsCatalogController } from './catalog.controller.ts';
import { KnowledgeController } from './knowledge.controller.ts';
import { LibraryController } from './library.controller.ts';

/** DI token for the review/expiry/deadline clock port (bound to the real system clock; tests inject a FixedClock). */
export const LEGALDOCS_CLOCK = Symbol.for('finapp.m18.clock');

/**
 * M18-legaldocs wiring — the enterprise legal documents & knowledge management platform: configurable taxonomy,
 * legal authorities + treatments, precedents, opinions (maker-checker), research, the core PUBLISHABLE knowledge
 * record and its lifecycle, references, relationships, tags, citations, notes, review/expiry deadlines, usage
 * analytics, plus the drafting library (document templates + clause library, maker-checker) and the clause
 * dependency/conflict graph, all under `/api/v1/legaldocs` (Stage 4.4).
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`; re-binding
 * any here would be a duplicate shared service. m18 owns NO outbox — every legaldocs.lifecycle event flows through
 * the one `M18Emitter` over the `OUTBOX` that m06 owns. Workflow (m06), rules (m07), escalation/notifications (m08)
 * and documents (m09) are reused THROUGH events/contracts; m18 OWNS no storage (bytes live in m09) and REFERENCES
 * m09/m14/m16/m17 through OPAQUE ids only, never reading their tables. The review/expiry `Clock` port is bound to
 * the real `SystemClock`; the DB-integration specs inject a `FixedClock`. Privileged/confidential legal analysis is
 * RLS-stored, redacted on read, and NEVER placed in events/audit (ADR-076).
 */
@Module({
  imports: [ActorModule],
  controllers: [LegalDocsCatalogController, KnowledgeController, LibraryController],
  providers: [
    { provide: LegalDocsRepository, useFactory: () => new LegalDocsRepository() },
    { provide: LEGALDOCS_CLOCK, useFactory: () => new SystemClock() },
    {
      provide: M18Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M18Emitter(audit, outbox),
    },
    {
      provide: CatalogService,
      inject: [DB, AUTHZ, M18Emitter, LegalDocsRepository],
      useFactory: (db: Db, authz: Authz, emitter: M18Emitter, repo: LegalDocsRepository) =>
        new CatalogService(db, authz, emitter, repo),
    },
    {
      provide: KnowledgeService,
      inject: [DB, AUTHZ, M18Emitter, LegalDocsRepository, LEGALDOCS_CLOCK],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M18Emitter,
        repo: LegalDocsRepository,
        clock: SystemClock,
      ) => new KnowledgeService(db, authz, emitter, repo, clock),
    },
    {
      provide: LibraryService,
      inject: [DB, AUTHZ, M18Emitter, LegalDocsRepository],
      useFactory: (db: Db, authz: Authz, emitter: M18Emitter, repo: LegalDocsRepository) =>
        new LibraryService(db, authz, emitter, repo),
    },
  ],
})
export class LegaldocsModule {}
