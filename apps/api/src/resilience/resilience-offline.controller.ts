import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  OfflineService,
  ObservabilityService,
  M40_PERMISSIONS,
  M40_AUDIT_CODES,
} from '@finapp/m40-resilience';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { deviceView, offlineRequestView } from './views.ts';

/**
 * Mobile DEVICES + the governed OFFLINE queue + OPERATIONAL observability under `/api/v1/resilience`. THE LOAD-BEARING RULE: a
 * controlled offline request is finalized (applied) only after online re-validation (the current actor holds the required
 * permission + an authoritative downstream reference from the owning module); otherwise it is durably rejected. No endpoint
 * finalizes a controlled action offline. Reads carry no `@Endpoint` — the read permission is enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('resilience')
export class ResilienceOfflineController {
  private readonly offline: OfflineService;
  private readonly observability: ObservabilityService;
  private readonly actors: ActorContextFactory;
  constructor(offline: OfflineService, observability: ObservabilityService, actors: ActorContextFactory) {
    this.offline = offline;
    this.observability = observability;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M40_PERMISSIONS.deviceManage,
    auditCode: M40_AUDIT_CODES.deviceRegistered,
    description: 'Register a mobile device (bounded metadata only).',
  })
  @Post('devices')
  async registerDevice(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register device (m40)');
    const d = await this.offline.registerDevice(s.ctx, {
      deviceKey: requireString(b['deviceKey'], 'deviceKey', s.correlationId),
      ...optStr(b['platform'], 'platform'),
    });
    return deviceView(d);
  }

  @Get('devices')
  async listDevices(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse devices (m40)');
    const rows = await this.offline.listDevices(s.ctx);
    return { devices: rows.map(deviceView) };
  }

  @Endpoint({
    permission: M40_PERMISSIONS.deviceManage,
    auditCode: M40_AUDIT_CODES.deviceRevoked,
    description: 'Revoke a device.',
  })
  @Post('devices/:id/revoke')
  async revokeDevice(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'revoke device (m40)');
    return deviceView(
      await this.offline.revokeDevice(s.ctx, id, requireVersion(b['version'], s.correlationId)),
    );
  }

  @Endpoint({
    permission: M40_PERMISSIONS.offlineSync,
    auditCode: M40_AUDIT_CODES.offlineQueued,
    description: 'Queue an offline request (draft only — never finalized here).',
  })
  @Post('offline')
  async queueRequest(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'queue offline request (m40)');
    const req = await this.offline.queueRequest(s.ctx, {
      deviceId: requireString(b['deviceId'], 'deviceId', s.correlationId),
      requestKey: requireString(b['requestKey'], 'requestKey', s.correlationId),
      capabilityRef: requireString(b['capabilityRef'], 'capabilityRef', s.correlationId),
      requiredPermission: requireString(b['requiredPermission'], 'requiredPermission', s.correlationId),
      controlled: b['controlled'] === true,
      ...optStr(b['payloadRef'], 'payloadRef'),
      ...optStr(b['configSecretRef'], 'configSecretRef'),
    });
    return offlineRequestView(req);
  }

  @Endpoint({
    permission: M40_PERMISSIONS.offlineSync,
    auditCode: M40_AUDIT_CODES.offlineApplied,
    description: 'Finalize a queued request on reconnect (controlled actions require online re-validation).',
  })
  @Post('offline/:id/finalize')
  async finalizeRequest(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'finalize offline request (m40)');
    return this.offline.finalizeRequest(s.ctx, id, requireVersion(b['version'], s.correlationId), {
      ...optStr(b['downstreamRef'], 'downstreamRef'),
    });
  }

  @Get('offline/:id')
  async getRequest(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'read offline request (m40)');
    const r = await this.offline.getRequest(s.ctx, id);
    return r ? offlineRequestView(r) : { request: null };
  }

  @Endpoint({
    permission: M40_PERMISSIONS.backupManage,
    auditCode: M40_AUDIT_CODES.checkDefined,
    description: 'Define an operational observability check.',
  })
  @Post('observability/checks')
  async defineCheck(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'define check (m40)');
    return this.observability.defineCheck(s.ctx, {
      checkKey: requireString(b['checkKey'], 'checkKey', s.correlationId),
      component: requireString(b['component'], 'component', s.correlationId),
      ...optStr(b['signalKind'], 'signalKind'),
    });
  }

  @Endpoint({
    permission: M40_PERMISSIONS.backupManage,
    auditCode: M40_AUDIT_CODES.healthRecorded,
    description: 'Record a bounded operational signal.',
  })
  @Post('observability/signals')
  async recordSignal(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'record signal (m40)');
    return this.observability.recordSignal(s.ctx, {
      component: requireString(b['component'], 'component', s.correlationId),
      state: requireString(b['state'], 'state', s.correlationId),
      ...optStr(b['signalKind'], 'signalKind'),
      ...(typeof b['latencyMs'] === 'number' ? { latencyMs: b['latencyMs'] } : {}),
      ...optStr(b['resultCode'], 'resultCode'),
    });
  }
}
