import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { SubscriptionService, M35_PERMISSIONS, M35_AUDIT_CODES } from '@finapp/m35-devportal';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope } from '../identity/http.ts';
import { subscriptionView, subscriptionReadView } from './views.ts';

/**
 * App SUBSCRIPTIONS under `/api/v1/developer` — the public-exposure grant. Requesting/approving/suspending a subscription is
 * privileged; approval is maker-checker (approver != requester) and a PUBLIC product's exposure is additionally gated by the
 * m39 quota (fail closed while m39 is unbuilt). Every route authorizes a `devportal.*` permission.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('developer')
export class DevportalSubscriptionsController {
  private readonly subs: SubscriptionService;
  private readonly actors: ActorContextFactory;
  constructor(subs: SubscriptionService, actors: ActorContextFactory) {
    this.subs = subs;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  /** The tenant's app→product subscriptions. Read permission (subscription.manage) enforced in-service —
   * viewing subscriptions is a PRIVILEGED capability (there is no separate subscription-read permission). */
  @Get('subscriptions')
  async listSubscriptions(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse subscriptions (m35)');
    const rows = await this.subs.listSubscriptions(s.ctx, {});
    return { subscriptions: rows.map(subscriptionReadView) };
  }

  @Get('subscriptions/:id')
  async getSubscription(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'read subscription (m35)');
    const sub = await this.subs.getSubscription(s.ctx, id);
    return { subscription: sub === null ? null : subscriptionView(sub) };
  }

  @Endpoint({
    permission: M35_PERMISSIONS.subscriptionManage,
    auditCode: M35_AUDIT_CODES.subscriptionRequested,
    description: 'Request a subscription of an app to a published product.',
  })
  @Post('subscriptions')
  async requestSubscription(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'request subscription (m35)');
    const sub = await this.subs.requestSubscription(s.ctx, s.actor.identityId, {
      appId: requireString(b['appId'], 'appId', s.correlationId),
      productId: requireString(b['productId'], 'productId', s.correlationId),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return subscriptionView(sub);
  }

  @Endpoint({
    permission: M35_PERMISSIONS.subscriptionManage,
    auditCode: M35_AUDIT_CODES.subscriptionActivated,
    description: 'Approve a subscription (maker-checker; public exposure gated by m39 quota).',
  })
  @Post('subscriptions/approve')
  async approveSubscription(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'approve subscription (m35)');
    const sub = await this.subs.approveSubscription(
      s.ctx,
      s.actor.identityId,
      requireString(b['subscriptionId'], 'subscriptionId', s.correlationId),
    );
    return subscriptionView(sub);
  }

  @Endpoint({
    permission: M35_PERMISSIONS.subscriptionManage,
    auditCode: M35_AUDIT_CODES.subscriptionSuspended,
    description: 'Suspend an active subscription (withdraw public API access).',
  })
  @Post('subscriptions/suspend')
  async suspendSubscription(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'suspend subscription (m35)');
    const sub = await this.subs.suspendSubscription(
      s.ctx,
      s.actor.identityId,
      requireString(b['subscriptionId'], 'subscriptionId', s.correlationId),
    );
    return subscriptionView(sub);
  }
}
