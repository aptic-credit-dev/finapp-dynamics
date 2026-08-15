/**
 * The single place M40 writes AUDIT and publishes EVENTS — through the kernel AUDIT and OUTBOX ports, both taking the caller's
 * `tx` so audit + event + state change commit atomically (ADR-005/023). M40 OWNS the `mobile.lifecycle`, `backup.lifecycle` and
 * `dr.lifecycle` families (contracts) but owns NO outbox: it publishes onto the ONE outbox m06 owns. Payloads carry safe ids,
 * a device/policy/plan reference, a state, bounded integer durations/sizes and reason codes ONLY — never a secret, a token,
 * raw backup data, a full offline payload, an unbounded log or personal data.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type {
  DomainEvent,
  MobileLifecycleEventType,
  MobileLifecyclePayload,
  BackupLifecycleEventType,
  BackupLifecyclePayload,
  DrLifecycleEventType,
  DrLifecyclePayload,
} from '@finapp/contracts';
import {
  MOBILE_LIFECYCLE_FAMILY,
  MOBILE_LIFECYCLE_VERSION,
  BACKUP_LIFECYCLE_FAMILY,
  BACKUP_LIFECYCLE_VERSION,
  DR_LIFECYCLE_FAMILY,
  DR_LIFECYCLE_VERSION,
} from '@finapp/contracts';

export class M40Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }

  /** Publish a `mobile.lifecycle` event onto the ONE m06 outbox. Privacy-safe payload. */
  async publishMobile(
    tx: Tx,
    type: MobileLifecycleEventType,
    input: {
      tenantId: string;
      correlationId: string;
      actor?: string | undefined;
      payload: MobileLifecyclePayload;
    },
  ): Promise<void> {
    await this.publish(tx, MOBILE_LIFECYCLE_FAMILY, MOBILE_LIFECYCLE_VERSION, type, input);
  }

  /** Publish a `backup.lifecycle` event onto the ONE m06 outbox. Bounded evidence only. */
  async publishBackup(
    tx: Tx,
    type: BackupLifecycleEventType,
    input: {
      tenantId: string;
      correlationId: string;
      actor?: string | undefined;
      payload: BackupLifecyclePayload;
    },
  ): Promise<void> {
    await this.publish(tx, BACKUP_LIFECYCLE_FAMILY, BACKUP_LIFECYCLE_VERSION, type, input);
  }

  /** Publish a `dr.lifecycle` event onto the ONE m06 outbox. Control metadata only — never infrastructure execution. */
  async publishDr(
    tx: Tx,
    type: DrLifecycleEventType,
    input: {
      tenantId: string;
      correlationId: string;
      actor?: string | undefined;
      payload: DrLifecyclePayload;
    },
  ): Promise<void> {
    await this.publish(tx, DR_LIFECYCLE_FAMILY, DR_LIFECYCLE_VERSION, type, input);
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
