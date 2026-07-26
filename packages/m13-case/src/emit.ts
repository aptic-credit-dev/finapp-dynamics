/**
 * The single place m13 writes audit and publishes events — through the kernel AUDIT and OUTBOX ports, both taking
 * the caller's `tx` so audit + event + state change commit atomically (ADR-005/023). m13 does NOT own an outbox;
 * it publishes `case.lifecycle` and `case.converted_to_matter` envelopes onto the ONE outbox m06 owns. Payloads
 * carry identifiers, states, dates, safe reason codes and safe analytics dimensions ONLY — never privileged note
 * contents, private party contacts, correspondence bodies, full allegations, legal advice, document contents,
 * confidential settlement terms, storage references, or notification destinations (ADR-060). Each payload
 * includes `caseId` so m06's outbox derives a stable aggregate id.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type {
  DomainEvent,
  CaseLifecycleEventType,
  CaseLifecyclePayload,
  CaseConvertedToMatterEventType,
  CaseConvertedToMatterPayload,
} from '@finapp/contracts';
import {
  CASE_LIFECYCLE_FAMILY,
  CASE_LIFECYCLE_VERSION,
  CASE_CONVERTED_TO_MATTER_FAMILY,
  CASE_CONVERTED_TO_MATTER_VERSION,
} from '@finapp/contracts';

export class M13Emitter {
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
      type: CaseLifecycleEventType;
      tenantId: string;
      correlationId: string;
      causationId?: string;
      actor?: string;
      payload: CaseLifecyclePayload;
    },
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      family: CASE_LIFECYCLE_FAMILY,
      type: input.type,
      version: CASE_LIFECYCLE_VERSION,
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

  /** The controlled m14 boundary — a case being promoted to a legal matter. */
  async publishConversion(
    tx: Tx,
    input: {
      type: CaseConvertedToMatterEventType;
      tenantId: string;
      correlationId: string;
      causationId?: string;
      actor?: string;
      payload: CaseConvertedToMatterPayload;
    },
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      family: CASE_CONVERTED_TO_MATTER_FAMILY,
      type: input.type,
      version: CASE_CONVERTED_TO_MATTER_VERSION,
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
