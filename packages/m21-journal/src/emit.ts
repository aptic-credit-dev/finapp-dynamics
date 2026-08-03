/**
 * The single place m21 writes audit and publishes events — through the kernel AUDIT and OUTBOX ports, both taking the
 * caller's `tx` so audit + event + state change commit atomically (ADR-005/023). m21 does NOT own an outbox; it
 * publishes `journal.lifecycle` and `posting_request.lifecycle` envelopes onto the ONE outbox m06 owns. Payloads
 * carry identifiers, states, totals (INTEGER MINOR UNITS as strings), reason codes, counts and dates ONLY — never
 * account numbers, line narratives, external credentials, counterparty PII or secrets. m21 never posts or approves.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type {
  DomainEvent,
  JournalLifecycleEventType,
  JournalLifecyclePayload,
  PostingRequestLifecycleEventType,
  PostingRequestLifecyclePayload,
} from '@finapp/contracts';
import {
  JOURNAL_LIFECYCLE_FAMILY,
  JOURNAL_LIFECYCLE_VERSION,
  POSTING_REQUEST_LIFECYCLE_FAMILY,
  POSTING_REQUEST_LIFECYCLE_VERSION,
} from '@finapp/contracts';

export class M21Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }
  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }
  async publishJournal(
    tx: Tx,
    input: {
      type: JournalLifecycleEventType;
      tenantId: string;
      correlationId: string;
      causationId?: string;
      actor?: string;
      payload: JournalLifecyclePayload;
    },
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      family: JOURNAL_LIFECYCLE_FAMILY,
      type: input.type,
      version: JOURNAL_LIFECYCLE_VERSION,
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
  async publishPostingRequest(
    tx: Tx,
    input: {
      type: PostingRequestLifecycleEventType;
      tenantId: string;
      correlationId: string;
      causationId?: string;
      actor?: string;
      payload: PostingRequestLifecyclePayload;
    },
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      family: POSTING_REQUEST_LIFECYCLE_FAMILY,
      type: input.type,
      version: POSTING_REQUEST_LIFECYCLE_VERSION,
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
