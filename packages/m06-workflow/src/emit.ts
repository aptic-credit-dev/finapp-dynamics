/**
 * The single place m06 writes audit and publishes events — through the kernel AUDIT and OUTBOX ports, both
 * taking the caller's `tx` so audit + event + state change commit atomically (ADR-005/023). m06 OWNS the
 * OUTBOX; the events it publishes are `workflow.lifecycle` envelopes (contracts). Payloads carry identifiers
 * and transitions only — never workflow variable values or task payloads.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type { DomainEvent, WorkflowLifecycleEventType, WorkflowLifecyclePayload } from '@finapp/contracts';
import { WORKFLOW_LIFECYCLE_FAMILY, WORKFLOW_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M06Emitter {
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

  /** Publish a workflow.lifecycle event onto the single outbox, in the caller's transaction. */
  async publish(
    tx: Tx,
    input: {
      type: WorkflowLifecycleEventType;
      tenantId: string;
      correlationId: string;
      actor?: string;
      payload: WorkflowLifecyclePayload;
    },
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      family: WORKFLOW_LIFECYCLE_FAMILY,
      type: input.type,
      version: WORKFLOW_LIFECYCLE_VERSION,
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
