/**
 * The single place M38 writes AUDIT and publishes EVENTS — through the kernel AUDIT and OUTBOX ports, both taking the
 * caller's `tx` so audit + event + state change commit atomically (ADR-005/023). M38 OWNS the `automation.lifecycle` and
 * `extension.lifecycle` families (contracts) but owns NO outbox: it publishes onto the ONE outbox m06 owns. Payloads carry
 * safe ids, a capability/schedule reference, a status, a trust tier and reason codes ONLY — never a secret, executable
 * content, a full downstream payload, a credential or personal data.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type {
  DomainEvent,
  AutomationLifecycleEventType,
  AutomationLifecyclePayload,
  ExtensionLifecycleEventType,
  ExtensionLifecyclePayload,
} from '@finapp/contracts';
import {
  AUTOMATION_LIFECYCLE_FAMILY,
  AUTOMATION_LIFECYCLE_VERSION,
  EXTENSION_LIFECYCLE_FAMILY,
  EXTENSION_LIFECYCLE_VERSION,
} from '@finapp/contracts';

export class M38Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }

  /** Publish an `automation.lifecycle` event onto the ONE m06 outbox. Privacy-safe payload. */
  async publishAutomation(
    tx: Tx,
    type: AutomationLifecycleEventType,
    input: { tenantId: string; correlationId: string; actor?: string; payload: AutomationLifecyclePayload },
  ): Promise<void> {
    await this.publish(tx, AUTOMATION_LIFECYCLE_FAMILY, AUTOMATION_LIFECYCLE_VERSION, type, input);
  }

  /** Publish an `extension.lifecycle` event onto the ONE m06 outbox. Privacy-safe payload. */
  async publishExtension(
    tx: Tx,
    type: ExtensionLifecycleEventType,
    input: { tenantId: string; correlationId: string; actor?: string; payload: ExtensionLifecyclePayload },
  ): Promise<void> {
    await this.publish(tx, EXTENSION_LIFECYCLE_FAMILY, EXTENSION_LIFECYCLE_VERSION, type, input);
  }

  private async publish(
    tx: Tx,
    family: string,
    version: number,
    type: string,
    input: { tenantId: string; correlationId: string; actor?: string; payload: unknown },
  ): Promise<void> {
    const event = {
      eventId: randomUUID(),
      family,
      type,
      version,
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
