import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  JournalRepository,
  CatalogService,
  RecommendationService,
  DraftService,
  ValidationService,
  PostingService,
  M21Emitter,
} from '@finapp/m21-journal';
import { ActorModule } from '../actor/actor.module.ts';
import { JournalCatalogController } from './catalog.controller.ts';
import { JournalRecommendationController } from './recommendation.controller.ts';
import { JournalDraftController } from './draft.controller.ts';
import { JournalPostingController } from './posting.controller.ts';

/**
 * M21-journal wiring — the JOURNAL ENGINE (Stage 3, DRAFT-first MVP): recommendation intake (m20 handoff/AI/ops),
 * balanced draft journals (debits == credits, decimal-safe), deterministic validation, the draft lifecycle up to
 * submit-for-approval, and approval-gated posting-request preparation + posting-result evidence — all under
 * `/api/v1/journals`.
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`; re-binding any
 * here would be a duplicate shared service. m21 owns NO outbox — every `journal.lifecycle` / `posting_request.lifecycle`
 * event flows through the one `M21Emitter` over the `OUTBOX` that m06 owns. m21 owns only its own tables; it owns no
 * chart of accounts/periods (m19), GL reconciliation (m20), approvals (m22) or integration/posting push (m23/m33) —
 * those are referenced by opaque id. It NEVER approves a journal, posts to a ledger/ERP/core system, or auto-posts.
 * MONEY IS INTEGER MINOR UNITS end-to-end (STRING on the wire), never a float (ADR-007).
 */
@Module({
  imports: [ActorModule],
  controllers: [
    JournalCatalogController,
    JournalRecommendationController,
    JournalDraftController,
    JournalPostingController,
  ],
  providers: [
    { provide: JournalRepository, useFactory: () => new JournalRepository() },
    {
      provide: M21Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M21Emitter(audit, outbox),
    },
    {
      provide: CatalogService,
      inject: [DB, AUTHZ, M21Emitter, JournalRepository],
      useFactory: (db: Db, authz: Authz, emitter: M21Emitter, repo: JournalRepository) =>
        new CatalogService(db, authz, emitter, repo),
    },
    {
      provide: RecommendationService,
      inject: [DB, AUTHZ, M21Emitter, JournalRepository],
      useFactory: (db: Db, authz: Authz, emitter: M21Emitter, repo: JournalRepository) =>
        new RecommendationService(db, authz, emitter, repo),
    },
    {
      provide: DraftService,
      inject: [DB, AUTHZ, M21Emitter, JournalRepository],
      useFactory: (db: Db, authz: Authz, emitter: M21Emitter, repo: JournalRepository) =>
        new DraftService(db, authz, emitter, repo),
    },
    {
      provide: ValidationService,
      inject: [DB, AUTHZ, M21Emitter, JournalRepository],
      useFactory: (db: Db, authz: Authz, emitter: M21Emitter, repo: JournalRepository) =>
        new ValidationService(db, authz, emitter, repo),
    },
    {
      provide: PostingService,
      inject: [DB, AUTHZ, M21Emitter, JournalRepository],
      useFactory: (db: Db, authz: Authz, emitter: M21Emitter, repo: JournalRepository) =>
        new PostingService(db, authz, emitter, repo),
    },
  ],
})
export class JournalsModule {}
