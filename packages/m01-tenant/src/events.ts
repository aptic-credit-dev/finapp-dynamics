import { randomUUID } from 'node:crypto';
import {
  TENANT_LIFECYCLE_FAMILY,
  TENANT_LIFECYCLE_VERSION,
  type TenantLifecycleEvent,
  type TenantLifecycleEventType,
  type TenantLifecyclePayload,
} from '@finapp/contracts';

/**
 * Builds `tenant.lifecycle` envelopes.
 *
 * One builder so every M01 event carries the same envelope discipline — family, version, classification
 * and correlation cannot be forgotten at a call site, because there is no call site that constructs an
 * envelope by hand.
 *
 * `occurredAt` is passed in rather than read from the clock here: the caller stamps it once per
 * transaction, so every event from one state change shares an instant and consumers can order them.
 */
export function tenantLifecycleEvent(input: {
  type: TenantLifecycleEventType;
  tenantId: string;
  correlationId: string;
  causationId?: string | undefined;
  actor?: string | undefined;
  occurredAt: Date;
  payload: TenantLifecyclePayload;
}): TenantLifecycleEvent {
  return {
    eventId: randomUUID(),
    family: TENANT_LIFECYCLE_FAMILY,
    type: input.type,
    version: TENANT_LIFECYCLE_VERSION,
    occurredAt: input.occurredAt,
    tenantId: input.tenantId,
    correlationId: input.correlationId,
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    // `internal`, not `confidential`: the payloads carry identifiers and status transitions only — no
    // legal names, no metadata, no contact details. See packages/contracts/src/tenant-events.ts.
    classification: 'internal',
    payload: input.payload,
  };
}
