/**
 * M36 ports — the two fail-closed seams that keep m36 an OUTBOUND RELAY rather than a second engine, plus the m30 secret
 * seam re-export. All deterministic offline doubles for tests (no network, no provider):
 *  (1) `EventSourcePort` — how m36 CONSUMES the platform's domain events BY CONTRACT. m06 owns THE ONE outbox/event-delivery
 *      path; its platform dispatcher reads pending events and hands them to m36's relay through this port. m36 does NOT read
 *      the m06 outbox table and does NOT own a second outbox. The default binding is `EmptyEventSource` (no events) — fail
 *      closed / no invented traffic.
 *  (2) `WebhookDeliveryPort` — how m36 performs EXTERNAL EGRESS. It is FRAMEWORK ONLY: `UnavailableWebhookDelivery` (the
 *      DEFAULT) yields a durable BLOCKED outcome (no network, no provider); a `FixtureWebhookDelivery` is a deterministic
 *      offline double for tests. A real HTTP delivery runtime drops in behind this port when proven — never here.
 *  (3) the SECRET-RESOLVER seam is reused from m30 (opaque `secretref:` -> availability metadata only, never a value; real
 *      backend = m41-security), re-exported for convenience.
 */
import {
  DeterministicSecretResolver,
  UnavailableSecretResolver,
  type SecretResolver,
} from '@finapp/m30-platform';

export { DeterministicSecretResolver, UnavailableSecretResolver };
export type { SecretResolver };

/** A domain event handed to the relay (the m06 outbox envelope, projected to what a delivery needs). Privacy-safe. */
export interface RelayEvent {
  readonly eventId: string;
  readonly family: string;
  readonly type: string;
  readonly aggregateId: string;
  readonly dedupeKey: string;
  readonly occurredAt?: string;
  readonly payload?: unknown;
}

/** The seam m36 uses to CONSUME the platform's domain events (fed by the m06 outbox dispatcher). m36 owns no outbox. */
export interface EventSourcePort {
  /** Fetch up to `limit` events to relay for a tenant. The m06 dispatcher is the real source; this is a read-only contract. */
  fetchPending(tenantId: string, limit: number): Promise<readonly RelayEvent[]>;
}

/** The DEFAULT binding: no events (fail closed — m36 never invents traffic; the real m06 dispatcher feeds the relay). */
export class EmptyEventSource implements EventSourcePort {
  fetchPending(): Promise<readonly RelayEvent[]> {
    return Promise.resolve([]);
  }
}

/** A DETERMINISTIC offline double: replays a fixed set of events for tests only. */
export class FixtureEventSource implements EventSourcePort {
  private readonly events: readonly RelayEvent[];
  constructor(events: readonly RelayEvent[] = []) {
    this.events = events;
  }
  fetchPending(_tenantId: string, limit: number): Promise<readonly RelayEvent[]> {
    return Promise.resolve(this.events.slice(0, limit));
  }
}

/** The outcome of a single external delivery attempt. Never carries a response body or a secret. */
export interface DeliveryOutcome {
  readonly delivered: boolean;
  readonly reasonCode: string;
  readonly statusHint?: number;
}

/** The seam m36 uses to perform EXTERNAL EGRESS to a webhook endpoint. Framework-only; fail closed. */
export interface WebhookDeliveryPort {
  deliver(input: {
    url: string;
    signingSecretRef: string | null;
    event: RelayEvent;
  }): Promise<DeliveryOutcome>;
}

/** FAIL-CLOSED default — no network, no provider: every delivery is durably BLOCKED (never guessed as delivered). */
export class UnavailableWebhookDelivery implements WebhookDeliveryPort {
  deliver(): Promise<DeliveryOutcome> {
    return Promise.resolve({ delivered: false, reasonCode: 'delivery_runtime_unavailable' });
  }
}

/** A DETERMINISTIC offline double: succeeds (or fails) by construction — NO real network. For tests only. */
export class FixtureWebhookDelivery implements WebhookDeliveryPort {
  private readonly ok: boolean;
  constructor(ok = true) {
    this.ok = ok;
  }
  deliver(): Promise<DeliveryOutcome> {
    return Promise.resolve(
      this.ok
        ? { delivered: true, reasonCode: 'delivery_succeeded', statusHint: 200 }
        : { delivered: false, reasonCode: 'delivery_failed', statusHint: 500 },
    );
  }
}
