/**
 * How sensitive an event's payload is. Drives residency, retention, and what may be sent to an AI
 * provider (ADR-006: restricted data never reaches an unapproved provider).
 */
export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted';

export const DATA_CLASSIFICATIONS: readonly DataClassification[] = [
  'public',
  'internal',
  'confidential',
  'restricted',
];

/**
 * The envelope every domain event is published in.
 *
 * Events are declared once in the union in events.ts and published through the m06 transactional outbox
 * inside the same transaction as the state change (ADR-004). Consumers are idempotent and key off
 * `eventId`.
 *
 * `TFamily` is the routing key; `TType` discriminates events *within* a family. A family is a stable
 * stream that consumers subscribe to, so it must not churn every time a new event is added — a new
 * lifecycle event is a new `type` inside `tenant.lifecycle`, not a new family.
 */
export interface DomainEventEnvelope<TFamily extends string, TType extends string, TPayload> {
  /** Unique per emission. The consumer's idempotency key. */
  readonly eventId: string;
  /** Dot-lowercase family, singular domain — e.g. `tenant.lifecycle` (manifests/naming-map.yaml). */
  readonly family: TFamily;
  /** Discriminates within the family. */
  readonly type: TType;
  /** Payload schema version. Bump on any breaking payload change; never reinterpret an old version. */
  readonly version: number;
  /** UTC instant the state change committed. Stored UTC, rendered in tenant timezone. */
  readonly occurredAt: Date;
  /** Owning tenant. Every event is tenant-scoped (ADR-001). */
  readonly tenantId: string;
  /** Ties the event back to the request and the audit entry that produced it. */
  readonly correlationId: string;
  /**
   * The event or command that caused this one. Correlation groups a request; causation orders a chain
   * within it — without causation, a replay cannot tell which event triggered which.
   */
  readonly causationId?: string;
  /** Who acted. Absent for system-initiated events; never fabricated to fill the field. */
  readonly actor?: string;
  /** Governs how consumers may store, route, and forward the payload. */
  readonly classification: DataClassification;
  readonly payload: TPayload;
}

/** Family names are `<domain>.<aggregate>_lifecycle` or `<domain>.<event>` (manifests/naming-map.yaml). */
export const EVENT_FAMILY_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*\.[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

export function isValidEventFamily(family: string): boolean {
  return EVENT_FAMILY_PATTERN.test(family);
}
