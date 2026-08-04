/**
 * The single place m22 writes audit and publishes events — through the kernel AUDIT and OUTBOX ports, both taking the
 * caller's `tx` so audit + event + state change commit atomically (ADR-005/023). m22 does NOT own an outbox; it
 * publishes `approval.lifecycle` envelopes onto the ONE outbox m06 owns. Payloads carry identifiers, states, levels,
 * decisions, reason codes, counts and opaque references ONLY — never subject narratives, counterparty PII or secrets.
 * m22 never approves on behalf of a human and never posts.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type { DomainEvent, ApprovalLifecycleEventType, ApprovalLifecyclePayload } from '@finapp/contracts';
import { APPROVAL_LIFECYCLE_FAMILY, APPROVAL_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M22Emitter {
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
      type: ApprovalLifecycleEventType;
      tenantId: string;
      correlationId: string;
      causationId?: string;
      actor?: string;
      payload: ApprovalLifecyclePayload;
    },
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      family: APPROVAL_LIFECYCLE_FAMILY,
      type: input.type,
      version: APPROVAL_LIFECYCLE_VERSION,
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
