/**
 * The single place m17 writes audit and publishes events — through the kernel AUDIT and OUTBOX ports, both taking
 * the caller's `tx` so audit + event + state change commit atomically (ADR-005/023). m17 does NOT own an outbox;
 * it publishes `recovery.lifecycle` envelopes onto the ONE outbox m06 owns. Payloads carry identifiers, states,
 * dates, safe amounts (minor units), reason codes and safe analytics dimensions ONLY — never debtor contact
 * details, negotiation strategy, settlement terms, bank/payment details, security valuations, document contents,
 * or raw correspondence (ADR-072). Each payload includes `recoveryId` so m06's outbox derives a stable aggregate
 * id.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type { DomainEvent, RecoveryLifecycleEventType, RecoveryLifecyclePayload } from '@finapp/contracts';
import { RECOVERY_LIFECYCLE_FAMILY, RECOVERY_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M17Emitter {
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
      type: RecoveryLifecycleEventType;
      tenantId: string;
      correlationId: string;
      causationId?: string;
      actor?: string;
      payload: RecoveryLifecyclePayload;
    },
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      family: RECOVERY_LIFECYCLE_FAMILY,
      type: input.type,
      version: RECOVERY_LIFECYCLE_VERSION,
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
