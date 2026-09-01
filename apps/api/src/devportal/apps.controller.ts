import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { AppService, M35_PERMISSIONS, M35_AUDIT_CODES } from '@finapp/m35-devportal';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope } from '../identity/http.ts';
import { appView, credentialView, issuedCredentialView, appDetailView, credentialMetaView } from './views.ts';

/**
 * Developer APPLICATIONS + API CREDENTIALS under `/api/v1/developer`. Registering/suspending an app is unprivileged;
 * issuing/rotating/revoking API credentials is privileged and HUMAN-governed (AI never issues). A credential response shows
 * the PUBLIC key id + status only; a freshly-issued/rotated credential returns its plaintext secret ONCE (never persisted).
 * Reads carry no `@Endpoint` — the read permission is enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('developer')
export class DevportalAppsController {
  private readonly apps: AppService;
  private readonly actors: ActorContextFactory;
  constructor(apps: AppService, actors: ActorContextFactory) {
    this.apps = apps;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M35_PERMISSIONS.appManage,
    auditCode: M35_AUDIT_CODES.appRegistered,
    description: 'Register a developer application.',
  })
  @Post('apps')
  async registerApp(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register developer app (m35)');
    const a = await this.apps.registerApp(s.ctx, s.actor.identityId, {
      appKey: requireString(b['appKey'], 'appKey', s.correlationId),
      name: requireString(b['name'], 'name', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optStr(b['homepageUrl'], 'homepageUrl'),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return appView(a);
  }

  @Get('apps')
  async listApps(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse developer apps (m35)');
    const rows = await this.apps.listApps(s.ctx, {});
    return { apps: rows.map(appView) };
  }

  @Get('apps/:id')
  async getApp(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'read developer app (m35)');
    const a = await this.apps.getAppRead(s.ctx, id);
    return { app: a === null ? null : appDetailView(a) };
  }

  /** An app's API-credential METADATA (never any secret material). Read permission enforced in-service (app.read). */
  @Get('apps/:id/credentials')
  async listAppCredentials(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse developer credentials (m35)');
    const rows = await this.apps.listCredentialsByApp(s.ctx, id);
    return { credentials: rows.map(credentialMetaView) };
  }

  @Endpoint({
    permission: M35_PERMISSIONS.appManage,
    auditCode: M35_AUDIT_CODES.appSuspended,
    description: 'Suspend a developer application.',
  })
  @Post('apps/:id/suspend')
  async suspendApp(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'suspend developer app (m35)');
    const a = await this.apps.suspendApp(s.ctx, s.actor.identityId, id);
    return appView(a);
  }

  @Endpoint({
    permission: M35_PERMISSIONS.credentialManage,
    auditCode: M35_AUDIT_CODES.credentialIssued,
    description: 'Issue an API credential (human-governed; returns the plaintext secret once).',
  })
  @Post('apps/:id/credentials')
  async issueCredential(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'issue developer credential (m35)');
    const issued = await this.apps.issueCredential(s.ctx, s.actor.identityId, id, {
      ...optStr(b['purpose'], 'purpose'),
      ...optStr(b['secretRef'], 'secretRef'),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return issuedCredentialView(issued);
  }

  @Endpoint({
    permission: M35_PERMISSIONS.credentialManage,
    auditCode: M35_AUDIT_CODES.credentialRotated,
    description: 'Rotate an API credential (human-governed; returns the new plaintext secret once).',
  })
  @Post('credentials/:id/rotate')
  async rotateCredential(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'rotate developer credential (m35)');
    const issued = await this.apps.rotateCredential(s.ctx, s.actor.identityId, id);
    return issuedCredentialView(issued);
  }

  @Endpoint({
    permission: M35_PERMISSIONS.credentialManage,
    auditCode: M35_AUDIT_CODES.credentialRevoked,
    description: 'Revoke an API credential (human-governed).',
  })
  @Post('credentials/:id/revoke')
  async revokeCredential(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'revoke developer credential (m35)');
    const c = await this.apps.revokeCredential(s.ctx, s.actor.identityId, id);
    return credentialView(c);
  }
}
