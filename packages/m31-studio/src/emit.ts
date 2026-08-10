/**
 * The single place M31 writes AUDIT and publishes EVENTS — through the kernel AUDIT and OUTBOX ports, both taking the
 * caller's `tx` so audit + event + state change commit atomically (ADR-005/023). M31 OWNS the `studio.lifecycle`
 * family (contracts) but owns NO outbox: it publishes onto the ONE outbox m06 owns. These are DESIGN-TIME events only.
 * Payloads carry safe ids, a bounded key/kind, scope, version number, target engine, states and reason codes ONLY —
 * never a design spec, a form field, a configuration value, a secret value or personal data.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type { DomainEvent, StudioLifecycleEventType, StudioLifecyclePayload } from '@finapp/contracts';
import { STUDIO_LIFECYCLE_FAMILY, STUDIO_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M31Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }

  /** Publish a `studio.lifecycle` DESIGN-TIME event onto the ONE m06 outbox. Privacy-safe payload (no spec/secrets). */
  async publishStudio(
    tx: Tx,
    type: StudioLifecycleEventType,
    input: { tenantId: string; correlationId: string; actor?: string; payload: StudioLifecyclePayload },
  ): Promise<void> {
    const event = {
      eventId: randomUUID(),
      family: STUDIO_LIFECYCLE_FAMILY,
      type,
      version: STUDIO_LIFECYCLE_VERSION,
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
