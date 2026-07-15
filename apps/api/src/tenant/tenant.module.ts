import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import { OrgService, TenantService } from '@finapp/m01-tenant';
import { ActorModule } from '../actor/actor.module.ts';
import { TenantController } from './tenant.controller.ts';

/**
 * M01 wiring.
 *
 * WHAT CHANGED IN STAGE 1B. This module used to bind `DB`/`AUTHZ`/`AUDIT`/`OUTBOX` itself and to provide
 * `TenantContextResolver` for its controller. Both moved:
 *   - the four kernel tokens are now bound once, in `PlatformModule` (`@Global`), because a second
 *     feature module binding them would mean a second connection pool and a second `ContextAuthz`;
 *   - `TenantContextResolver` moved to `ActorModule`, which is where the tenant gate is now applied — as
 *     one step of actor resolution rather than a thing each controller remembers to do.
 *
 * M01 no longer resolves context at all. It receives one. That is the whole of Stage 1B's M01 change:
 * `TenantService` and `OrgService` are untouched, every `authz.require` call is untouched, and the
 * identity that reaches them is now proven rather than claimed.
 */
@Module({
  imports: [ActorModule],
  controllers: [TenantController],
  providers: [
    {
      provide: TenantService,
      inject: [DB, AUTHZ, AUDIT, OUTBOX],
      useFactory: (db: Db, authz: Authz, audit: Audit, outbox: Outbox<DomainEvent>) =>
        new TenantService(db, authz, audit, outbox),
    },
    {
      provide: OrgService,
      inject: [DB, AUTHZ, AUDIT, OUTBOX],
      useFactory: (db: Db, authz: Authz, audit: Audit, outbox: Outbox<DomainEvent>) =>
        new OrgService(db, authz, audit, outbox),
    },
  ],
})
export class TenantModule {}
