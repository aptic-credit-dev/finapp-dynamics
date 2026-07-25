/**
 * The single place m07 writes audit and publishes events — through the kernel AUDIT and OUTBOX ports, both
 * taking the caller's `tx` so audit + event + state change commit atomically (ADR-005/023). m07 does NOT own
 * an outbox; it publishes `rules.lifecycle` envelopes onto the ONE outbox m06 owns. Payloads carry identifiers,
 * reason codes and the input HASH only — never raw rule inputs, outputs or derived values (ADR-035).
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type { DomainEvent, RulesLifecycleEventType, RulesLifecyclePayload } from '@finapp/contracts';
import { RULES_LIFECYCLE_FAMILY, RULES_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M07Emitter {
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

  /** Publish a rules.lifecycle event onto the single outbox, in the caller's transaction. */
  async publish(
    tx: Tx,
    input: {
      type: RulesLifecycleEventType;
      tenantId: string;
      correlationId: string;
      actor?: string;
      payload: RulesLifecyclePayload;
    },
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      family: RULES_LIFECYCLE_FAMILY,
      type: input.type,
      version: RULES_LIFECYCLE_VERSION,
      occurredAt: new Date(),
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      classification: 'confidential',
      payload: input.payload,
    };
    await this.outbox.publish(tx, event);
  }
}
