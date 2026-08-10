/**
 * The single place M34 writes AUDIT and publishes EVENTS — through the kernel AUDIT and OUTBOX ports, both taking the
 * caller's `tx` so audit + event + state change commit atomically (ADR-005/023). M34 OWNS the `marketplace.lifecycle`
 * family (contracts) but owns NO outbox: it publishes onto the ONE outbox m06 owns. Payloads carry safe ids, a bounded
 * key/category, an OPAQUE connector reference, a version, status and reason codes ONLY — never a config value, a secret
 * value/reference content, an external payload or personal data.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type {
  DomainEvent,
  MarketplaceLifecycleEventType,
  MarketplaceLifecyclePayload,
} from '@finapp/contracts';
import { MARKETPLACE_LIFECYCLE_FAMILY, MARKETPLACE_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M34Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }

  /** Publish a `marketplace.lifecycle` event onto the ONE m06 outbox. Privacy-safe payload (no config/secrets/data). */
  async publishMarketplace(
    tx: Tx,
    type: MarketplaceLifecycleEventType,
    input: { tenantId: string; correlationId: string; actor?: string; payload: MarketplaceLifecyclePayload },
  ): Promise<void> {
    const event = {
      eventId: randomUUID(),
      family: MARKETPLACE_LIFECYCLE_FAMILY,
      type,
      version: MARKETPLACE_LIFECYCLE_VERSION,
      occurredAt: new Date(),
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      classification: 'internal' as const,
      payload: input.payload,
    } as unknown as DomainEvent;
    await this.outbox.publish(tx, event);
  }
}
