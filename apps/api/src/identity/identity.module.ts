import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import { IdentityService, MembershipService } from '@finapp/m02-identity';
import { ActorModule } from '../actor/actor.module.ts';
import { IdentityController } from './identity.controller.ts';
import { AccountController } from './account.controller.ts';
import { MembershipController } from './membership.controller.ts';

/**
 * M02 wiring — the identity registry, accounts and tenant membership.
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`,
 * which is the only thing that binds them anywhere. Re-binding `AUTHZ` here — the token m02 is the
 * eventual OWNER of — would be the most defensible-looking duplicate shared service in the repo, and
 * still a duplicate: two `ContextAuthz` instances answering the same question, one of which some module
 * is asking by accident. Ownership arrives in Stage 1D with `RbacAuthz`, as one binding, in one place.
 *
 * `ActorModule` supplies the actor boundary. It is imported rather than re-created, for the same reason.
 */
@Module({
  imports: [ActorModule],
  controllers: [IdentityController, AccountController, MembershipController],
  providers: [
    {
      provide: IdentityService,
      inject: [DB, AUTHZ, AUDIT, OUTBOX],
      useFactory: (db: Db, authz: Authz, audit: Audit, outbox: Outbox<DomainEvent>) =>
        new IdentityService(db, authz, audit, outbox),
    },
    {
      provide: MembershipService,
      inject: [DB, AUTHZ, AUDIT, OUTBOX],
      useFactory: (db: Db, authz: Authz, audit: Audit, outbox: Outbox<DomainEvent>) =>
        new MembershipService(db, authz, audit, outbox),
    },
  ],
})
export class IdentityModule {}
