/**
 * The single place m08 writes audit and publishes events — through the kernel AUDIT and OUTBOX ports, both
 * taking the caller's `tx` so audit + event + state change commit atomically (ADR-005/023). m08 does NOT own
 * an outbox; it publishes `notification.lifecycle` envelopes onto the ONE outbox m06 owns. Payloads carry
 * identifiers, channel, status and reason codes ONLY — never destinations, rendered bodies, provider secrets,
 * or variable values (ADR-041). Each payload includes an `id` field so m06's outbox derives a stable
 * aggregate id.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type {
  DomainEvent,
  NotificationLifecycleEventType,
  NotificationLifecyclePayload,
} from '@finapp/contracts';
import { NOTIFICATION_LIFECYCLE_FAMILY, NOTIFICATION_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M08Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;

  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  /** Write an audit entry in the caller's transaction (fails the business action if it fails). */
  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }

  /** Publish a notification.lifecycle event onto the single outbox, in the caller's transaction. */
  async publish(
    tx: Tx,
    input: {
      type: NotificationLifecycleEventType;
      tenantId: string;
      correlationId: string;
      causationId?: string;
      actor?: string;
      payload: NotificationLifecyclePayload;
    },
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      family: NOTIFICATION_LIFECYCLE_FAMILY,
      type: input.type,
      version: NOTIFICATION_LIFECYCLE_VERSION,
      occurredAt: new Date(),
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      classification: 'confidential',
      payload: input.payload,
    };
    await this.outbox.publish(tx, event);
  }
}
