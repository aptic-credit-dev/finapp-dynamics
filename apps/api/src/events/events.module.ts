import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  M36Emitter,
  EventsRepository,
  WebhookService,
  RelayService,
  StreamService,
  UnavailableWebhookDelivery,
  type WebhookDeliveryPort,
} from '@finapp/m36-events';
import { ActorModule } from '../actor/actor.module.ts';
import { WebhooksController } from './webhooks.controller.ts';
import { EventsController } from './events.controller.ts';

/**
 * `/api/v1/webhooks` + `/api/v1/events` (m36). The governed outbound fan-out over the platform's domain events. m06 owns
 * THE ONE outbox/event-delivery path; m36 owns none — the RelayService consumes events (fed by the m06 dispatcher) and fans
 * them out to external subscribers. Webhook delivery is EXTERNAL EGRESS bound to `UnavailableWebhookDelivery` (framework-only,
 * fail-closed — NO production network/provider); a real HTTP runtime drops in behind the port when proven.
 */
export const M36_WEBHOOK_DELIVERY = Symbol.for('finapp.m36.webhook-delivery');

@Module({
  imports: [ActorModule],
  controllers: [WebhooksController, EventsController],
  providers: [
    { provide: EventsRepository, useFactory: () => new EventsRepository() },
    {
      provide: M36Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M36Emitter(audit, outbox),
    },
    // External egress is framework-only / fail-closed until a real HTTP delivery runtime is proven.
    { provide: M36_WEBHOOK_DELIVERY, useFactory: () => new UnavailableWebhookDelivery() },
    {
      provide: WebhookService,
      inject: [DB, AUTHZ, M36Emitter, EventsRepository],
      useFactory: (db: Db, authz: Authz, emitter: M36Emitter, repo: EventsRepository) =>
        new WebhookService(db, authz, emitter, repo),
    },
    {
      provide: RelayService,
      inject: [DB, AUTHZ, M36Emitter, M36_WEBHOOK_DELIVERY, EventsRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M36Emitter,
        delivery: WebhookDeliveryPort,
        repo: EventsRepository,
      ) => new RelayService(db, authz, emitter, delivery, repo),
    },
    {
      provide: StreamService,
      inject: [DB, AUTHZ, M36Emitter, EventsRepository],
      useFactory: (db: Db, authz: Authz, emitter: M36Emitter, repo: EventsRepository) =>
        new StreamService(db, authz, emitter, repo),
    },
  ],
})
export class EventsModule {}
