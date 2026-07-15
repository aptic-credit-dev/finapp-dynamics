import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.ts';

/**
 * The composition root.
 *
 * Stage 0 binds no kernel tokens: DB, AUDIT, AUTHZ and OUTBOX have no authoritative provider until the
 * modules that own them exist (m01/m02, m03, m06 — see docs/01-architecture/SHARED_SERVICE_OWNERSHIP.md).
 * Binding a stub here would be a duplicate shared service wearing a temporary hat, which is the failure
 * mode CLAUDE.md names as the most common one. They stay unbound until their owner lands in Stage 1.
 */
@Module({
  imports: [],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
