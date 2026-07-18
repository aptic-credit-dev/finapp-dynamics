import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
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

  // Strict, credentialed CORS (ADR-015 §18): only the explicitly-approved browser origins, and NEVER a
  // wildcard with credentials. In production `loadAuthConfig` has already refused to boot without origins.
  const authConfig = loadAuthConfig();
  const enableCors = app as { enableCors: (options: Record<string, unknown>) => void };
  enableCors.enableCors({
    origin: authConfig.allowedOrigins.length > 0 ? [...authConfig.allowedOrigins] : false,
    credentials: true,
    // Note: the temporary x-permissions header (Stage 1D debt) is intentionally NOT listed — it is a dev
    // stopgap read in exactly one file, not a header real browser clients should send.
    allowedHeaders: ['content-type', 'x-csrf-token', 'x-tenant-id', 'x-correlation-id'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  const port: number = Number.parseInt(process.env['API_PORT'] ?? '3000', 10);
  await app.listen(port);
  console.log(`api: listening on http://localhost:${port}/api/v1 (stage 1A — health + tenants)`);
}

await bootstrap();
