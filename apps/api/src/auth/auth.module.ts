import { Module } from '@nestjs/common';
import { DB } from '@finapp/kernel';
import type { Db } from '@finapp/kernel';
import { AuthEmitter, AuthService, CredentialService, SessionService } from '@finapp/m02-auth';
import { ActorModule } from '../actor/actor.module.ts';
import { AuthController } from './auth.controller.ts';

/**
 * m02-auth (Stage 1C) — authentication and sessions.
 *
 * Imports `ActorModule` so it SHARES the one `SessionService` and `AuthEmitter` the actor boundary already
 * binds — there is exactly one session store and one audit/event emitter for the process. Only login-side
 * services (credentials, the login orchestrator) are new here. The graph is one-directional: AuthModule ->
 * ActorModule, never back.
 */
@Module({
  imports: [ActorModule],
  providers: [
    {
      provide: CredentialService,
      inject: [DB, AuthEmitter],
      useFactory: (db: Db, emitter: AuthEmitter) => new CredentialService(db, emitter),
    },
    {
      provide: AuthService,
      inject: [DB, AuthEmitter, CredentialService, SessionService],
      useFactory: (db: Db, emitter: AuthEmitter, credentials: CredentialService, sessions: SessionService) =>
        new AuthService(db, emitter, credentials, sessions),
    },
  ],
  controllers: [AuthController],
  exports: [CredentialService, AuthService],
})
export class AuthModule {}
