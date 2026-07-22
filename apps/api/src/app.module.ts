import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { HealthController } from './health.controller.ts';
import { PlatformModule } from './platform.module.ts';
import { TenantModule } from './tenant/tenant.module.ts';
import { IdentityModule } from './identity/identity.module.ts';
import { RbacModule } from './rbac/rbac.module.ts';
import { AuthModule } from './auth/auth.module.ts';
import { CsrfMiddleware } from './auth/csrf.middleware.ts';

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
 * Stage 1C adds AuthModule (login/sessions) and a global CSRF guard for state-changing cookie-authenticated
 * requests. The API requires a database at boot (`DATABASE_URL`); in production the auth config must be safe
 * or it refuses to start (see auth/config.ts).
 *
 * Stage 1D adds RbacModule — roles, assignments, SoD and the permission catalogue under `/api/v1/rbac`. It
 * is the OWNER of `AUTHZ` (bound to `RbacAuthz` in PlatformModule); every module's permission checks now run
 * against persistent role assignments, not a header.
 */
@Module({
  imports: [PlatformModule, TenantModule, IdentityModule, RbacModule, AuthModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route: the middleware itself exempts safe methods and requests with no session cookie.
    consumer.apply(CsrfMiddleware).forRoutes('*');
  }
}
