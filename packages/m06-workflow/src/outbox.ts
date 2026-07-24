/**
 * WorkflowOutbox — THE single durable transactional outbox (ADR-004/023). m06 owns it; every module publishes
 * its `DomainEvent`s through the kernel `OUTBOX` token, which this binds. `publish(tx, event)` inserts a row
 * into `workflow_event_outbox` IN THE CALLER'S TRANSACTION, so the event and the state change that produced it
 * commit or roll back together — exactly-once *intent* without a distributed transaction. Delivery is a
 * separate dispatcher concern (at-least-once, idempotent consumers); this class only enqueues.
 *
 * It replaces the in-memory `RecordingOutbox` stand-in. Because every existing caller already invokes
 * `publish(tx, event)` inside its transaction, the swap changes no call site.
 */
import type { Outbox, Tx } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import { WorkflowRepository } from './repository.ts';

/** Best-effort per-aggregate ordering key: the first known id on the payload, else the event id. */
function aggregateIdOf(event: DomainEvent): string {
  const payload = event.payload as Record<string, unknown>;
  for (const key of [
    'instanceId',
    'taskId',
    'incidentId',
    'versionId',
    'definitionId',
    'roleId',
    'assignmentId',
    'subjectId',
    'id',
  ]) {
    const value = payload[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return event.eventId;
}

export class WorkflowOutbox implements Outbox<DomainEvent> {
  private readonly repo: WorkflowRepository;

  constructor(repo: WorkflowRepository = new WorkflowRepository()) {
    this.repo = repo;
  }

  async publish(tx: Tx, event: DomainEvent): Promise<void> {
    // The outbox row's scope is derived from the transaction session (see repository.insertOutboxRow), so an
    // account-plane event emitted inside a tenant transaction enqueues without violating RLS. The event's
    // logical tenantId is preserved in the envelope for consumers.
    await this.repo.insertOutboxRow(tx, {
      family: event.family,
      type: event.type,
      aggregateId: aggregateIdOf(event),
      envelope: event,
      dedupeKey: event.eventId,
    });
  }
}
