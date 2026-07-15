import type { Tx } from './db.ts';

/**
 * The OUTBOX contract — **the only** event-delivery path (ADR-004).
 *
 * Stage 0 declared the `OUTBOX` token but no interface. The contract lives with the token; the single
 * authoritative implementation, and the single outbox table, are owned by m06-workflow. No module adds a
 * second outbox table or a second bus.
 */
export interface Outbox<TEvent> {
  /**
   * Enqueues an event **inside the caller's transaction**.
   *
   * `tx` is mandatory for the same reason as on `Audit`: the event and the state change it announces
   * commit atomically, which is what buys exactly-once *intent* without a distributed transaction. An
   * event published outside the transaction can announce a change that later rolls back — consumers
   * would act on a fact that never became true.
   */
  publish(tx: Tx, event: TEvent): Promise<void>;
}
