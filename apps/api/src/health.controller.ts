import { Controller, Get } from '@nestjs/common';

/**
 * Liveness only.
 *
 * Deliberately carries no `@Endpoint`: it is neither mutating nor tenant-scoped, so it has no permission
 * and no audit code. It reports that the process is up — not that the database is reachable, and not
 * anything about a tenant. A readiness probe that touches the database arrives with the database, in
 * Stage 1.
 */
@Controller('health')
export class HealthController {
  @Get()
  live(): { status: 'ok'; stage: number } {
    return { status: 'ok', stage: 0 };
  }
}
