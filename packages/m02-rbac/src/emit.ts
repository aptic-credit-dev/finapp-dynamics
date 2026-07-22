import { randomUUID } from 'node:crypto';
import type { Audit, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import {
  AUTHZ_LIFECYCLE_FAMILY,
  AUTHZ_LIFECYCLE_VERSION,
  PLATFORM_TENANT,
  type AuthzLifecycleEventType,
  type AuthzLifecyclePayload,
  type DomainEvent,
} from '@finapp/contracts';

/**
 * The single place m02-rbac writes audit and publishes events — through the kernel AUDIT/OUTBOX ports,
 * inside the caller's transaction (ADR-004/005). No second dispatcher, no second outbox.
 *
 * Details never carry a permission-set dump or a secret — identifiers, counts and transitions only.
 */
export class RbacEmitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;

  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  async recordAudit(
    tx: Tx,
    ctx: RequestContext | SystemContext,
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
    type: AuthzLifecycleEventType,
    tenantId: string | null,
    correlationId: string,
    actor: string | null,
    payload: AuthzLifecyclePayload,
  ): Promise<void> {
    await this.outbox.publish(tx, {
      eventId: randomUUID(),
      family: AUTHZ_LIFECYCLE_FAMILY,
      type,
      version: AUTHZ_LIFECYCLE_VERSION,
      occurredAt: new Date(),
      tenantId: tenantId ?? PLATFORM_TENANT,
      correlationId,
      ...(actor === null ? {} : { actor }),
      classification: 'confidential',
      payload,
    });
  }
}
