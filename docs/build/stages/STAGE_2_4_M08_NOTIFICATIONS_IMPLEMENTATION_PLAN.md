# Stage 2.4 — M08 Notifications & Escalation — Implementation Plan

Grounded in the m07 pattern. Built on `feature/stage-2-4-m08-notifications` from certified `f5b06d7`.

## Commit sequence (as built)

1. **contracts** — `notification.lifecycle` family (21 event types) in `notification-events.ts`; wired into the
   `DomainEvent` union + `DOMAIN_EVENT_FAMILIES`; contracts smoke bumped (6→7 families).
2. **package skeleton + vocabularies** — `packages/m08-notify` (package.json, tsconfig, root + apps/api refs);
   21 `notifications.*` permissions; 29 `NOTIFY_*` audit codes.
3. **PURE domain** — limits, channels (+ SSRF guard), template spec + validation, safe renderer, variable
   validation, lifecycles, retry, escalation, recipients, preferences; hash util.
4. **migrations** — `0001_notify.sql` (8 tables, RLS FORCE, composite keys/FKs, one-active + idempotency + lease
   + append-only, permission seed) and `0002_grant_application_role.sql` (no DELETE; delivery INSERT+SELECT).
5. **repository + emit + errors + provider** — all SQL (optimistic-lock CAS, lease claim, append-only insert);
   `M08Emitter` (audit + m06 outbox); provider ports + `DeterministicProvider`.
6. **services** — Template, Notification (create/idempotency/suppression/dispatch/retry/cancel), Escalation
   (policy + instance), Preference, Inbox; package `index.ts`.
7. **API** — `apps/api/src/notify` (views + 4 controllers + module); wired into `AppModule`.
8. **registries + manifest** — permission/audit/event registries; naming-map `event_family_registered: true`;
   manifest m08 → implemented + `certification_2_4`; finalize `certification_2_3`.
9. **tests** — smoke (domain), db-spec (governance), services-db-spec (end-to-end + concurrency), api-http-spec.
10. **docs** — README, architecture/readiness/plan/completion, ADR-038…043.

## Design choices

- 8 tables (module-registry reference baseline). Escalation policy collapses definition+version into one
  immutable versioned table (ADR-043). Preference table serves both user prefs and destination suppression.
- Dispatch + escalation advancement are **worker service methods** invoked by tests/callers — a standing
  dispatcher worker is deferred (like m06's SLA path), and those paths are not exposed over HTTP.
- Idempotency keys: request creation and escalation opening; enforced by partial unique indexes (DB is the
  final layer), with a same-payload return / different-payload 409 at the service.

## Verification

Every gate actually executed; PostgreSQL 15.2 locally, PostgreSQL 16 in CI (authoritative). Counts recorded in
the completion report.
