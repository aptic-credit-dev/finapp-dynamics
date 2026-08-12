import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { WebhookService, RelayService, M36_PERMISSIONS, M36_AUDIT_CODES } from '@finapp/m36-events';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { endpointView, subscriptionView, deliveryView } from './views.ts';

/**
 * Webhook ENDPOINTS + SUBSCRIPTIONS + delivery REPLAY under `/api/v1/webhooks`. Registering/configuring is unprivileged;
 * ENDPOINT APPROVAL (activating an external egress endpoint — a controlled maker-checker action) and DELIVERY REPLAY are
 * privileged and audited. The internal fan-out relay is dispatcher-driven (not a REST surface). Reads carry no `@Endpoint` —
 * the read permission is enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('webhooks')
export class WebhooksController {
  private readonly webhooks: WebhookService;
  private readonly relay: RelayService;
  private readonly actors: ActorContextFactory;
  constructor(webhooks: WebhookService, relay: RelayService, actors: ActorContextFactory) {
    this.webhooks = webhooks;
    this.relay = relay;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M36_PERMISSIONS.webhookManage,
    auditCode: M36_AUDIT_CODES.endpointRegistered,
    description: 'Register an external webhook endpoint (https public URL; SSRF allow-list).',
  })
  @Post('endpoints')
  async registerEndpoint(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register webhook endpoint (m36)');
    const e = await this.webhooks.registerEndpoint(s.ctx, s.actor.identityId, {
      endpointKey: requireString(b['endpointKey'], 'endpointKey', s.correlationId),
      url: requireString(b['url'], 'url', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optStr(b['signingSecretRef'], 'signingSecretRef'),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return endpointView(e);
  }

  @Get('endpoints')
  async listEndpoints(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse webhook endpoints (m36)');
    const rows = await this.webhooks.listEndpoints(s.ctx, {});
    return { endpoints: rows.map(endpointView) };
  }

  @Endpoint({
    permission: M36_PERMISSIONS.webhookManage,
    auditCode: M36_AUDIT_CODES.endpointReviewRequested,
    description: 'Send a draft endpoint for review (validates URL + secret).',
  })
  @Post('endpoints/:id/review')
  async reviewEndpoint(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'request endpoint review (m36)');
    const e = await this.webhooks.requestReview(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return endpointView(e);
  }

  @Endpoint({
    permission: M36_PERMISSIONS.webhookApprove,
    auditCode: M36_AUDIT_CODES.endpointApproved,
    description: 'Approve/activate an endpoint (maker-checker; approver != requester, human).',
  })
  @Post('endpoints/:id/approve')
  async approveEndpoint(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'approve webhook endpoint (m36)');
    const e = await this.webhooks.approveEndpoint(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return endpointView(e);
  }

  @Endpoint({
    permission: M36_PERMISSIONS.webhookManage,
    auditCode: M36_AUDIT_CODES.endpointSuspended,
    description: 'Suspend an active endpoint.',
  })
  @Post('endpoints/:id/suspend')
  async suspendEndpoint(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'suspend webhook endpoint (m36)');
    const e = await this.webhooks.suspendEndpoint(s.ctx, s.actor.identityId, id);
    return endpointView(e);
  }

  @Endpoint({
    permission: M36_PERMISSIONS.subscriptionManage,
    auditCode: M36_AUDIT_CODES.subscriptionAdded,
    description: 'Subscribe an endpoint to a registered event family/type.',
  })
  @Post('subscriptions')
  async addSubscription(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'add webhook subscription (m36)');
    const sub = await this.webhooks.addSubscription(
      s.ctx,
      s.actor.identityId,
      requireString(b['endpointId'], 'endpointId', s.correlationId),
      {
        eventFamily: requireString(b['eventFamily'], 'eventFamily', s.correlationId),
        ...optStr(b['eventType'], 'eventType'),
      },
    );
    return subscriptionView(sub);
  }

  @Endpoint({
    permission: M36_PERMISSIONS.deliveryReplay,
    auditCode: M36_AUDIT_CODES.deliveryReplayed,
    description: 'Re-attempt a failed/blocked delivery (idempotent; framework-only egress).',
  })
  @Post('deliveries/:id/replay')
  async replayDelivery(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'replay webhook delivery (m36)');
    const d = await this.relay.replayDelivery(s.ctx, s.actor.identityId, id);
    return deliveryView(d);
  }
}
