/**
 * The single place m15 writes audit and publishes events — through the kernel AUDIT and OUTBOX ports, both taking
 * the caller's `tx` so audit + event + state change commit atomically (ADR-005/023). m15 does NOT own an outbox;
 * it publishes `reconciliation.lifecycle` envelopes onto the ONE outbox m06 owns. Payloads carry identifiers,
 * states, match types, confidence bands, scores, variances (INTEGER MINOR UNITS), reason codes and dates ONLY —
 * never full account numbers, raw statement content, counterparty PII or secrets.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type {
  DomainEvent,
  ReconciliationLifecycleEventType,
  ReconciliationLifecyclePayload,
} from '@finapp/contracts';
import { RECONCILIATION_LIFECYCLE_FAMILY, RECONCILIATION_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M15Emitter {
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
      type: ReconciliationLifecycleEventType;
      tenantId: string;
      correlationId: string;
      causationId?: string;
      actor?: string;
      payload: ReconciliationLifecyclePayload;
    },
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      family: RECONCILIATION_LIFECYCLE_FAMILY,
      type: input.type,
      version: RECONCILIATION_LIFECYCLE_VERSION,
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
