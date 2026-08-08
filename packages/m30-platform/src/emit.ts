/**
 * The single place M30 writes AUDIT and publishes EVENTS — through the kernel AUDIT and OUTBOX ports, both taking the
 * caller's `tx` so audit + event + state change commit atomically (ADR-005/023). M30 OWNS the `platform.lifecycle`
 * family (contracts) but owns NO outbox: it publishes onto the ONE outbox m06 owns. Payloads carry safe ids, keys,
 * scopes, states and reason codes ONLY — never configuration values, secret values, resolved secret references or
 * personal data.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type { DomainEvent, PlatformLifecycleEventType, PlatformLifecyclePayload } from '@finapp/contracts';
import { PLATFORM_LIFECYCLE_FAMILY, PLATFORM_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M30Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }

  /** Publish a `platform.lifecycle` event onto the ONE m06 outbox. Privacy-safe payload (no values/secrets). */
  async publishPlatform(
    tx: Tx,
    type: PlatformLifecycleEventType,
    input: { tenantId: string; correlationId: string; actor?: string; payload: PlatformLifecyclePayload },
  ): Promise<void> {
    const event = {
      eventId: randomUUID(),
      family: PLATFORM_LIFECYCLE_FAMILY,
      type,
      version: PLATFORM_LIFECYCLE_VERSION,
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
