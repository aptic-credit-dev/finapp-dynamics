/**
 * The single place m19 writes audit and publishes events — through the kernel AUDIT and OUTBOX ports, both taking
 * the caller's `tx` so audit + event + state change commit atomically (ADR-005/023). m19 does NOT own an outbox;
 * it publishes `finance.lifecycle` envelopes onto the ONE outbox m06 owns. Payloads carry identifiers, codes,
 * states, dates and safe reference dimensions ONLY — never monetary amounts, balances, or float (ADR-007). Each
 * payload includes `recordId` so m06's outbox derives a stable aggregate id.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type { DomainEvent, FinanceLifecycleEventType, FinanceLifecyclePayload } from '@finapp/contracts';
import { FINANCE_LIFECYCLE_FAMILY, FINANCE_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M19Emitter {
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
      type: FinanceLifecycleEventType;
      tenantId: string;
      correlationId: string;
      causationId?: string;
      actor?: string;
      payload: FinanceLifecyclePayload;
    },
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      family: FINANCE_LIFECYCLE_FAMILY,
      type: input.type,
      version: FINANCE_LIFECYCLE_VERSION,
      occurredAt: new Date(),
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      classification: 'internal',
      payload: input.payload,
    };
    await this.outbox.publish(tx, event);
  }
}
