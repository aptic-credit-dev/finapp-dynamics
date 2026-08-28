import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  SecretService,
  DlpService,
  GovernanceService,
  M41_PERMISSIONS,
  M41_AUDIT_CODES,
} from '@finapp/m41-security';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import {
  secretView,
  secretDetailView,
  secretVersionView,
  revealView,
  secretProviderStatusView,
  dlpPolicyView,
  dlpPolicyListView,
  dlpFindingView,
  incidentView,
} from './views.ts';

/**
 * Secrets / keys / reveal / DLP / SOC under `/api/v1/security`. Secret rotate/reveal/destroy are privileged maker-checker
 * controlled actions (a human approver != the requester; AI/system/automation refused). NO secret material is ever returned —
 * a secret exposes only its opaque secret_ref; a reveal grants access but returns no value (the provider is unavailable).
 * There is NO secret-material download endpoint. Reads carry no `@Endpoint` — the read permission is enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('security')
export class SecurityController {
  private readonly secrets: SecretService;
  private readonly dlp: DlpService;
  private readonly governance: GovernanceService;
  private readonly actors: ActorContextFactory;
  constructor(
    secrets: SecretService,
    dlp: DlpService,
    governance: GovernanceService,
    actors: ActorContextFactory,
  ) {
    this.secrets = secrets;
    this.dlp = dlp;
    this.governance = governance;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M41_PERMISSIONS.secretManage,
    auditCode: M41_AUDIT_CODES.secretDefined,
    description: 'Define a secret/key (metadata; opaque secretref + approved algorithm; no value).',
  })
  @Post('secrets')
  async defineSecret(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'define secret (m41)');
    const secret = await this.secrets.defineSecret(s.ctx, {
      secretKey: requireString(b['secretKey'], 'secretKey', s.correlationId),
      secretRef: requireString(b['secretRef'], 'secretRef', s.correlationId),
      ...optStr(b['materialKind'], 'materialKind'),
      ...optStr(b['scope'], 'scope'),
      ...optStr(b['algorithm'], 'algorithm'),
    });
    return secretView(secret);
  }

  @Get('secrets')
  async listSecrets(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse secrets (m41)');
    const rows = await this.secrets.listSecrets(s.ctx);
    return { secrets: rows.map(secretView) };
  }

  // Read-only admin console (permission security.secret.read, enforced in-service; RLS-scoped; no @Endpoint — reads
  // are not audited). Detail / rotation-version history / reveal-grant history / provider health — METADATA ONLY. No
  // route here returns secret material, and there is NO secret-material download endpoint anywhere.
  @Get('secrets/:id')
  async getSecret(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get secret (m41)');
    const secret = await this.secrets.getSecretDetail(s.ctx, id);
    return { secret: secret ? secretDetailView(secret) : null };
  }

  @Get('secrets/:id/versions')
  async listSecretVersions(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list secret versions (m41)');
    return { versions: (await this.secrets.listSecretVersions(s.ctx, id)).map(secretVersionView) };
  }

  @Get('secrets/:id/reveals')
  async listSecretReveals(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list secret reveal grants (m41)');
    return { reveals: (await this.secrets.listReveals(s.ctx, id)).map(revealView) };
  }

  @Get('secrets/:id/provider-status')
  async getSecretProviderStatus(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get secret provider status (m41)');
    return secretProviderStatusView(await this.secrets.getSecretProviderStatus(s.ctx, id));
  }

  @Endpoint({
    permission: M41_PERMISSIONS.secretRotate,
    auditCode: M41_AUDIT_CODES.secretActivated,
    description: 'Activate a secret/key (maker-checker; independent human approver).',
  })
  @Post('secrets/:id/activate')
  async activate(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'activate secret (m41)');
    const secret = await this.secrets.activateSecret(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['version'], s.correlationId),
      {
        requestedBy: requireString(b['requestedBy'], 'requestedBy', s.correlationId),
      },
    );
    return secretView(secret);
  }

  @Endpoint({
    permission: M41_PERMISSIONS.secretRotate,
    auditCode: M41_AUDIT_CODES.secretRotated,
    description: 'Rotate a secret/key (race-safe; maker-checker).',
  })
  @Post('secrets/:id/rotate')
  async rotate(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'rotate secret (m41)');
    const secret = await this.secrets.rotateSecret(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['version'], s.correlationId),
      {
        requestedBy: requireString(b['requestedBy'], 'requestedBy', s.correlationId),
      },
    );
    return secretView(secret);
  }

  @Endpoint({
    permission: M41_PERMISSIONS.secretRotate,
    auditCode: M41_AUDIT_CODES.secretRevoked,
    description: 'Revoke a secret/key (maker-checker).',
  })
  @Post('secrets/:id/revoke')
  async revoke(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'revoke secret (m41)');
    const secret = await this.secrets.revokeSecret(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['version'], s.correlationId),
      {
        requestedBy: requireString(b['requestedBy'], 'requestedBy', s.correlationId),
      },
    );
    return secretView(secret);
  }

  @Endpoint({
    permission: M41_PERMISSIONS.secretDestroy,
    auditCode: M41_AUDIT_CODES.secretDestroyed,
    description:
      'Destroy a secret/key (maker-checker; material crypto-destroyed via the fail-closed provider).',
  })
  @Post('secrets/:id/destroy')
  async destroy(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'destroy secret (m41)');
    const secret = await this.secrets.destroySecret(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['version'], s.correlationId),
      {
        requestedBy: requireString(b['requestedBy'], 'requestedBy', s.correlationId),
      },
    );
    return secretView(secret);
  }

  @Endpoint({
    permission: M41_PERMISSIONS.secretReveal,
    auditCode: M41_AUDIT_CODES.revealGranted,
    description: 'Grant a plaintext reveal (privileged; maker-checker; no material returned).',
  })
  @Post('secrets/:id/reveal')
  async reveal(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reveal secret (m41)');
    return this.secrets.requestReveal(s.ctx, s.actor.identityId, id, {
      requestedBy: requireString(b['requestedBy'], 'requestedBy', s.correlationId),
      purpose: requireString(b['purpose'], 'purpose', s.correlationId),
    });
  }

  @Endpoint({
    permission: M41_PERMISSIONS.dlpManage,
    auditCode: M41_AUDIT_CODES.dlpPolicySet,
    description: 'Set a DLP policy (classification -> action).',
  })
  @Post('dlp/policies')
  async setDlpPolicy(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'set dlp policy (m41)');
    const p = await this.dlp.setPolicy(s.ctx, {
      policyKey: requireString(b['policyKey'], 'policyKey', s.correlationId),
      classification: requireString(b['classification'], 'classification', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optStr(b['action'], 'action'),
    });
    return dlpPolicyView(p);
  }

  @Endpoint({
    permission: M41_PERMISSIONS.dlpManage,
    auditCode: M41_AUDIT_CODES.incidentRecorded,
    description: 'Record a security incident (SOC evidence).',
  })
  @Post('incidents')
  async recordIncident(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'record incident (m41)');
    return this.governance.recordIncident(s.ctx, {
      incidentKey: requireString(b['incidentKey'], 'incidentKey', s.correlationId),
      category: requireString(b['category'], 'category', s.correlationId),
      ...optStr(b['severity'], 'severity'),
    });
  }

  // Read surface (permission security.dlp.read, enforced in-service; RLS-scoped; no @Endpoint — reads are not
  // audited). DLP findings are auto-generated append-only decision evidence — READ-ONLY (no update/remediation).
  @Get('dlp/policies')
  async listDlpPolicies(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list dlp policies (m41)');
    return { policies: (await this.dlp.listPolicies(s.ctx)).map(dlpPolicyListView) };
  }

  @Get('dlp/policies/:id')
  async getDlpPolicy(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get dlp policy (m41)');
    const p = await this.dlp.getPolicy(s.ctx, id);
    return { policy: p ? dlpPolicyListView(p) : null };
  }

  @Get('dlp/findings')
  async listDlpFindings(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list dlp findings (m41)');
    return { findings: (await this.dlp.listFindings(s.ctx)).map(dlpFindingView) };
  }

  @Get('incidents')
  async listIncidents(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list incidents (m41)');
    return { incidents: (await this.governance.listIncidents(s.ctx)).map(incidentView) };
  }

  @Get('incidents/:id')
  async getIncident(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get incident (m41)');
    return incidentView(await this.governance.getIncident(s.ctx, id));
  }
}
