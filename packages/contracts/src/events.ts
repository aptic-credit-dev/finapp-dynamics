import type { TenantLifecycleEvent } from './tenant-events.ts';
import { TENANT_LIFECYCLE_FAMILY } from './tenant-events.ts';
import type { IdentityLifecycleEvent } from './identity-events.ts';
import { IDENTITY_LIFECYCLE_FAMILY } from './identity-events.ts';
import type { AuthLifecycleEvent } from './auth-events.ts';
import { AUTH_LIFECYCLE_FAMILY } from './auth-events.ts';

/**
 * THE typed domain-event union.
 *
 * Stage 0 declared this `never` — no business events existed. Stage 1A appended `tenant.lifecycle`;
 * Stage 1B appends `identity.lifecycle`. Each arrives in the same change as the module that owns it
 * (CLAUDE.md: events ship with their module). The reference baseline has 81 families.
 *
 * TO ADD A FAMILY (with the module that owns it — never ahead of it):
 *   1. Register it in manifests/event-registry.yaml under its owning module.
 *   2. Declare its payloads and envelope alias in its own `*-events.ts`.
 *   3. Append the alias to `DomainEvent` and its family name to `DOMAIN_EVENT_FAMILIES`, at the TAIL.
 *      Never renumber or reorder — consumers and the outbox key off the family name.
 */
export type DomainEvent = TenantLifecycleEvent | IdentityLifecycleEvent | AuthLifecycleEvent;

/** Every family currently declared. Kept in step with the union; asserted by the contracts smoke suite. */
export const DOMAIN_EVENT_FAMILIES: readonly string[] = [
  TENANT_LIFECYCLE_FAMILY,
  IDENTITY_LIFECYCLE_FAMILY,
  AUTH_LIFECYCLE_FAMILY,
];

/** Narrowing helper — stays accurate as families are appended. */
export type DomainEventFamily = DomainEvent['family'];
