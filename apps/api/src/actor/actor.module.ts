import { Module } from '@nestjs/common';
import { AUDIT, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import { TenantContextResolver } from '@finapp/m01-tenant';
import { ActorContextFactory, ActorResolver } from '@finapp/m02-identity';
import { AuthEmitter, SessionActorAdapter, SessionService } from '@finapp/m02-auth';
import { loadAuthConfig } from '../auth/config.ts';
import { extractSessionToken } from '../auth/cookies.ts';

/**
 * ACTOR RESOLUTION, BOUND. The one place a request becomes an actor, for the whole API.
 *
 * STAGE 1C. `DevActorAdapter` (Stage 1B) is deleted; the actor source is now `SessionActorAdapter`, which
 * turns a validated session cookie into an account claim and hands it to the UNCHANGED `ActorResolver`. The
 * factory reads the credential via `extractSessionToken` (the session cookie), replacing the `x-dev-actor`
 * header reader. `ActorResolver`, `ActorContextFactory` and every controller are otherwise untouched.
 *
 * The auth-core services (SessionService, AuthEmitter) and the resolver live here and are EXPORTED, so the
 * AuthModule (login/logout/refresh) shares one instance of each rather than binding a second — no duplicate
 * session store, no second audit buffer. This module imports neither feature module, so the graph stays
 * acyclic.
 */

/** The seam Stage 1B occupied; Stage 1C fills it with a session-backed source. */
export const ACTOR_SOURCE = Symbol.for('finapp.actor.source');
export const AUTH_CONFIG = Symbol.for('finapp.auth.config');

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
      // Loads the transport config and FAILS CLOSED at boot in production if cookies/origins are unsafe.
      provide: AUTH_CONFIG,
      useFactory: () => loadAuthConfig(),
    },
    {
      provide: AuthEmitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new AuthEmitter(audit, outbox),
    },
    {
      provide: SessionService,
      inject: [DB, AuthEmitter],
      useFactory: (db: Db, emitter: AuthEmitter) => new SessionService(db, emitter),
    },
    {
      provide: ACTOR_SOURCE,
      inject: [SessionService, ActorResolver],
      useFactory: (sessions: SessionService, resolver: ActorResolver) =>
        new SessionActorAdapter(sessions, resolver),
    },
    {
      provide: ActorContextFactory,
      inject: [ACTOR_SOURCE, TenantContextResolver],
      useFactory: (source: SessionActorAdapter, tenants: TenantContextResolver) =>
        new ActorContextFactory(source, tenants, extractSessionToken),
    },
  ],
  exports: [ActorContextFactory, SessionService, AuthEmitter, ActorResolver, AUTH_CONFIG],
})
export class ActorModule {}
