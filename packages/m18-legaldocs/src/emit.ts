/**
 * The single place m18 writes audit and publishes events — through the kernel AUDIT and OUTBOX ports, both taking
 * the caller's `tx` so audit + event + state change commit atomically (ADR-005/023). m18 does NOT own an outbox;
 * it publishes `legaldocs.lifecycle` envelopes onto the ONE outbox m06 owns. Payloads carry identifiers, states,
 * dates, reason codes and safe analytics dimensions ONLY — never privileged legal advice, confidential clause/
 * opinion/analysis text, full document contents, drafting strategy, or personal data beyond approved identifiers
 * (ADR-076). Each payload includes `recordId` so m06's outbox derives a stable aggregate id.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type { DomainEvent, LegalDocsLifecycleEventType, LegalDocsLifecyclePayload } from '@finapp/contracts';
import { LEGALDOCS_LIFECYCLE_FAMILY, LEGALDOCS_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M18Emitter {
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
      type: LegalDocsLifecycleEventType;
      tenantId: string;
      correlationId: string;
      causationId?: string;
      actor?: string;
      payload: LegalDocsLifecyclePayload;
    },
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      family: LEGALDOCS_LIFECYCLE_FAMILY,
      type: input.type,
      version: LEGALDOCS_LIFECYCLE_VERSION,
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
