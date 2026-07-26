import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  AccessService,
  CatalogService,
  DeterministicScanner,
  DocsRepository,
  DocumentService,
  InMemoryStorage,
  M09Emitter,
  RecordsService,
} from '@finapp/m09-docs';
import { ActorModule } from '../actor/actor.module.ts';
import { CatalogController } from './catalog.controller.ts';
import { DocumentsController } from './documents.controller.ts';
import { DocumentAccessController } from './access.controller.ts';
import { DocumentRecordsController } from './records.controller.ts';

/** DI tokens for the storage + scan ports (bound to Framework-Only test doubles here). */
export const DOC_STORAGE = Symbol.for('finapp.m09.storage');
export const DOC_SCANNER = Symbol.for('finapp.m09.scanner');

/**
 * M09-docs wiring — document types, retention policies, documents, immutable versions, ACL grants, checkouts,
 * relationships, legal holds and disposition, all under `/api/v1/documents` (Stage 2.5).
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`; re-binding
 * any here would be a duplicate shared service. m09 does NOT own an outbox — every document.lifecycle event
 * flows through the one `M09Emitter` over the `OUTBOX` that m06 owns. The `DocumentStorage` and `ContentScanner`
 * ports are bound to DETERMINISTIC test doubles (in-memory storage + deterministic scanner): m09 ships NO cloud
 * storage and NO antivirus, and commits NO secrets (Framework Only). A deployment binds real adapters here.
 */
@Module({
  imports: [ActorModule],
  controllers: [CatalogController, DocumentsController, DocumentAccessController, DocumentRecordsController],
  providers: [
    { provide: DocsRepository, useFactory: () => new DocsRepository() },
    { provide: DOC_STORAGE, useFactory: () => new InMemoryStorage('framework-only-storage') },
    { provide: DOC_SCANNER, useFactory: () => new DeterministicScanner({ code: 'framework-only-scan' }) },
    {
      provide: M09Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M09Emitter(audit, outbox),
    },
    {
      provide: CatalogService,
      inject: [DB, AUTHZ, M09Emitter, DocsRepository],
      useFactory: (db: Db, authz: Authz, emitter: M09Emitter, repo: DocsRepository) =>
        new CatalogService(db, authz, emitter, repo),
    },
    {
      provide: DocumentService,
      inject: [DB, AUTHZ, M09Emitter, DocsRepository, DOC_STORAGE, DOC_SCANNER],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M09Emitter,
        repo: DocsRepository,
        storage: InMemoryStorage,
        scanner: DeterministicScanner,
      ) => new DocumentService(db, authz, emitter, repo, storage, scanner),
    },
    {
      provide: AccessService,
      inject: [DB, AUTHZ, M09Emitter, DocsRepository],
      useFactory: (db: Db, authz: Authz, emitter: M09Emitter, repo: DocsRepository) =>
        new AccessService(db, authz, emitter, repo),
    },
    {
      provide: RecordsService,
      inject: [DB, AUTHZ, M09Emitter, DocsRepository, DOC_STORAGE],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M09Emitter,
        repo: DocsRepository,
        storage: InMemoryStorage,
      ) => new RecordsService(db, authz, emitter, repo, storage),
    },
  ],
})
export class DocumentsModule {}
