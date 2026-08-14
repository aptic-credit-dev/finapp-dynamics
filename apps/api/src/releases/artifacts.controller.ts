import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { ArtifactService, M37_PERMISSIONS, M37_AUDIT_CODES } from '@finapp/m37-govrelease';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope } from '../identity/http.ts';
import { artifactView, environmentView } from './views.ts';

/**
 * Governed ARTIFACTS + target ENVIRONMENTS under `/api/v1/releases`. Registering/retiring an artifact and defining an
 * environment are `govrelease.artifact.manage` actions. Reads carry no `@Endpoint` — the read permission is enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optBool<K extends string>(v: unknown, k: K): Partial<Record<K, boolean>> {
  return typeof v === 'boolean' ? ({ [k]: v } as Record<K, boolean>) : {};
}
function optNum<K extends string>(v: unknown, k: K): Partial<Record<K, number>> {
  return typeof v === 'number' ? ({ [k]: v } as Record<K, number>) : {};
}

@Controller('releases')
export class GovreleaseArtifactsController {
  private readonly artifacts: ArtifactService;
  private readonly actors: ActorContextFactory;
  constructor(artifacts: ArtifactService, actors: ActorContextFactory) {
    this.artifacts = artifacts;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M37_PERMISSIONS.artifactManage,
    auditCode: M37_AUDIT_CODES.artifactRegistered,
    description: 'Register a governed integration artifact (opaque owner reference).',
  })
  @Post('artifacts')
  async registerArtifact(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register release artifact (m37)');
    const a = await this.artifacts.registerArtifact(s.ctx, s.actor.identityId, {
      artifactKey: requireString(b['artifactKey'], 'artifactKey', s.correlationId),
      artifactKind: requireString(b['artifactKind'], 'artifactKind', s.correlationId),
      artifactRef: requireString(b['artifactRef'], 'artifactRef', s.correlationId),
      name: requireString(b['name'], 'name', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return artifactView(a);
  }

  @Get('artifacts')
  async listArtifacts(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse release artifacts (m37)');
    const rows = await this.artifacts.listArtifacts(s.ctx, {});
    return { artifacts: rows.map(artifactView) };
  }

  @Endpoint({
    permission: M37_PERMISSIONS.artifactManage,
    auditCode: M37_AUDIT_CODES.artifactRetired,
    description: 'Retire a governed artifact.',
  })
  @Post('artifacts/:id/retire')
  async retireArtifact(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'retire release artifact (m37)');
    const a = await this.artifacts.retireArtifact(s.ctx, s.actor.identityId, id);
    return artifactView(a);
  }

  @Endpoint({
    permission: M37_PERMISSIONS.artifactManage,
    auditCode: M37_AUDIT_CODES.environmentDefined,
    description: 'Define a target promotion environment.',
  })
  @Post('environments')
  async defineEnvironment(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'define release environment (m37)');
    const e = await this.artifacts.defineEnvironment(s.ctx, s.actor.identityId, {
      envKey: requireString(b['envKey'], 'envKey', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optNum(b['tier'], 'tier'),
      ...optBool(b['requiresApproval'], 'requiresApproval'),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return environmentView(e);
  }

  @Get('environments')
  async listEnvironments(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse release environments (m37)');
    const rows = await this.artifacts.listEnvironments(s.ctx, {});
    return { environments: rows.map(environmentView) };
  }
}
