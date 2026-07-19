import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { BootstrapService } from '@finapp/m02-rbac';
import { AppModule } from './app.module.ts';
import { ProblemFilter } from './problem.filter.ts';
import { loadAuthConfig } from './auth/config.ts';

/**
 * API host bootstrap. All external access is versioned under `/api/v1` (ADR-008).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();

  // FIRST-ADMINISTRATOR BOOTSTRAP (ADR-020), before the port opens. In production this FAILS CLOSED if
  // FINAPP_BOOTSTRAP_ADMIN_ACCOUNT is unset or names an inactive account — a platform with no way to
  // provision its first admin must not accept traffic. In dev/test with nothing configured it is a
  // documented no-op so the app still starts locally. It is idempotent: a restart re-grants nothing.
  const provision = await app.get(BootstrapService).run(randomUUID());
  console.log(`api: bootstrap — ${provision.reason}`);

  // Strict, credentialed CORS (ADR-015 §18): only the explicitly-approved browser origins, and NEVER a
  // wildcard with credentials. In production `loadAuthConfig` has already refused to boot without origins.
  const authConfig = loadAuthConfig();
  const enableCors = app as { enableCors: (options: Record<string, unknown>) => void };
  enableCors.enableCors({
    origin: authConfig.allowedOrigins.length > 0 ? [...authConfig.allowedOrigins] : false,
    credentials: true,
    // Stage 1D: x-permissions is GONE — permissions are resolved from persistent RBAC, never sent by a
    // client, so no such header is accepted. Identity and tenant travel by cookie and x-tenant-id.
    allowedHeaders: ['content-type', 'x-csrf-token', 'x-tenant-id', 'x-correlation-id'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  const port: number = Number.parseInt(process.env['API_PORT'] ?? '3000', 10);
  await app.listen(port);
  console.log(`api: listening on http://localhost:${port}/api/v1 (stage 1D — tenants, identity, auth, rbac)`);
}

await bootstrap();
