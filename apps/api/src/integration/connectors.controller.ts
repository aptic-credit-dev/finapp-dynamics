import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { ConnectorService, M33_PERMISSIONS, M33_AUDIT_CODES } from '@finapp/m33-integration';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { connectorView, capabilityView } from './views.ts';

/**
 * Integration CONNECTORS under `/api/v1/integration` — the governed connector SDK/registry. Authoring + capability
 * registration are unprivileged; connector PUBLICATION (a controlled maker-checker action) is privileged and audited.
 * Reads carry no `@Endpoint` — the read permission is enforced in-service (default deny).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('integration')
export class IntegrationConnectorsController {
  private readonly connectors: ConnectorService;
  private readonly actors: ActorContextFactory;
  constructor(connectors: ConnectorService, actors: ActorContextFactory) {
    this.connectors = connectors;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M33_PERMISSIONS.connectorAuthor,
    auditCode: M33_AUDIT_CODES.connectorDefined,
    description: 'Define a connector (SDK entry, draft).',
  })
  @Post('connectors')
  async defineConnector(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'define connector (m33)');
    const c = await this.connectors.defineConnector(s.ctx, s.actor.identityId, {
      connectorKey: requireString(b['connectorKey'], 'connectorKey', s.correlationId),
      name: requireString(b['name'], 'name', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optStr(b['vendor'], 'vendor'),
      ...optStr(b['category'], 'category'),
      ...optStr(b['authKind'], 'authKind'),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return connectorView(c);
  }

  @Get('connectors')
  async listConnectors(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list connectors (m33)');
    const rows = await this.connectors.listConnectors(s.ctx, {});
    return { connectors: rows.map(connectorView) };
  }

  @Endpoint({
    permission: M33_PERMISSIONS.connectorAuthor,
    auditCode: M33_AUDIT_CODES.capabilityRegistered,
    description: 'Register a governed capability on a connector.',
  })
  @Post('connectors/:id/capabilities')
  async registerCapability(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'register connector capability (m33)');
    const cap = await this.connectors.registerCapability(s.ctx, s.actor.identityId, id, {
      capabilityKey: requireString(b['capabilityKey'], 'capabilityKey', s.correlationId),
      name: requireString(b['name'], 'name', s.correlationId),
      ...optStr(b['direction'], 'direction'),
      ...optStr(b['kind'], 'kind'),
      inputSchema: b['inputSchema'] ?? {},
    });
    return capabilityView(cap);
  }

  @Endpoint({
    permission: M33_PERMISSIONS.connectorAuthor,
    auditCode: M33_AUDIT_CODES.connectorValidated,
    description: 'Validate a connector definition.',
  })
  @Post('connectors/:id/validate')
  async validateConnector(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'validate connector (m33)');
    const out = await this.connectors.validateConnector(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return { passed: out.passed, findings: out.findings };
  }

  @Endpoint({
    permission: M33_PERMISSIONS.connectorAuthor,
    auditCode: M33_AUDIT_CODES.reviewRequested,
    description: 'Send a validated connector for review.',
  })
  @Post('connectors/:id/review')
  async reviewConnector(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'request connector review (m33)');
    const c = await this.connectors.requestReview(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return connectorView(c);
  }

  @Endpoint({
    permission: M33_PERMISSIONS.connectorPublish,
    auditCode: M33_AUDIT_CODES.connectorPublished,
    description: 'Publish a connector (maker-checker; approver != author).',
  })
  @Post('connectors/:id/publish')
  async publishConnector(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish connector (m33)');
    const c = await this.connectors.publishConnector(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return connectorView(c);
  }

  @Get('connectors/:id/capabilities')
  async listCapabilities(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list connector capabilities (m33)');
    const rows = await this.connectors.listCapabilities(s.ctx, id);
    return { capabilities: rows.map(capabilityView) };
  }
}
