import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import { ProblemFilter } from './problem.filter.ts';

/**
 * API host bootstrap. All external access is versioned under `/api/v1` (ADR-008).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();

  const port: number = Number.parseInt(process.env['API_PORT'] ?? '3000', 10);
  await app.listen(port);
  console.log(`api: listening on http://localhost:${port}/api/v1 (stage 1A — health + tenants)`);
}

await bootstrap();
