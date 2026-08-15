/**
 * OfflineService — mobile devices + THE GOVERNED OFFLINE QUEUE. A client registers a device, then DRAFTS/QUEUES an intended
 * operation (referencing a registered capability + the m02 permission it requires). THE LOAD-BEARING RULE: a CONTROLLED offline
 * request can only be FINALIZED (applied) after ONLINE re-validation — the current online actor must hold the required
 * permission AND the owning module must have authorized it (evidenced by an authoritative downstream reference m40 does NOT
 * manufacture) AND the request must not have expired. A controlled offline finalization without those FAILS CLOSED (durably
 * rejected). m40 never auto-finalizes on reconnect and trusts no stale offline authorization. The DB additionally enforces
 * `sync_state='applied' => validated_online` (finalize_ck). Every mutation authorizes a `resilience.*` permission (default deny)
 * and is audited through m03 in the same transaction.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M40_PERMISSIONS } from './permissions.ts';
import { M40_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, notFound, versionConflict } from './errors.ts';
import {
  evaluateOfflineFinalization,
  validateOfflineRequest,
  isSecretReference,
  clampPage,
} from './domain.ts';
import { ResilienceRepository, type DeviceRow, type OfflineRequestRow } from './repository.ts';
import type { M40Emitter } from './emit.ts';

export class OfflineService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M40Emitter;
  private readonly repo: ResilienceRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M40Emitter,
    repo: ResilienceRepository = new ResilienceRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async registerDevice(
    ctx: RequestContext,
    input: { deviceKey: string; platform?: string; actorRef?: string | null },
  ): Promise<DeviceRow> {
    await this.authz.require(ctx, M40_PERMISSIONS.deviceManage);
    if (!input.deviceKey) throw badRequest('deviceKey is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const device = await this.repo.insertDevice(tx, {
        tenantId: ctx.tenantId,
        deviceKey: input.deviceKey,
        platform: input.platform ?? 'unknown',
        actorRef: input.actorRef ?? null,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      // A device is registered on enrolment; a real trust workflow can drop in later.
      const registered = await this.repo.updateDeviceState(
        tx,
        device.id,
        device.version,
        'registered',
        ctx.userId ?? null,
      );
      const final = registered ?? device;
      await this.emitter.recordAudit(tx, ctx, {
        code: M40_AUDIT_CODES.deviceRegistered,
        entityType: 'resilience_device',
        entityId: final.id,
        detail: { deviceKey: input.deviceKey, platform: final.platform },
      });
      await this.emitter.publishMobile(tx, 'DeviceRegistered', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: { recordId: final.id, deviceId: final.id, toState: 'registered' },
      });
      return final;
    });
  }

  async revokeDevice(ctx: RequestContext, id: string, expectedVersion: number): Promise<DeviceRow> {
    await this.authz.require(ctx, M40_PERMISSIONS.deviceManage);
    return this.db.withTenant(ctx, async (tx) => {
      const updated = await this.repo.updateDeviceState(
        tx,
        id,
        expectedVersion,
        'revoked',
        ctx.userId ?? null,
      );
      if (!updated) throw versionConflict(ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M40_AUDIT_CODES.deviceRevoked,
        entityType: 'resilience_device',
        entityId: id,
        detail: { deviceKey: updated.device_key },
      });
      await this.emitter.publishMobile(tx, 'DeviceRevoked', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: { recordId: id, deviceId: id, toState: 'revoked' },
      });
      return updated;
    });
  }

  /** Queue an offline request (DRAFT only — never finalized here). `controlled` marks a controlled downstream action. */
  async queueRequest(
    ctx: RequestContext,
    input: {
      deviceId: string;
      requestKey: string;
      capabilityRef: string;
      requiredPermission: string;
      controlled?: boolean;
      payloadRef?: string | null;
      configSecretRef?: string | null;
      expiresAt?: Date | null;
    },
  ): Promise<OfflineRequestRow> {
    await this.authz.require(ctx, M40_PERMISSIONS.offlineSync);
    const check = validateOfflineRequest({
      capabilityRef: input.capabilityRef,
      requiredPermission: input.requiredPermission,
      configSecretRef: input.configSecretRef ?? null,
    });
    if (!check.passed)
      throw badRequest(`invalid offline request (${check.findings[0]?.ref}).`, ctx.correlationId);
    if (input.configSecretRef != null && !isSecretReference(input.configSecretRef))
      throw badRequest('config secret must be an opaque secretref.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const device = await this.repo.getDevice(tx, input.deviceId);
      if (device?.trust_state !== 'registered')
        throw badRequest('the device is not registered.', ctx.correlationId);
      const request = await this.repo.insertOfflineRequest(tx, {
        tenantId: ctx.tenantId,
        deviceId: input.deviceId,
        requestKey: input.requestKey,
        capabilityRef: input.capabilityRef,
        requiredPermission: input.requiredPermission,
        controlled: input.controlled ?? false,
        payloadRef: input.payloadRef ?? null,
        configSecretRef: input.configSecretRef ?? null,
        expiresAt: input.expiresAt ?? null,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M40_AUDIT_CODES.offlineQueued,
        entityType: 'resilience_offline_request',
        entityId: request.id,
        detail: { capabilityRef: input.capabilityRef, controlled: request.controlled },
      });
      return request;
    });
  }

  /**
   * Finalize a queued request on reconnect (ONLINE). A CONTROLLED action is APPLIED only when the current online actor holds
   * the required permission AND the owning module authorized it (an authoritative `downstreamRef` that m40 does NOT
   * manufacture) AND it has not expired; otherwise it is durably REJECTED (fail closed). m40 executes no downstream action —
   * it records the authoritative reference the owning module produced.
   */
  async finalizeRequest(
    ctx: RequestContext,
    id: string,
    expectedVersion: number,
    input: { downstreamRef?: string | null },
  ): Promise<{ syncState: string; reasonCode: string }> {
    await this.authz.require(ctx, M40_PERMISSIONS.offlineSync);
    return this.db.withTenant(ctx, async (tx) => {
      const request = await this.repo.getOfflineRequest(tx, id);
      if (!request) throw notFound('offline request not found.', ctx.correlationId);
      if (request.sync_state !== 'queued' && request.sync_state !== 'validating')
        throw badRequest('the request is not in a finalizable state.', ctx.correlationId);
      const downstreamRef = input.downstreamRef ?? null;
      const gate = evaluateOfflineFinalization({
        controlled: request.controlled,
        // Online re-validation is evidenced by an authoritative downstream reference from the owning module.
        validatedOnline: downstreamRef !== null,
        // A fresh re-validation of the CURRENT online actor against the required permission (never a cached result).
        requiredPermissionHeldOnline: ctx.permissions.includes(request.required_permission),
        expired: request.expired,
      });
      const applied = gate.allowed;
      const updated = await this.repo.updateOfflineRequest(tx, id, expectedVersion, {
        syncState: applied ? 'applied' : 'rejected',
        validatedOnline: applied,
        downstreamRef: applied ? downstreamRef : null,
        reasonCode: gate.reasonCode,
        by: ctx.userId ?? null,
      });
      if (!updated) throw versionConflict(ctx.correlationId);
      await this.repo.insertOfflineEvidence(tx, {
        tenantId: ctx.tenantId,
        requestId: id,
        outcome: applied ? 'applied' : 'rejected',
        validatedBy: ctx.userId ?? null,
        downstreamRef: applied ? downstreamRef : null,
        reasonCode: gate.reasonCode,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: applied
          ? M40_AUDIT_CODES.offlineApplied
          : request.controlled
            ? M40_AUDIT_CODES.offlineFinalizeBlocked
            : M40_AUDIT_CODES.offlineRejected,
        entityType: 'resilience_offline_request',
        entityId: id,
        detail: { controlled: request.controlled, reasonCode: gate.reasonCode },
      });
      await this.emitter.publishMobile(tx, applied ? 'OfflineSyncApplied' : 'OfflineSyncRejected', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: {
          recordId: id,
          deviceId: request.device_id,
          toState: applied ? 'applied' : 'rejected',
          reasonCode: gate.reasonCode,
        },
      });
      return { syncState: updated.sync_state, reasonCode: gate.reasonCode };
    });
  }

  async getRequest(ctx: RequestContext, id: string): Promise<OfflineRequestRow | null> {
    await this.authz.require(ctx, M40_PERMISSIONS.offlineRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getOfflineRequest(tx, id));
  }
  async listDevices(ctx: RequestContext, page?: number, size?: number): Promise<DeviceRow[]> {
    await this.authz.require(ctx, M40_PERMISSIONS.deviceRead);
    const { limit, offset } = clampPage(page, size);
    return this.db.withTenant(ctx, (tx) => this.repo.listDevices(tx, limit, offset));
  }
}
