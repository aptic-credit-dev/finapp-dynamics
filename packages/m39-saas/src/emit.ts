/**
 * The single place M39 writes AUDIT and publishes EVENTS — through the kernel AUDIT and OUTBOX ports, both taking the caller's
 * `tx` so audit + event + state change commit atomically (ADR-005/023). M39 OWNS the `subscription.lifecycle`,
 * `usage.lifecycle` and `billing.lifecycle` families (contracts) but owns NO outbox: it publishes onto the ONE outbox m06
 * owns. Payloads carry safe ids, plan/version/capability/meter references, states, bounded quantities/amounts and reason codes
 * ONLY — never a secret, a credential, a full customer payload, a real payment/accounting entry or personal data.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type {
  DomainEvent,
  SubscriptionLifecycleEventType,
  SubscriptionLifecyclePayload,
  UsageLifecycleEventType,
  UsageLifecyclePayload,
  BillingLifecycleEventType,
  BillingLifecyclePayload,
} from '@finapp/contracts';
import {
  SUBSCRIPTION_LIFECYCLE_FAMILY,
  SUBSCRIPTION_LIFECYCLE_VERSION,
  USAGE_LIFECYCLE_FAMILY,
  USAGE_LIFECYCLE_VERSION,
  BILLING_LIFECYCLE_FAMILY,
  BILLING_LIFECYCLE_VERSION,
} from '@finapp/contracts';

export class M39Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }

  /** Publish a `subscription.lifecycle` event onto the ONE m06 outbox. Privacy-safe payload. */
  async publishSubscription(
    tx: Tx,
    type: SubscriptionLifecycleEventType,
    input: {
      tenantId: string;
      correlationId: string;
      actor?: string | undefined;
      payload: SubscriptionLifecyclePayload;
    },
  ): Promise<void> {
    await this.publish(tx, SUBSCRIPTION_LIFECYCLE_FAMILY, SUBSCRIPTION_LIFECYCLE_VERSION, type, input);
  }

  /** Publish a `usage.lifecycle` event onto the ONE m06 outbox. Privacy-safe payload. */
  async publishUsage(
    tx: Tx,
    type: UsageLifecycleEventType,
    input: {
      tenantId: string;
      correlationId: string;
      actor?: string | undefined;
      payload: UsageLifecyclePayload;
    },
  ): Promise<void> {
    await this.publish(tx, USAGE_LIFECYCLE_FAMILY, USAGE_LIFECYCLE_VERSION, type, input);
  }

  /** Publish a `billing.lifecycle` event onto the ONE m06 outbox. Metadata only — never a real payment/accounting entry. */
  async publishBilling(
    tx: Tx,
    type: BillingLifecycleEventType,
    input: {
      tenantId: string;
      correlationId: string;
      actor?: string | undefined;
      payload: BillingLifecyclePayload;
    },
  ): Promise<void> {
    await this.publish(tx, BILLING_LIFECYCLE_FAMILY, BILLING_LIFECYCLE_VERSION, type, input);
  }

  private async publish(
    tx: Tx,
    family: string,
    version: number,
    type: string,
    input: { tenantId: string; correlationId: string; actor?: string | undefined; payload: unknown },
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
