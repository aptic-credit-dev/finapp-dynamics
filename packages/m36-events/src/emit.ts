/**
 * The single place M36 writes AUDIT and publishes EVENTS — through the kernel AUDIT and OUTBOX ports, both taking the
 * caller's `tx` so audit + event + state change commit atomically (ADR-005/023). M36 OWNS the `webhook.lifecycle` and
 * `eventstream.lifecycle` families (contracts) but owns NO outbox: it publishes onto the ONE outbox m06 owns. Payloads carry
 * safe ids, an event family/type, a delivery status and reason codes ONLY — never a signing secret, an event payload body,
 * an endpoint credential or personal data.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type {
  DomainEvent,
  WebhookLifecycleEventType,
  WebhookLifecyclePayload,
  EventstreamLifecycleEventType,
  EventstreamLifecyclePayload,
} from '@finapp/contracts';
import {
  WEBHOOK_LIFECYCLE_FAMILY,
  WEBHOOK_LIFECYCLE_VERSION,
  EVENTSTREAM_LIFECYCLE_FAMILY,
  EVENTSTREAM_LIFECYCLE_VERSION,
} from '@finapp/contracts';

export class M36Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }

  /** Publish a `webhook.lifecycle` event onto the ONE m06 outbox. Privacy-safe payload (no secret/body). */
  async publishWebhook(
    tx: Tx,
    type: WebhookLifecycleEventType,
    input: { tenantId: string; correlationId: string; actor?: string; payload: WebhookLifecyclePayload },
  ): Promise<void> {
    await this.publish(tx, WEBHOOK_LIFECYCLE_FAMILY, WEBHOOK_LIFECYCLE_VERSION, type, input);
  }

  /** Publish an `eventstream.lifecycle` event onto the ONE m06 outbox. Privacy-safe payload. */
  async publishEventstream(
    tx: Tx,
    type: EventstreamLifecycleEventType,
    input: { tenantId: string; correlationId: string; actor?: string; payload: EventstreamLifecyclePayload },
  ): Promise<void> {
    await this.publish(tx, EVENTSTREAM_LIFECYCLE_FAMILY, EVENTSTREAM_LIFECYCLE_VERSION, type, input);
  }

  private async publish(
    tx: Tx,
    family: string,
    version: number,
    type: string,
    input: { tenantId: string; correlationId: string; actor?: string; payload: unknown },
  ): Promise<void> {
    const event = {
      eventId: randomUUID(),
      family,
      type,
      version,
      occurredAt: new Date(),
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      classification: 'internal' as const,
      payload: input.payload,
    } as unknown as DomainEvent;
    await this.outbox.publish(tx, event);
  }
}
