import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  M40Emitter,
  ResilienceRepository,
  OfflineService,
  ObservabilityService,
  BackupDrService,
  UnavailableBackupExecutor,
  type BackupExecutorPort,
} from '@finapp/m40-resilience';
import { ActorModule } from '../actor/actor.module.ts';
import { ResilienceOfflineController } from './resilience-offline.controller.ts';
import { ResilienceBackupController } from './resilience-backup.controller.ts';

/**
 * `/api/v1/resilience` (m40). The governed mobile/offline/observability/backup/BC layer. THE LOAD-BEARING RULE: an offline
 * client may draft/queue but never finalize a controlled action offline (online re-validation required; DB-enforced). Backup/
 * restore/failover EXECUTION is framework-only through a fail-closed `BackupExecutorPort` (default `UnavailableBackupExecutor`
 * -> a durable BLOCKED result; no shell/dump/restore command, no infra egress); a real executor (behind maker-checker for
 * restore/failover) drops in later. Backup/DR schedules are opaque refs composing m06/m38 — m40 runs no scheduler. m40 owns no
 * outbox — it publishes mobile/backup/dr.lifecycle through the ONE m06 outbox. It holds no secret value.
 */
export const M40_BACKUP_EXECUTOR = Symbol.for('finapp.m40.backup-executor');

@Module({
  imports: [ActorModule],
  controllers: [ResilienceOfflineController, ResilienceBackupController],
  providers: [
    { provide: ResilienceRepository, useFactory: () => new ResilienceRepository() },
    {
      provide: M40Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M40Emitter(audit, outbox),
    },
    // Backup/restore/failover execution is framework-only / fail-closed until a real executor is wired.
    { provide: M40_BACKUP_EXECUTOR, useFactory: () => new UnavailableBackupExecutor() },
    {
      provide: OfflineService,
      inject: [DB, AUTHZ, M40Emitter, ResilienceRepository],
      useFactory: (db: Db, authz: Authz, emitter: M40Emitter, repo: ResilienceRepository) =>
        new OfflineService(db, authz, emitter, repo),
    },
    {
      provide: ObservabilityService,
      inject: [DB, AUTHZ, M40Emitter, ResilienceRepository],
      useFactory: (db: Db, authz: Authz, emitter: M40Emitter, repo: ResilienceRepository) =>
        new ObservabilityService(db, authz, emitter, repo),
    },
    {
      provide: BackupDrService,
      inject: [DB, AUTHZ, M40Emitter, M40_BACKUP_EXECUTOR, ResilienceRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M40Emitter,
        executor: BackupExecutorPort,
        repo: ResilienceRepository,
      ) => new BackupDrService(db, authz, emitter, executor, repo),
    },
  ],
})
export class ResilienceModule {}
