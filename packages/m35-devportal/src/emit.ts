/**
 * The single place M35 writes AUDIT and publishes EVENTS — through the kernel AUDIT and OUTBOX ports, both taking the
 * caller's `tx` so audit + event + state change commit atomically (ADR-005/023). M35 OWNS the `devportal.lifecycle` family
 * (contracts) but owns NO outbox: it publishes onto the ONE outbox m06 owns. Payloads carry safe ids, a bounded key/
 * category, an OPAQUE source reference, a version, status and reason codes ONLY — never a secret value/reference content, an
 * API credential, a config value, an external payload or personal data.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type { DomainEvent, DevportalLifecycleEventType, DevportalLifecyclePayload } from '@finapp/contracts';
import { DEVPORTAL_LIFECYCLE_FAMILY, DEVPORTAL_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M35Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }

  /** Publish a `devportal.lifecycle` event onto the ONE m06 outbox. Privacy-safe payload (no secrets/credentials/config). */
  async publishDevportal(
    tx: Tx,
    type: DevportalLifecycleEventType,
    input: { tenantId: string; correlationId: string; actor?: string; payload: DevportalLifecyclePayload },
  ): Promise<void> {
    const event = {
      eventId: randomUUID(),
      family: DEVPORTAL_LIFECYCLE_FAMILY,
      type,
      version: DEVPORTAL_LIFECYCLE_VERSION,
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
