import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint, ProblemError } from '@finapp/kernel';
import {
  // VALUE import (not `import type`): NestJS resolves the constructor dependency from design-time metadata.
  EvaluationService,
  M07_AUDIT_CODES,
  M07_PERMISSIONS,
} from '@finapp/m07-rules';
import { ActorContextFactory } from '@finapp/m02-identity';
import { optionalLimit, requireTenantScope } from '../identity/http.ts';
import { evaluationView } from './views.ts';

/**
 * Rule evaluation, replay, simulation and evidence, under `/api/v1/rules` (Stage 2.3).
 *
 * `evaluate` runs the ACTIVE version and records append-only evidence (input HASH + redacted outcome, never
 * raw inputs); it is idempotent per `idempotencyKey`. `replay` re-runs the ORIGINAL immutable version and
 * proves the same result — the caller re-supplies the input and its hash is verified against the evidence.
 * `simulate` is a permissioned dry-run that persists nothing. `export` is a separately-permissioned, audited
 * read. Permission is enforced in `EvaluationService`; the `@Endpoint` is the declaration.
 */

interface EvaluateBody {
  input?: unknown;
  idempotencyKey?: unknown;
  evaluatedAt?: unknown;
  subjectType?: unknown;
  subjectId?: unknown;
}
interface ReplayBody {
  input?: unknown;
  evaluatedAt?: unknown;
}
interface SimulateBody {
  input?: unknown;
  evaluatedAt?: unknown;
}

function requireObject(value: unknown, correlationId: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProblemError({
      type: 'https://finapp.dynamics/problems/validation',
      title: 'Bad Request',
      status: 400,
      detail: 'input is required and must be an object.',
      correlationId,
    });
  }
  return value as Record<string, unknown>;
}

@Controller('rules')
export class EvaluationsController {
  private readonly service: EvaluationService;
  private readonly actors: ActorContextFactory;

  constructor(service: EvaluationService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Endpoint({
    permission: M07_PERMISSIONS.engineEvaluate,
    auditCode: M07_AUDIT_CODES.evaluationExecuted,
    description: 'Evaluate the active version of a rule set (deterministic, explained, audited, idempotent).',
  })
  @Post('sets/:id/evaluate')
  async evaluate(
    @Param('id') id: string,
    @Body() body: EvaluateBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'evaluate rule set (m07)'));
    const cid = scoped.correlationId;
    const result = await this.service.evaluate(scoped.ctx, scoped.actor.identityId, {
      ruleSetId: id,
      input: requireObject(body.input, cid),
      ...(typeof body.idempotencyKey === 'string' ? { idempotencyKey: body.idempotencyKey } : {}),
      ...(typeof body.evaluatedAt === 'string' ? { evaluatedAt: body.evaluatedAt } : {}),
      ...(typeof body.subjectType === 'string' ? { subjectType: body.subjectType } : {}),
      ...(typeof body.subjectId === 'string' ? { subjectId: body.subjectId } : {}),
    });
    return {
      evaluation: evaluationView(result.evaluation),
      explanation: result.explanation,
      idempotent: result.idempotent,
    };
  }

  @Endpoint({
    permission: M07_PERMISSIONS.evaluationReplay,
    auditCode: M07_AUDIT_CODES.evaluationReplayed,
    description: 'Replay a recorded evaluation against its original version (hash-verified, non-mutating).',
  })
  @Post('evaluations/:id/replay')
  async replay(
    @Param('id') id: string,
    @Body() body: ReplayBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'replay evaluation (m07)'));
    const cid = scoped.correlationId;
    const result = await this.service.replay(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireObject(body.input, cid),
      typeof body.evaluatedAt === 'string' ? body.evaluatedAt : undefined,
    );
    return {
      original: evaluationView(result.original),
      replay: evaluationView(result.replay),
      matches: result.matches,
      explanation: result.explanation,
    };
  }

  @Endpoint({
    permission: M07_PERMISSIONS.engineSimulate,
    auditCode: M07_AUDIT_CODES.simulationExecuted,
    description: 'Dry-run a version against an input without recording governed evidence.',
  })
  @Post('versions/:id/simulate')
  async simulate(
    @Param('id') id: string,
    @Body() body: SimulateBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'simulate rule set (m07)'));
    const cid = scoped.correlationId;
    const result = await this.service.simulate(scoped.ctx, {
      versionId: id,
      input: requireObject(body.input, cid),
      ...(typeof body.evaluatedAt === 'string' ? { evaluatedAt: body.evaluatedAt } : {}),
    });
    return { outcome: result.outcome, explanation: result.explanation };
  }

  @Endpoint({
    permission: M07_PERMISSIONS.evaluationExport,
    auditCode: M07_AUDIT_CODES.exportRequested,
    description: 'Export a rule set’s decision evidence (separately permissioned, audited).',
  })
  @Post('sets/:id/evaluations/export')
  async exportEvaluations(
    @Param('id') id: string,
    @Query('limit') limit: string | undefined,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'export evaluations (m07)'));
    const { limit: cap } = optionalLimit(limit, scoped.correlationId);
    const rows = await this.service.exportEvaluations(scoped.ctx, id, cap ?? 200);
    return { evaluations: rows.map(evaluationView) };
  }

  // --- reads (rules.evaluation.view, enforced in the service) -----------------------------------
  @Get('evaluations/:id')
  async get(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'get evaluation (m07)'));
    return evaluationView(await this.service.getEvaluation(scoped.ctx, id));
  }

  @Get('sets/:id/evaluations')
  async list(
    @Param('id') id: string,
    @Query('limit') limit: string | undefined,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'list evaluations (m07)'));
    const { limit: cap } = optionalLimit(limit, scoped.correlationId);
    const rows = await this.service.listEvaluations(scoped.ctx, id, cap ?? 50);
    return { evaluations: rows.map(evaluationView) };
  }
}
