import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.ts';
import { TenantModule } from './tenant/tenant.module.ts';

/**
 * The composition root.
 *
 * Stage 0 bound no kernel tokens at all. Stage 1A brings the first module, and with it the first real
 * binding of `DB` — plus clearly-marked stand-ins for `AUTHZ`/`AUDIT`/`OUTBOX`, whose owning modules
 * (m02, m03, m06) do not exist yet. See tenant/tenant.module.ts.
 *
 * The API now requires a database at boot: `DATABASE_URL` is mandatory, and the process fails to start
 * without it rather than discovering the problem on a user's first request.
 */
@Module({
  imports: [TenantModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
