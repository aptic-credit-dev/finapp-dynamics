/**
 * The single place M33 writes AUDIT and publishes EVENTS — through the kernel AUDIT and OUTBOX ports, both taking the
 * caller's `tx` so audit + event + state change commit atomically (ADR-005/023). M33 OWNS the `connector.lifecycle` family
 * (contracts) but owns NO outbox: it publishes onto the ONE outbox m06 owns. Payloads carry safe ids, a bounded key/
 * category, capability key, direction, a ROW COUNT (never data), status and reason codes ONLY — never a connection config
 * value, a secret value/reference content, or an external payload.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type { DomainEvent, ConnectorLifecycleEventType, ConnectorLifecyclePayload } from '@finapp/contracts';
import { CONNECTOR_LIFECYCLE_FAMILY, CONNECTOR_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M33Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }

  /** Publish a `connector.lifecycle` event onto the ONE m06 outbox. Privacy-safe payload (no config/secrets/data). */
  async publishConnector(
    tx: Tx,
    type: ConnectorLifecycleEventType,
    input: { tenantId: string; correlationId: string; actor?: string; payload: ConnectorLifecyclePayload },
  ): Promise<void> {
    const event = {
      eventId: randomUUID(),
      family: CONNECTOR_LIFECYCLE_FAMILY,
      type,
      version: CONNECTOR_LIFECYCLE_VERSION,
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
