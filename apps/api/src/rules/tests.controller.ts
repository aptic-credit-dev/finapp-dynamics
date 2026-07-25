import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint, ProblemError } from '@finapp/kernel';
import {
  // VALUE import (not `import type`): NestJS resolves the constructor dependency from design-time metadata.
  TestService,
  M07_AUDIT_CODES,
  M07_PERMISSIONS,
} from '@finapp/m07-rules';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope } from '../identity/http.ts';
import { testCaseView } from './views.ts';

/**
 * Stored rule test cases + suite runs, under `/api/v1/rules` (Stage 2.3). A test case pins a synthetic input
 * and expected outputs; running the suite evaluates each enabled case against a version (default ACTIVE) and
 * actually asserts. Permission is enforced in `TestService`; the `@Endpoint` is the declaration.
 */

interface CreateTestBody {
  name?: unknown;
  description?: unknown;
  input?: unknown;
  expected?: unknown;
}
interface RunBody {
  versionId?: unknown;
}

function requireObject(value: unknown, field: string, correlationId: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProblemError({
      type: 'https://finapp.dynamics/problems/validation',
      title: 'Bad Request',
      status: 400,
      detail: `${field} is required and must be an object.`,
      correlationId,
    });
  }
  return value as Record<string, unknown>;
}

@Controller('rules')
export class TestsController {
  private readonly service: TestService;
  private readonly actors: ActorContextFactory;

  constructor(service: TestService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Endpoint({
    permission: M07_PERMISSIONS.engineTest,
    auditCode: M07_AUDIT_CODES.testCreated,
    description: 'Create a stored test case for a rule set.',
  })
  @Post('sets/:id/tests')
  async create(
    @Param('id') id: string,
    @Body() body: CreateTestBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'create rule test (m07)'));
    const cid = scoped.correlationId;
    const row = await this.service.createTestCase(scoped.ctx, scoped.actor.identityId, {
      ruleSetId: id,
      name: requireString(body.name, 'name', cid),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      input: requireObject(body.input, 'input', cid),
      expected: requireObject(body.expected, 'expected', cid),
    });
    return testCaseView(row);
  }

  @Endpoint({
    permission: M07_PERMISSIONS.engineTest,
    auditCode: M07_AUDIT_CODES.testExecuted,
    description: 'Run all enabled test cases for a rule set against a version.',
  })
  @Post('sets/:id/tests/run')
  async run(@Param('id') id: string, @Body() body: RunBody, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'run rule tests (m07)'));
    const result = await this.service.runTests(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      typeof body.versionId === 'string' ? body.versionId : undefined,
    );
    return result;
  }

  @Get('sets/:id/tests')
  async list(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'list rule tests (m07)'));
    const rows = await this.service.listTestCases(scoped.ctx, id);
    return { testCases: rows.map(testCaseView) };
  }
}
