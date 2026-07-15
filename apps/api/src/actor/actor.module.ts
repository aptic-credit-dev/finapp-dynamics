import { Module } from '@nestjs/common';
import { DB } from '@finapp/kernel';
import type { Db } from '@finapp/kernel';
import { TenantContextResolver } from '@finapp/m01-tenant';
import {
  ActorContextFactory,
  ActorResolver,
  DevActorAdapter,
  devActorAdapterRejectionReason,
  isDevActorAdapterAllowed,
  type ActorSource,
} from '@finapp/m02-identity';

/**
 * ACTOR RESOLUTION, BOUND. This module is the answer to "who is acting?" for the whole API.
 *
 * It exists as its own module, rather than living in `IdentityModule`, to keep the dependency graph
 * acyclic. `TenantModule` needs the actor boundary and `IdentityModule` needs it too; if it were owned by
 * either one, the other would have to import that module and M01 <-> M02 would become a cycle. Here, both
 * feature modules depend on this, and this depends on neither.
 *
 * It also binds M01's `TenantContextResolver` — the tenant gate. That is a WIRING location, not a claim
 * of ownership: the class is m01's, the rule it enforces is m01's, and m02 calls it precisely so that
 * tenant validity has one implementation. M01 never reads an m02 table and m02 never re-implements m01's
 * status rules; they meet at this contract.
 */

/** The seam Stage 1C replaces: `DevActorAdapter` today, a session-backed resolver then. */
export const ACTOR_SOURCE = Symbol.for('finapp.actor.source');

@Module({
  providers: [
    {
      provide: TenantContextResolver,
      inject: [DB],
      useFactory: (db: Db) => new TenantContextResolver(db),
    },
    {
      provide: ActorResolver,
      inject: [DB],
      useFactory: (db: Db) => new ActorResolver(db),
    },
    {
      provide: ACTOR_SOURCE,
      inject: [ActorResolver],
      useFactory: (resolver: ActorResolver): ActorSource => {
        /**
         * THE ENVIRONMENT GATE (§5). Stage 1B has no authentication — that is Stage 1C — so the only
         * actor source that exists is a development stopgap, and it must never be the thing standing
         * between production and the platform.
         *
         * This REFUSES TO BOOT in production rather than starting an API that 401s every request or,
         * far worse, one that accepts a dev assertion from anyone holding a leaked secret. A stage with
         * no authentication is not deployable, and the honest way to say so is to not start.
         *
         * `DevActorAdapter`'s constructor enforces the same rule independently (NODE_ENV, secret
         * strength). Two checks for one property is deliberate: this one gives a boot error that names
         * the stage and the reason, and that one guarantees the adapter cannot be constructed by any
         * other caller who forgot to ask first.
         */
        if (!isDevActorAdapterAllowed()) {
          throw new Error(
            `${devActorAdapterRejectionReason() ?? 'The development actor adapter is not permitted here.'}\n` +
              'Stage 1B has no production actor source: authentication and sessions are Stage 1C. ' +
              'The API deliberately refuses to start rather than expose an unauthenticated identity path.',
          );
        }
        return new DevActorAdapter(resolver);
      },
    },
    {
      provide: ActorContextFactory,
      inject: [ACTOR_SOURCE, TenantContextResolver],
      useFactory: (source: ActorSource, tenants: TenantContextResolver) =>
        new ActorContextFactory(source, tenants),
    },
  ],
  exports: [ActorContextFactory],
})
export class ActorModule {}
