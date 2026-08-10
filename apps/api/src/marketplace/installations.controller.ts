import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { InstallationService, M34_PERMISSIONS, M34_AUDIT_CODES } from '@finapp/m34-marketplace';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope } from '../identity/http.ts';
import { installationView, consentView, secretView, upgradeView } from './views.ts';

/**
 * Marketplace INSTALLATIONS under `/api/v1/connectors`. Installing (config screened for raw secrets) + attaching opaque
 * secret references + upgrading are privileged; CONSENT (human-granted, revocable) is privileged. Every route authorizes a
 * `marketplace.*` permission.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('connectors')
export class MarketplaceInstallationsController {
  private readonly installs: InstallationService;
  private readonly actors: ActorContextFactory;
  constructor(installs: InstallationService, actors: ActorContextFactory) {
    this.installs = installs;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M34_PERMISSIONS.installManage,
    auditCode: M34_AUDIT_CODES.installRequested,
    description: 'Request an installation of a published listing.',
  })
  @Post('installations')
  async requestInstall(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'request marketplace installation (m34)');
    const i = await this.installs.requestInstall(s.ctx, s.actor.identityId, {
      listingId: requireString(b['listingId'], 'listingId', s.correlationId),
      installKey: requireString(b['installKey'], 'installKey', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      config: b['config'] ?? {},
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return installationView(i);
  }

  @Endpoint({
    permission: M34_PERMISSIONS.consentManage,
    auditCode: M34_AUDIT_CODES.consentGranted,
    description: 'Grant human consent to an installation and activate it.',
  })
  @Post('installations/consent')
  async grantConsent(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'grant marketplace consent (m34)');
    const installationId = requireString(b['installationId'], 'installationId', s.correlationId);
    const scopes = Array.isArray(b['scopes']) ? (b['scopes'] as string[]) : [];
    const c = await this.installs.grantConsent(s.ctx, s.actor.identityId, installationId, {
      scopes,
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return consentView(c);
  }

  @Endpoint({
    permission: M34_PERMISSIONS.consentManage,
    auditCode: M34_AUDIT_CODES.consentRevoked,
    description: 'Revoke consent (suspends the installation).',
  })
  @Post('installations/consent/revoke')
  async revokeConsent(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'revoke marketplace consent (m34)');
    const installationId = requireString(b['installationId'], 'installationId', s.correlationId);
    const i = await this.installs.revokeConsent(s.ctx, s.actor.identityId, installationId);
    return installationView(i);
  }

  @Endpoint({
    permission: M34_PERMISSIONS.installManage,
    auditCode: M34_AUDIT_CODES.installSecretSet,
    description: 'Attach an opaque secret reference to an installation (secretref: only).',
  })
  @Post('installations/secrets')
  async setSecret(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'set installation secret (m34)');
    const installationId = requireString(b['installationId'], 'installationId', s.correlationId);
    const secret = await this.installs.setSecret(s.ctx, s.actor.identityId, installationId, {
      purpose: requireString(b['purpose'], 'purpose', s.correlationId),
      secretRef: requireString(b['secretRef'], 'secretRef', s.correlationId),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return secretView(secret);
  }

  @Endpoint({
    permission: M34_PERMISSIONS.upgradeApply,
    auditCode: M34_AUDIT_CODES.upgradeApplied,
    description: 'Apply an upgrade (maker-checker; approver != install requester).',
  })
  @Post('installations/upgrade')
  async applyUpgrade(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'apply marketplace upgrade (m34)');
    const installationId = requireString(b['installationId'], 'installationId', s.correlationId);
    const toVersion = typeof b['toVersion'] === 'number' ? b['toVersion'] : 0;
    const u = await this.installs.applyUpgrade(s.ctx, s.actor.identityId, installationId, { toVersion });
    return upgradeView(u);
  }
}
