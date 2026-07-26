/**
 * The single place m12 writes audit and publishes events — through the kernel AUDIT and OUTBOX ports, both
 * taking the caller's `tx` so audit + event + state change commit atomically (ADR-005/023). m12 does NOT own an
 * outbox; it publishes `feedback.lifecycle` envelopes onto the ONE outbox m06 owns. Payloads carry identifiers,
 * statuses, reason codes and safe analytics dimensions ONLY — never customer contacts, narratives, confidential
 * internal responses, document contents, or notification destinations (ADR-055). Each payload includes
 * `feedbackId` (or `sourceTransactionId`/`handoffId`) so m06's outbox derives a stable aggregate id.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type { DomainEvent, FeedbackLifecycleEventType, FeedbackEventPayload } from '@finapp/contracts';
import { FEEDBACK_LIFECYCLE_FAMILY, FEEDBACK_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M12Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;

  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }

  async publish(
    tx: Tx,
    input: {
      type: FeedbackLifecycleEventType;
      tenantId: string;
      correlationId: string;
      causationId?: string;
      actor?: string;
      payload: FeedbackEventPayload;
    },
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      family: FEEDBACK_LIFECYCLE_FAMILY,
      type: input.type,
      version: FEEDBACK_LIFECYCLE_VERSION,
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
