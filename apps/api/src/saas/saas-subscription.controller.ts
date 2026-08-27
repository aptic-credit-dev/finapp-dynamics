import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  SubscriptionService,
  EntitlementQuotaService,
  BillingService,
  M39_PERMISSIONS,
  M39_AUDIT_CODES,
} from '@finapp/m39-saas';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import {
  subscriptionView,
  billingCycleView,
  usageView,
  overrideView,
  billingCycleDetailView,
} from './views.ts';

/**
 * Tenant SUBSCRIPTION lifecycle + QUOTA/USAGE + commercial OVERRIDE + BILLING-cycle metadata under `/api/v1/saas`. Lifecycle
 * changes + overrides are privileged controlled actions (maker-checker/SoD where required; AI/system/automation never
 * autonomously change commercial terms). Usage recording is race-safe + idempotent; an over-quota reservation is rejected.
 * Reads carry no `@Endpoint` — the read permission is enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function reqNum(v: unknown, name: string, cid: string): number {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  throw new Error(`${name} is required (correlation ${cid})`);
}

@Controller('saas')
export class SaasSubscriptionController {
  private readonly subs: SubscriptionService;
  private readonly quota: EntitlementQuotaService;
  private readonly billing: BillingService;
  private readonly actors: ActorContextFactory;
  constructor(
    subs: SubscriptionService,
    quota: EntitlementQuotaService,
    billing: BillingService,
    actors: ActorContextFactory,
  ) {
    this.subs = subs;
    this.quota = quota;
    this.billing = billing;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M39_PERMISSIONS.subscriptionManage,
    auditCode: M39_AUDIT_CODES.subscriptionCreated,
    description: 'Create a subscription bound to a published plan version.',
  })
  @Post('subscriptions')
  async createSubscription(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create subscription (m39)');
    const sub = await this.subs.createSubscription(s.ctx, {
      subscriptionKey: requireString(b['subscriptionKey'], 'subscriptionKey', s.correlationId),
      planId: requireString(b['planId'], 'planId', s.correlationId),
      planVersionId: requireString(b['planVersionId'], 'planVersionId', s.correlationId),
    });
    return subscriptionView(sub);
  }

  @Get('subscriptions')
  async listSubscriptions(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse subscriptions (m39)');
    const rows = await this.subs.listSubscriptions(s.ctx);
    return { subscriptions: rows.map(subscriptionView) };
  }

  @Get('subscriptions/:id')
  async getSubscription(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'read subscription (m39)');
    const sub = await this.subs.getSubscription(s.ctx, id);
    return { subscription: sub ? subscriptionView(sub) : null };
  }

  // --- admin read models (usage / overrides / billing) — reads, permission enforced in-service, RLS-scoped ----
  @Get('usage')
  async listUsage(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list usage events (m39)');
    return { usageEvents: (await this.quota.listUsageEvents(s.ctx)).map(usageView) };
  }
  @Get('overrides')
  async listOverrides(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list overrides (m39)');
    return { overrides: (await this.quota.listOverrides(s.ctx)).map(overrideView) };
  }
  @Get('subscriptions/:id/billing-cycles')
  async listBillingCycles(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list billing cycles (m39)');
    return { billingCycles: (await this.billing.listBillingCycles(s.ctx, id)).map(billingCycleDetailView) };
  }

  @Endpoint({
    permission: M39_PERMISSIONS.subscriptionManage,
    auditCode: M39_AUDIT_CODES.subscriptionActivated,
    description: 'Activate a subscription (derives entitlements from the plan version).',
  })
  @Post('subscriptions/:id/activate')
  async activate(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'activate subscription (m39)');
    return subscriptionView(
      await this.subs.activateSubscription(s.ctx, id, requireVersion(b['version'], s.correlationId)),
    );
  }

  @Endpoint({
    permission: M39_PERMISSIONS.subscriptionManage,
    auditCode: M39_AUDIT_CODES.subscriptionPlanChanged,
    description: 'Change the bound plan/version (upgrade/downgrade).',
  })
  @Post('subscriptions/:id/change-plan')
  async changePlan(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'change subscription plan (m39)');
    const sub = await this.subs.changePlan(s.ctx, id, requireVersion(b['version'], s.correlationId), {
      planId: requireString(b['planId'], 'planId', s.correlationId),
      planVersionId: requireString(b['planVersionId'], 'planVersionId', s.correlationId),
    });
    return subscriptionView(sub);
  }

  @Endpoint({
    permission: M39_PERMISSIONS.subscriptionManage,
    auditCode: M39_AUDIT_CODES.subscriptionSuspended,
    description: 'Suspend a subscription.',
  })
  @Post('subscriptions/:id/suspend')
  async suspend(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'suspend subscription (m39)');
    return subscriptionView(
      await this.subs.suspendSubscription(s.ctx, id, requireVersion(b['version'], s.correlationId)),
    );
  }

  @Endpoint({
    permission: M39_PERMISSIONS.subscriptionManage,
    auditCode: M39_AUDIT_CODES.subscriptionCancelled,
    description: 'Cancel a subscription.',
  })
  @Post('subscriptions/:id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'cancel subscription (m39)');
    return subscriptionView(
      await this.subs.cancelSubscription(s.ctx, id, requireVersion(b['version'], s.correlationId)),
    );
  }

  @Endpoint({
    permission: M39_PERMISSIONS.subscriptionManage,
    auditCode: M39_AUDIT_CODES.subscriptionRenewed,
    description: 'Renew a subscription.',
  })
  @Post('subscriptions/:id/renew')
  async renew(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'renew subscription (m39)');
    return subscriptionView(
      await this.subs.renewSubscription(s.ctx, id, requireVersion(b['version'], s.correlationId)),
    );
  }

  @Endpoint({
    permission: M39_PERMISSIONS.quotaManage,
    auditCode: M39_AUDIT_CODES.quotaPolicySet,
    description: 'Provision a quota-period counter for a (capability, meter, period).',
  })
  @Post('quota')
  async provisionQuota(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'provision quota (m39)');
    return this.quota.provisionQuota(s.ctx, {
      capabilityKey: requireString(b['capabilityKey'], 'capabilityKey', s.correlationId),
      meterKey: requireString(b['meterKey'], 'meterKey', s.correlationId),
      periodKey: requireString(b['periodKey'], 'periodKey', s.correlationId),
      limitHard: reqNum(b['limitHard'], 'limitHard', s.correlationId),
    });
  }

  @Get('quota/check')
  async checkQuota(@Headers() h: Record<string, string>, @Body() b: Record<string, unknown>) {
    const s = await this.scoped(h, 'check quota (m39)');
    return this.quota.checkQuota(s.ctx, {
      capabilityKey: requireString(b['capabilityKey'], 'capabilityKey', s.correlationId),
      meterKey: requireString(b['meterKey'], 'meterKey', s.correlationId),
      periodKey: requireString(b['periodKey'], 'periodKey', s.correlationId),
    });
  }

  // SELF entitlement check (no @Endpoint — a self-scoped read, like /auth/tenants): "is my tenant entitled to
  // this capability?". Gates a composition-vertical's AVAILABILITY in the UI; M02 RBAC still governs actions.
  @Get('entitlements/check')
  async checkEntitlement(
    @Query('capabilityKey') capabilityKey: string,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'check entitlement (m39)');
    return this.quota.resolveEntitlement(
      s.ctx,
      requireString(capabilityKey, 'capabilityKey', s.correlationId),
    );
  }

  @Endpoint({
    permission: M39_PERMISSIONS.usageRecord,
    auditCode: M39_AUDIT_CODES.usageRecorded,
    description: 'Record usage (race-safe reservation + idempotent).',
  })
  @Post('usage')
  async recordUsage(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'record usage (m39)');
    return this.quota.recordUsage(s.ctx, {
      capabilityKey: requireString(b['capabilityKey'], 'capabilityKey', s.correlationId),
      meterKey: requireString(b['meterKey'], 'meterKey', s.correlationId),
      periodKey: requireString(b['periodKey'], 'periodKey', s.correlationId),
      quantity: reqNum(b['quantity'], 'quantity', s.correlationId),
      idempotencyKey: requireString(h['idempotency-key'], 'idempotency-key', s.correlationId),
      ...optStr(b['sourceRef'], 'sourceRef'),
    });
  }

  @Endpoint({
    permission: M39_PERMISSIONS.overrideAdminister,
    auditCode: M39_AUDIT_CODES.overrideApplied,
    description: 'Apply a commercial override (privileged; maker-checker).',
  })
  @Post('overrides')
  async applyOverride(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'apply override (m39)');
    const kind = requireString(b['targetKind'], 'targetKind', s.correlationId);
    return this.quota.applyOverride(s.ctx, s.actor.identityId, {
      targetKind: kind === 'quota' ? 'quota' : 'entitlement',
      capabilityKey: requireString(b['capabilityKey'], 'capabilityKey', s.correlationId),
      requestedBy: requireString(b['requestedBy'], 'requestedBy', s.correlationId),
      reasonCode: requireString(b['reasonCode'], 'reasonCode', s.correlationId),
      ...optStr(b['allowance'], 'allowance'),
    });
  }

  @Endpoint({
    permission: M39_PERMISSIONS.subscriptionManage,
    auditCode: M39_AUDIT_CODES.billingCycleOpened,
    description: 'Open a billing cycle (metadata).',
  })
  @Post('subscriptions/:id/billing-cycles')
  async openCycle(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'open billing cycle (m39)');
    const cycle = await this.billing.openCycle(s.ctx, id, {
      cycleStart: new Date(requireString(b['cycleStart'], 'cycleStart', s.correlationId)),
      cycleEnd: new Date(requireString(b['cycleEnd'], 'cycleEnd', s.correlationId)),
    });
    return billingCycleView(cycle);
  }

  @Endpoint({
    permission: M39_PERMISSIONS.subscriptionManage,
    auditCode: M39_AUDIT_CODES.billingCycleClosed,
    description: 'Close a billing cycle (metadata; settlement is deferred/fail-closed).',
  })
  @Post('billing-cycles/:id/close')
  async closeCycle(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'close billing cycle (m39)');
    return billingCycleView(
      await this.billing.closeCycle(s.ctx, id, requireVersion(b['version'], s.correlationId)),
    );
  }
}
