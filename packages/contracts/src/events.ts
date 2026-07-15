import type { DomainEventEnvelope } from './envelope.ts';

/**
 * THE typed domain-event union.
 *
 * Stage 0 declares zero families: no business events exist yet, and inventing one here would be a
 * business decision the toolchain has no business making. The reference baseline has 81 families.
 *
 * TO ADD A FAMILY (with the module that owns it — never ahead of it):
 *   1. Register it in manifests/event-registry.yaml under its owning module.
 *   2. Declare its payload and envelope alias below.
 *   3. Append the alias to `DomainEvent`. Append at the tail; never renumber or reorder — consumers
 *      and the outbox key off the family name.
 *
 *   export interface CaseOpenedPayload { readonly caseId: string; readonly openedBy: string }
 *   export type CaseLifecycleEvent = DomainEventEnvelope<'case.lifecycle', CaseOpenedPayload>;
 *   export type DomainEvent = CaseLifecycleEvent;
 *
 * `never` is the honest empty union: it makes `publish(event: DomainEvent)` uncallable until a real
 * family exists, so nothing can slip an untyped event through the outbox in the meantime.
 */
export type DomainEvent = never;

/** Every family name currently declared. Empty at Stage 0; the conformance suite cross-checks it. */
export const DOMAIN_EVENT_FAMILIES: readonly string[] = [];

/** Narrowing helper — `DomainEvent['family']` stays accurate as families are appended. */
export type DomainEventFamily =
  DomainEvent extends DomainEventEnvelope<infer TFamily, unknown> ? TFamily : never;
