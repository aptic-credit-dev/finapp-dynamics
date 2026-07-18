import { randomUUID } from 'node:crypto';
import type { Audit, Outbox, SystemContext, Tx } from '@finapp/kernel';
import {
  AUTH_LIFECYCLE_FAMILY,
  AUTH_LIFECYCLE_VERSION,
  PLATFORM_TENANT,
  type AuthLifecycleEventType,
  type AuthLifecyclePayload,
  type DomainEvent,
} from '@finapp/contracts';

/**
 * The single place m02-auth writes audit and publishes events. Both go through the kernel ports (AUDIT,
 * OUTBOX) inside the caller's transaction — no second dispatcher, no second outbox (ADR-004/005).
 *
 * Auth events are ACCOUNT-PLANE: `tenantId` is `PLATFORM_TENANT`, exactly as identity/account events, so a
 * tenant never receives another account's authentication telemetry.
 */
export class AuthEmitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;

  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  async recordAudit(
    tx: Tx,
    ctx: SystemContext,
    entry: {
      code: string;
      entityType: string;
      entityId: string;
      reason?: string | null;
      detail?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.audit.write(tx, ctx, {
      code: entry.code,
      entityType: entry.entityType,
      entityId: entry.entityId,
      ...(entry.reason === undefined || entry.reason === null ? {} : { reason: entry.reason }),
      ...(entry.detail === undefined ? {} : { detail: entry.detail }),
    });
  }

  async publish(
    tx: Tx,
    type: AuthLifecycleEventType,
    correlationId: string,
    actor: string | null,
    payload: AuthLifecyclePayload,
  ): Promise<void> {
    await this.outbox.publish(tx, {
      eventId: randomUUID(),
      family: AUTH_LIFECYCLE_FAMILY,
      type,
      version: AUTH_LIFECYCLE_VERSION,
      occurredAt: new Date(),
      tenantId: PLATFORM_TENANT,
      correlationId,
      ...(actor === null ? {} : { actor }),
      classification: 'confidential',
      payload,
    });
  }
}
