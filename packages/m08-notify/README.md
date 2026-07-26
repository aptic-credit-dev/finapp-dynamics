# m08-notify — Notifications + escalation (Stage 2.4)

Generic, multi-tenant **notifications + escalation** infrastructure. Reusable by Feedback, Cases, Workflow,
Finance and any module that needs to notify a human or escalate an unhandled event — none of them embed
delivery logic. **Not** a marketing/campaign engine.

## Layers

- **PURE domain** (`src/domain/`, no I/O): a channel-neutral core (email / sms / in_app / webhook) with
  destination normalization + an **SSRF guard** for webhooks; **safe deterministic template rendering**
  (`{{ variable }}` substitution only — no eval/Function/vm, escaping, hard size/count limits); typed variable
  validation; the template / request / escalation state machines; the retry-policy calculator; the escalation
  level calculator; recipient dedup; and preference/suppression evaluation with mandatory-category bypass.
- **Persistence** (`migrations/0001_notify.sql`, 8 tables, all RLS ENABLE+FORCE + `tenant_isolation`, composite
  `(tenant_id,id)` keys + composite FKs): `notification_template`, `notification_template_version` (immutable
  `spec`, one ACTIVE per template), `notification_request` (lease + idempotency), `notification_delivery`
  (append-only evidence), `escalation_policy` (immutable spec, one ACTIVE per key), `escalation_instance`
  (lease), `notification_preference` (user prefs + destination suppression), `inbox_notification`.
  `0002_grant_application_role.sql`: NO DELETE anywhere; delivery evidence INSERT+SELECT only.
- **Services** (permissioned, transactional): `TemplateService` (authoring/versioning/lifecycle),
  `NotificationService` (idempotent request creation, preference/suppression gating, lease-based worker-safe
  dispatch + retry + delivery evidence + inbox fan-out), `EscalationService` (policy lifecycle + instance
  open/advance/ack/resolve/cancel), `PreferenceService`, `InboxService`. One `M08Emitter` writes audit (m03) +
  events on the **one outbox m06 owns**, in the business tx.
- **API** (`/api/v1/notifications`): template authoring + lifecycle, request create/cancel/retry + delivery
  reads, escalation policies + instances, self-service preferences + inbox. Every mutating route is an audited
  `@Endpoint` with a permission enforced server-side (default deny). Dispatch + escalation advancement are
  worker paths and are NOT exposed over HTTP.

## Governance

Tenant isolation (RLS FORCE on all 8 tables), default-deny authorization (13 privileged/plain `notifications.*`
permissions, seeded), audit via the m03 port (29 `NOTIFY_*` codes, no duplicate audit table), the single m06
outbox for `notification.lifecycle` (21 event types), idempotent creation + dispatch, lease-based single-winner
concurrency, safe deterministic rendering, and sensitive-data minimization (evidence/events carry ids + hashes,
never destinations/bodies/secrets/variable values). ADR-038…043.

## Providers

Ports/adapters. m08 ships **deterministic test doubles only** — no real third-party integration, no committed
secrets. A real provider (email/SMS/webhook) is a future adapter behind the `NotificationProvider` port; an
unconfigured channel fails safe as a retryable provider error (Framework Only).

## Tests

`test/m08-notify.smoke.ts` (PURE domain), `test/m08-notify.db-spec.ts` (RLS/grants/constraints/isolation),
`test/m08-services.db-spec.ts` (services end-to-end incl. concurrency), and `apps/api/test/api-notify.db-spec.ts`
(HTTP end-to-end). Run the smoke lane with `npm run test:smoke`; the DB lane with `npm run test:db` against a
real PostgreSQL (CI is PostgreSQL 16, authoritative).
