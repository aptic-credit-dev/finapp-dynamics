/**
 * The single place m20 writes audit and publishes events — through the kernel AUDIT and OUTBOX ports, both taking the
 * caller's `tx` so audit + event + state change commit atomically (ADR-005/023). m20 does NOT own an outbox; it
 * publishes `glrecon.lifecycle` envelopes onto the ONE outbox m06 owns. Payloads carry identifiers, states, match
 * types, confidence bands, scores, variances (INTEGER MINOR UNITS), reason codes and dates ONLY — never full GL
 * account numbers, raw source content, counterparty PII or secrets. Recommendations are DRAFT only.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type { DomainEvent, GlreconLifecycleEventType, GlreconLifecyclePayload } from '@finapp/contracts';
import { GLRECON_LIFECYCLE_FAMILY, GLRECON_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M20Emitter {
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
      type: GlreconLifecycleEventType;
      tenantId: string;
      correlationId: string;
      causationId?: string;
      actor?: string;
      payload: GlreconLifecyclePayload;
    },
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      family: GLRECON_LIFECYCLE_FAMILY,
      type: input.type,
      version: GLRECON_LIFECYCLE_VERSION,
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
