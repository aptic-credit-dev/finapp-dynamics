import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { ConnectionService, RunService, M33_PERMISSIONS, M33_AUDIT_CODES } from '@finapp/m33-integration';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope } from '../identity/http.ts';
import { connectionView, secretView, runView } from './views.ts';

/**
 * Integration CONNECTIONS + RUNS under `/api/v1/integration`. Managing a connection (including attaching OPAQUE secret
 * references — never a value) is privileged; executing a connector run (framework-only, fail-closed — external access) is
 * privileged. Every route authorizes an `integration.*` permission.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('integration')
export class IntegrationConnectionsController {
  private readonly connections: ConnectionService;
  private readonly runs: RunService;
  private readonly actors: ActorContextFactory;
  constructor(connections: ConnectionService, runs: RunService, actors: ActorContextFactory) {
    this.connections = connections;
    this.runs = runs;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M33_PERMISSIONS.connectionManage,
    auditCode: M33_AUDIT_CODES.connectionCreated,
    description: 'Create a connection (config screened for raw secret values).',
  })
  @Post('connections')
  async createConnection(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create connection (m33)');
    const c = await this.connections.createConnection(s.ctx, s.actor.identityId, {
      connectorId: requireString(b['connectorId'], 'connectorId', s.correlationId),
      connectionKey: requireString(b['connectionKey'], 'connectionKey', s.correlationId),
      name: requireString(b['name'], 'name', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      config: b['config'] ?? {},
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return connectionView(c);
  }

  @Endpoint({
    permission: M33_PERMISSIONS.connectionManage,
    auditCode: M33_AUDIT_CODES.connectionSecretSet,
    description: 'Attach an opaque secret reference to a connection (secretref: only).',
  })
  @Post('connections/:id/secrets')
  async setSecret(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'set connection secret (m33)');
    const connectionId = requireString(b['connectionId'], 'connectionId', s.correlationId);
    const secret = await this.connections.setSecret(s.ctx, s.actor.identityId, connectionId, {
      purpose: requireString(b['purpose'], 'purpose', s.correlationId),
      secretRef: requireString(b['secretRef'], 'secretRef', s.correlationId),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return secretView(secret);
  }

  @Endpoint({
    permission: M33_PERMISSIONS.runExecute,
    auditCode: M33_AUDIT_CODES.runStarted,
    description: 'Execute a connector capability (framework-only, fail-closed).',
  })
  @Post('runs')
  async executeRun(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'execute connector run (m33)');
    const run = await this.runs.executeRun(s.ctx, s.actor.identityId, {
      connectionId: requireString(b['connectionId'], 'connectionId', s.correlationId),
      capabilityId: requireString(b['capabilityId'], 'capabilityId', s.correlationId),
      ...optStr(b['direction'], 'direction'),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return runView(run);
  }
}
