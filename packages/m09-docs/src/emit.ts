/**
 * The single place m09 writes audit and publishes events — through the kernel AUDIT and OUTBOX ports, both
 * taking the caller's `tx` so audit + event + state change commit atomically (ADR-005/023). m09 does NOT own an
 * outbox; it publishes `document.lifecycle` envelopes onto the ONE outbox m06 owns. Payloads carry identifiers,
 * states and content HASHES only — never raw content, extracted text, signed URLs, storage credentials, or
 * encryption keys (ADR-046). Each payload includes `documentId` so m06's outbox derives a stable aggregate id.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type { DomainEvent, DocumentLifecycleEventType, DocumentEventPayload } from '@finapp/contracts';
import { DOCUMENT_LIFECYCLE_FAMILY, DOCUMENT_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M09Emitter {
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
      type: DocumentLifecycleEventType;
      tenantId: string;
      correlationId: string;
      causationId?: string;
      actor?: string;
      payload: DocumentEventPayload;
    },
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      family: DOCUMENT_LIFECYCLE_FAMILY,
      type: input.type,
      version: DOCUMENT_LIFECYCLE_VERSION,
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
