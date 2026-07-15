import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.ts';
import { PlatformModule } from './platform.module.ts';
import { TenantModule } from './tenant/tenant.module.ts';
import { IdentityModule } from './identity/identity.module.ts';

/**
 * The composition root.
 *
 * Stage 0 bound no kernel tokens. Stage 1A bound them inside `TenantModule`. Stage 1B separates the two
 * concerns that had been sharing a file:
 *
 *   PlatformModule  — the shared services, bound ONCE for the process (@Global).
 *   ActorModule     — who is acting. Imported by both feature modules; imports neither.
 *   TenantModule    — m01. Now a consumer of the actor boundary rather than a builder of context.
 *   IdentityModule  — m02. The identity registry, accounts and tenant membership.
 *
 * The graph is acyclic and stays that way by construction: feature modules depend on `ActorModule`, never
 * on each other. M01 and M02 meet only at `TenantContextResolver` — m01's contract, called by m02 — so
 * m01 never reads an m02 table and m02 never re-implements m01's tenant rules.
 *
 * The API requires a database at boot (`DATABASE_URL`), and in production it requires an actor source
 * that does not exist until Stage 1C — so it deliberately refuses to start there. See actor/actor.module.ts.
 */
@Module({
  imports: [PlatformModule, TenantModule, IdentityModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
