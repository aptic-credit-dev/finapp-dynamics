/**
 * The single place m16 writes audit and publishes events — through the kernel AUDIT and OUTBOX ports, both taking
 * the caller's `tx` so audit + event + state change commit atomically (ADR-005/023). m16 does NOT own an outbox;
 * it publishes `litigation.lifecycle` envelopes onto the ONE outbox m06 owns. Payloads carry identifiers, states,
 * dates, safe amounts (minor units), reason codes and safe analytics dimensions ONLY — never legal strategy,
 * full pleadings, witness statements, full submissions, private witness/party contacts, full orders, document
 * contents, or confidential outcome terms (ADR-068). Each payload includes `proceedingId` so m06's outbox derives
 * a stable aggregate id.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type {
  DomainEvent,
  LitigationLifecycleEventType,
  LitigationLifecyclePayload,
} from '@finapp/contracts';
import { LITIGATION_LIFECYCLE_FAMILY, LITIGATION_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M16Emitter {
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
      type: LitigationLifecycleEventType;
      tenantId: string;
      correlationId: string;
      causationId?: string;
      actor?: string;
      payload: LitigationLifecyclePayload;
    },
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      family: LITIGATION_LIFECYCLE_FAMILY,
      type: input.type,
      version: LITIGATION_LIFECYCLE_VERSION,
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
