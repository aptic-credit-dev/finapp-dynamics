import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  EscalationService,
  InboxService,
  M08Emitter,
  NotificationService,
  NotifyRepository,
  PreferenceService,
  ProviderRegistry,
  TemplateService,
} from '@finapp/m08-notify';
import { ActorModule } from '../actor/actor.module.ts';
import { TemplatesController } from './templates.controller.ts';
import { RequestsController } from './requests.controller.ts';
import { EscalationsController } from './escalations.controller.ts';
import { InboxPreferencesController } from './inbox-preferences.controller.ts';

/**
 * M08-notify wiring — notification templates, requests, delivery evidence, escalation policies/instances,
 * preferences, and the in-app inbox, all under `/api/v1/notifications` (Stage 2.4).
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`, the one
 * place they are bound; re-binding any here would be a duplicate shared service. m08 does NOT own an outbox —
 * every notification.lifecycle event flows through the one `M08Emitter` over the `OUTBOX` that m06 owns. The
 * `ProviderRegistry` is bound EMPTY: m08 ships no real third-party provider (Framework Only), so unconfigured
 * dispatch fails safe as a retryable provider error — a deployment registers real adapters here. One
 * `NotifyRepository` and one `M08Emitter` are shared by every service.
 */
@Module({
  imports: [ActorModule],
  controllers: [TemplatesController, RequestsController, EscalationsController, InboxPreferencesController],
  providers: [
    { provide: NotifyRepository, useFactory: () => new NotifyRepository() },
    { provide: ProviderRegistry, useFactory: () => new ProviderRegistry() },
    {
      provide: M08Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M08Emitter(audit, outbox),
    },
    {
      provide: TemplateService,
      inject: [DB, AUTHZ, M08Emitter, NotifyRepository],
      useFactory: (db: Db, authz: Authz, emitter: M08Emitter, repo: NotifyRepository) =>
        new TemplateService(db, authz, emitter, repo),
    },
    {
      provide: NotificationService,
      inject: [DB, AUTHZ, M08Emitter, NotifyRepository, ProviderRegistry],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M08Emitter,
        repo: NotifyRepository,
        providers: ProviderRegistry,
      ) => new NotificationService(db, authz, emitter, repo, providers),
    },
    {
      provide: EscalationService,
      inject: [DB, AUTHZ, M08Emitter, NotifyRepository],
      useFactory: (db: Db, authz: Authz, emitter: M08Emitter, repo: NotifyRepository) =>
        new EscalationService(db, authz, emitter, repo),
    },
    {
      provide: PreferenceService,
      inject: [DB, AUTHZ, M08Emitter, NotifyRepository],
      useFactory: (db: Db, authz: Authz, emitter: M08Emitter, repo: NotifyRepository) =>
        new PreferenceService(db, authz, emitter, repo),
    },
    {
      provide: InboxService,
      inject: [DB, AUTHZ, M08Emitter, NotifyRepository],
      useFactory: (db: Db, authz: Authz, emitter: M08Emitter, repo: NotifyRepository) =>
        new InboxService(db, authz, emitter, repo),
    },
  ],
})
export class NotifyModule {}
