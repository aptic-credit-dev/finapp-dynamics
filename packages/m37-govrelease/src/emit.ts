/**
 * The single place M37 writes AUDIT and publishes EVENTS — through the kernel AUDIT and OUTBOX ports, both taking the
 * caller's `tx` so audit + event + state change commit atomically (ADR-005/023). M37 OWNS the `govrelease.lifecycle` family
 * (contracts) but owns NO outbox: it publishes onto the ONE outbox m06 owns. Payloads carry safe ids, an artifact kind/
 * opaque ref, a release key, a status and reason codes ONLY — never a signature value/reference content, a QA report body,
 * an external payload or personal data.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type {
  DomainEvent,
  GovreleaseLifecycleEventType,
  GovreleaseLifecyclePayload,
} from '@finapp/contracts';
import { GOVRELEASE_LIFECYCLE_FAMILY, GOVRELEASE_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M37Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }

  /** Publish a `govrelease.lifecycle` event onto the ONE m06 outbox. Privacy-safe payload (no signature/report body). */
  async publishGovrelease(
    tx: Tx,
    type: GovreleaseLifecycleEventType,
    input: { tenantId: string; correlationId: string; actor?: string; payload: GovreleaseLifecyclePayload },
  ): Promise<void> {
    const event = {
      eventId: randomUUID(),
      family: GOVRELEASE_LIFECYCLE_FAMILY,
      type,
      version: GOVRELEASE_LIFECYCLE_VERSION,
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
