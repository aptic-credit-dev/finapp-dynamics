/**
 * The single place M32 writes AUDIT and publishes EVENTS — through the kernel AUDIT and OUTBOX ports, both taking the
 * caller's `tx` so audit + event + state change commit atomically (ADR-005/023). M32 OWNS the `analytics.lifecycle`
 * family (contracts) but owns NO outbox: it publishes onto the ONE outbox m06 owns. These are ANALYTICS lifecycle events
 * only — they never impersonate a transactional source-domain event. Payloads carry safe ids, a bounded key/kind, source
 * module, version, scope, a ROW COUNT (never a value), states and reason codes ONLY — never a metric value, a report
 * body, source data, a secret or personal data.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type { DomainEvent, AnalyticsLifecycleEventType, AnalyticsLifecyclePayload } from '@finapp/contracts';
import { ANALYTICS_LIFECYCLE_FAMILY, ANALYTICS_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M32Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }

  /** Publish an `analytics.lifecycle` event onto the ONE m06 outbox. Privacy-safe payload (no values/report bodies). */
  async publishAnalytics(
    tx: Tx,
    type: AnalyticsLifecycleEventType,
    input: { tenantId: string; correlationId: string; actor?: string; payload: AnalyticsLifecyclePayload },
  ): Promise<void> {
    const event = {
      eventId: randomUUID(),
      family: ANALYTICS_LIFECYCLE_FAMILY,
      type,
      version: ANALYTICS_LIFECYCLE_VERSION,
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
