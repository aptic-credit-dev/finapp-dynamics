/**
 * The envelope every domain event is published in.
 *
 * Events are declared once here and published through the m06 transactional outbox inside the same
 * transaction as the state change (ADR-004). Consumers are idempotent and key off `eventId`.
 */
export interface DomainEventEnvelope<TFamily extends string, TPayload> {
  /** Unique per emission. The consumer's idempotency key. */
  readonly eventId: string;
  /** Dot-lowercase family, singular domain — e.g. `case.lifecycle` (manifests/naming-map.yaml). */
  readonly family: TFamily;
  /** Monotonic per aggregate; lets a consumer detect gaps and order replays. */
  readonly version: number;
  /** UTC instant the state change committed. Stored UTC, rendered in tenant timezone. */
  readonly occurredAt: Date;
  /** Owning tenant. Every event is tenant-scoped (ADR-001). */
  readonly tenantId: string;
  /** Ties the event back to the request and audit entry that produced it. */
  readonly correlationId: string;
  readonly payload: TPayload;
}

/** Family names are `<domain>.<aggregate>_lifecycle` or `<domain>.<event>` (manifests/naming-map.yaml). */
export const EVENT_FAMILY_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*\.[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

export function isValidEventFamily(family: string): boolean {
  return EVENT_FAMILY_PATTERN.test(family);
}
