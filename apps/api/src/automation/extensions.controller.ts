import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { ExtensionService, M38_PERMISSIONS, M38_AUDIT_CODES } from '@finapp/m38-automation';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { extensionView, installationView } from './views.ts';

/**
 * Extension REGISTRY + POINTS + INSTALLATIONS under `/api/v1/extensions`. Authoring/declaring extension points is
 * unprivileged; PUBLICATION (a controlled maker-checker action, trust-tier bearing) is privileged and audited; installing/
 * disabling is a tenant action. An extension point is a REGISTERED capability reference (no arbitrary code loading). Reads
 * carry no `@Endpoint` — the read permission is enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('extensions')
export class ExtensionsController {
  private readonly extensions: ExtensionService;
  private readonly actors: ActorContextFactory;
  constructor(extensions: ExtensionService, actors: ActorContextFactory) {
    this.extensions = extensions;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M38_PERMISSIONS.extensionManage,
    auditCode: M38_AUDIT_CODES.extensionDefined,
    description: 'Register an extension (trust tier + isolation level; draft).',
  })
  @Post()
  async defineExtension(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register extension (m38)');
    const e = await this.extensions.defineExtension(s.ctx, s.actor.identityId, {
      extensionKey: requireString(b['extensionKey'], 'extensionKey', s.correlationId),
      name: requireString(b['name'], 'name', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optStr(b['trustTier'], 'trustTier'),
      ...optStr(b['isolationLevel'], 'isolationLevel'),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return extensionView(e);
  }

  @Get()
  async listExtensions(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse extensions (m38)');
    const rows = await this.extensions.listExtensions(s.ctx, {});
    return { extensions: rows.map(extensionView) };
  }

  @Endpoint({
    permission: M38_PERMISSIONS.extensionManage,
    auditCode: M38_AUDIT_CODES.extensionPointAdded,
    description: 'Declare a registered extension point + the m02 permission it requires.',
  })
  @Post(':id/points')
  async addPoint(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add extension point (m38)');
    const p = await this.extensions.addPoint(s.ctx, s.actor.identityId, id, {
      pointKey: requireString(b['pointKey'], 'pointKey', s.correlationId),
      capabilityRef: requireString(b['capabilityRef'], 'capabilityRef', s.correlationId),
      requiredPermission: requireString(b['requiredPermission'], 'requiredPermission', s.correlationId),
    });
    return { id: p.id };
  }

  @Endpoint({
    permission: M38_PERMISSIONS.extensionManage,
    auditCode: M38_AUDIT_CODES.extensionReviewRequested,
    description: 'Validate an extension and send for review.',
  })
  @Post(':id/validate')
  async validateExtension(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'validate extension (m38)');
    const out = await this.extensions.validateExtensionById(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return { passed: out.passed, reasonCode: out.reasonCode };
  }

  @Endpoint({
    permission: M38_PERMISSIONS.extensionPublish,
    auditCode: M38_AUDIT_CODES.extensionPublished,
    description: 'Publish an extension (maker-checker; approver != requester, human).',
  })
  @Post(':id/publish')
  async publishExtension(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish extension (m38)');
    const e = await this.extensions.publishExtension(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return extensionView(e);
  }

  @Endpoint({
    permission: M38_PERMISSIONS.extensionInstall,
    auditCode: M38_AUDIT_CODES.extensionInstalled,
    description: 'Install/enable a published extension for the tenant.',
  })
  @Post(':id/install')
  async installExtension(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'install extension (m38)');
    const i = await this.extensions.installExtension(s.ctx, s.actor.identityId, id, {
      installKey: requireString(b['installKey'], 'installKey', s.correlationId),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return installationView(i);
  }

  @Endpoint({
    permission: M38_PERMISSIONS.extensionInstall,
    auditCode: M38_AUDIT_CODES.extensionDisabled,
    description: 'Disable an extension installation.',
  })
  @Post('installations/:id/disable')
  async disableInstallation(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'disable extension installation (m38)');
    const i = await this.extensions.disableInstallation(s.ctx, s.actor.identityId, id);
    return installationView(i);
  }
}
