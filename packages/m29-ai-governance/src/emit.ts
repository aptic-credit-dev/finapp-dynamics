/**
 * The single place M29 writes AUDIT and publishes EVENTS — through the kernel AUDIT and OUTBOX ports, both taking the
 * caller's `tx` so audit + event + state change commit atomically (ADR-005/023).
 *
 * EVENT-OWNERSHIP (ADR-113): the `ai.governance_lifecycle` family is DECLARED and OWNED by M24 (contracts/ai-events.ts,
 * one registry entry). M29 is an AUTHORIZED EMITTER/PRODUCER of that family — it does NOT declare a second family, does
 * NOT fork the schema and does NOT own an outbox. It reuses the EXISTING `GovernanceControlUpdated` event type on the
 * ONE m06 outbox to signal governance/release lifecycle transitions; the discriminating detail (record kind, from/to
 * status, reason code, opaque module/asset refs) travels in the safe `AiLifecyclePayload`. `isAssistive` is always true —
 * M29 records a HUMAN governance decision but never executes a controlled action.
 *
 * Audit payloads carry safe ids, status, subject kind, reason codes, confidence/accuracy (integer basis points),
 * decision and decider id ONLY — never prompts, outputs, restricted content, document content, secrets or credentials.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type { DomainEvent, AiLifecyclePayload } from '@finapp/contracts';
import { AI_GOVERNANCE_LIFECYCLE_FAMILY, AI_GOVERNANCE_LIFECYCLE_VERSION } from '@finapp/contracts';

export class M29Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }

  /**
   * Publish an `ai.governance_lifecycle` / `GovernanceControlUpdated` event onto the ONE m06 outbox. M29 reuses M24's
   * existing family + event type (ADR-113) — no new family, no schema fork. Payload is privacy-safe (opaque refs only).
   */
  async publishGovernance(
    tx: Tx,
    input: {
      tenantId: string;
      correlationId: string;
      actor?: string;
      payload: AiLifecyclePayload;
    },
  ): Promise<void> {
    const event = {
      eventId: randomUUID(),
      family: AI_GOVERNANCE_LIFECYCLE_FAMILY,
      type: 'GovernanceControlUpdated',
      version: AI_GOVERNANCE_LIFECYCLE_VERSION,
      occurredAt: new Date(),
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      classification: 'confidential' as const,
      payload: { isAssistive: true, ...input.payload },
    } as unknown as DomainEvent;
    await this.outbox.publish(tx, event);
  }
}
