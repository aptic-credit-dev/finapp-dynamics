/**
 * The single place m24 writes audit and publishes events — through the kernel AUDIT and OUTBOX ports, both taking the
 * caller's `tx` so audit + event + state change commit atomically (ADR-005/023). m24 does NOT own an outbox; it
 * publishes `ai.request_lifecycle` / `ai.output_lifecycle` / `ai.governance_lifecycle` onto the ONE outbox m06 owns.
 * Payloads carry identifiers, states, reason codes, confidence (integer basis points), counts and opaque references
 * ONLY — never prompt/output content, secrets, provider credentials or restricted data. AI never approves or posts.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type {
  DomainEvent,
  AiRequestLifecycleEventType,
  AiOutputLifecycleEventType,
  AiGovernanceLifecycleEventType,
  AiLifecyclePayload,
} from '@finapp/contracts';
import {
  AI_REQUEST_LIFECYCLE_FAMILY,
  AI_REQUEST_LIFECYCLE_VERSION,
  AI_OUTPUT_LIFECYCLE_FAMILY,
  AI_OUTPUT_LIFECYCLE_VERSION,
  AI_GOVERNANCE_LIFECYCLE_FAMILY,
  AI_GOVERNANCE_LIFECYCLE_VERSION,
} from '@finapp/contracts';

export class M24Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }
  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }
  private async publish(
    tx: Tx,
    family: string,
    version: number,
    type: string,
    input: { tenantId: string; correlationId: string; actor?: string; payload: AiLifecyclePayload },
  ): Promise<void> {
    // The three public methods pass a validated (family, type) pair; the discriminated union is reconstructed here.
    const event = {
      eventId: randomUUID(),
      family,
      type,
      version,
      occurredAt: new Date(),
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      classification: 'confidential' as const,
      payload: input.payload,
    } as unknown as DomainEvent;
    await this.outbox.publish(tx, event);
  }
  async publishRequest(
    tx: Tx,
    input: {
      type: AiRequestLifecycleEventType;
      tenantId: string;
      correlationId: string;
      actor?: string;
      payload: AiLifecyclePayload;
    },
  ): Promise<void> {
    await this.publish(tx, AI_REQUEST_LIFECYCLE_FAMILY, AI_REQUEST_LIFECYCLE_VERSION, input.type, input);
  }
  async publishOutput(
    tx: Tx,
    input: {
      type: AiOutputLifecycleEventType;
      tenantId: string;
      correlationId: string;
      actor?: string;
      payload: AiLifecyclePayload;
    },
  ): Promise<void> {
    await this.publish(tx, AI_OUTPUT_LIFECYCLE_FAMILY, AI_OUTPUT_LIFECYCLE_VERSION, input.type, input);
  }
  async publishGovernance(
    tx: Tx,
    input: {
      type: AiGovernanceLifecycleEventType;
      tenantId: string;
      correlationId: string;
      actor?: string;
      payload: AiLifecyclePayload;
    },
  ): Promise<void> {
    await this.publish(
      tx,
      AI_GOVERNANCE_LIFECYCLE_FAMILY,
      AI_GOVERNANCE_LIFECYCLE_VERSION,
      input.type,
      input,
    );
  }
}
