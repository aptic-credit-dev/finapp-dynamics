# Stage 2.4 — M08 Notifications & Escalation — Completion Report

**Module:** `m08-notify` · **Branch:** `feature/stage-2-4-m08-notifications` · **Baseline:** certified Stage 2.3
main `f5b06d7dda4619c7062a89c52ac2ee17a3e494f6` (PR #15 merge, verified). **Status:** implemented on branch;
implementation PR open, **not merged** (awaiting review + post-merge certification).

Status legend used below: **implemented** = code exists on the branch · **tested locally** = green on the local
PostgreSQL 15.2 lane · **verified by CI** = green on the authoritative PostgreSQL 16 CI lane · **not yet merged**
· **deferred** = documented, out of MVP scope.

## What was built

A generic, multi-tenant **notifications + escalation** service — reusable by Feedback, Cases, Workflow, Finance
and others through events/contracts, none embedding delivery logic. **Not** a marketing/campaign engine.

- **PURE domain** (`src/domain/`): channel abstraction + destination normalization with a **webhook SSRF
  guard**; **safe deterministic template rendering** (`{{ variable }}` only — no eval/Function/vm, HTML
  escaping, hard size/count limits); typed variable validation; template/request/escalation state machines;
  retry-policy + escalation-level calculators; recipient dedup; preference/suppression evaluation.
- **Persistence** (`0001_notify.sql`, **8 tables**, all RLS ENABLE+FORCE + `tenant_isolation`, composite
  `(tenant_id,id)` keys + composite FKs): `notification_template`, `notification_template_version` (immutable
  `spec`, one ACTIVE per template), `notification_request` (worker **lease** + idempotency), `notification_delivery`
  (append-only evidence), `escalation_policy` (immutable spec, one ACTIVE per key), `escalation_instance`
  (lease), `notification_preference` (user prefs + destination suppression), `inbox_notification`.
  `0002_grant_application_role.sql`: **NO DELETE anywhere**; delivery evidence INSERT+SELECT only.
- **Services** (permissioned, transactional): `TemplateService`, `NotificationService` (idempotent creation,
  preference/suppression gating, lease-based worker-safe dispatch + retry + append-only evidence + inbox
  fan-out), `EscalationService` (policy lifecycle + instance open/advance/ack/resolve/cancel), `PreferenceService`,
  `InboxService`. One `M08Emitter` writes audit (m03) + events on the **one outbox m06 owns**, in the business tx.
- **API** (`/api/v1/notifications`, **22 audited mutating endpoints + 13 reads**): template authoring +
  lifecycle, request create/cancel/retry + delivery reads, escalation policies + instances, self-service
  preferences + inbox. Dispatch + escalation advancement are worker paths, deliberately NOT exposed over HTTP.

## Scope

| Fact | Value |
|---|---|
| Source files changed vs main (excl. build output) | **57** (+6985 / −47); `packages/m08-notify` ~33, `apps/api/src/notify` 6 + spec |
| Migrations | **2** (`0001_notify.sql`, `0002_grant_application_role.sql`); 16 total in the repo, m08 last |
| Tables created | **8** |
| Permissions added | **13** (`notifications.*`, 7 privileged) — seeded by the migration |
| Audit codes added | **29** (`NOTIFY_*`); `registered_code_count` 119 → **148** |
| Events added | `notification.lifecycle` family, **21** event types; in contracts union (6 → **7** families) |
| ADRs | ADR-038…043 |

## Governance honoured

| Guarantee | How |
|---|---|
| Tenant isolation | RLS ENABLE+FORCE + `tenant_isolation` on all **8** tables; asserted through the non-owner app role. |
| Authorization | Default-deny; every mutation `authz.require`s its 3-segment permission in the service; a header cannot grant authority (proven over HTTP). |
| Safe rendering | Substitution-only; no eval/Function/vm/require; escaping; bounded; deterministic; malformed placeholders rejected at validation (ADR-040). |
| Immutability | Published template/policy `spec` never updated; `content_hash` frozen; a change is a new version (ADR-039). |
| Sensitive-data minimisation | Audit + events + delivery evidence carry ids/hashes/channel/status only — never destinations, bodies, secrets, or variable values (ADR-041). |
| Append-only evidence | `notification_delivery` INSERT+SELECT only; no DELETE grant on any m08 table. |
| Idempotency | Partial unique indexes on request creation + escalation opening; same-payload replay returns the stored row, different-payload → 409. |
| Concurrency | Compare-and-set LEASE = single-winner dispatch/advance (proven under contention); bounded, idempotent. |
| Single outbox | m08 owns no outbox; publishes `notification.lifecycle` through m06's `WorkflowOutbox` (ADR-004/038). |
| Preferences | optional/operational/security/legal categories; security+legal bypass all suppression (ADR-042). |
| Webhook SSRF | https-only, no credentials, private/loopback/link-local/metadata hosts denied; no arbitrary fetcher (ADR-038). |

## Verification (authoritative gate)

- **Build:** `tsc --build` clean. **Lint:** 0 errors (pre-existing non-blocking warnings only), on a wiped `dist`
  (replicating CI's lint-before-build order). **Format:** clean.
- **Smoke lane (tested locally):** **14 suites, 2066 assertions, 0 failed** — including `m08-notify` (85) and
  `conformance` (**708**, which validates every `@Endpoint` permission + audit code against the registries, the
  RLS convention over the new migrations, `registered_code_count` = len(codes), and GAP-1 for the newly-registered
  `notification.lifecycle` family).
- **Migrations (tested locally):** 16 in dependency order; dry-run + **fresh replay from an empty database** (16
  applied, 0 already-applied).
- **DB lane (tested locally, real PostgreSQL 15.2, non-owner `finapp_app` role so RLS is enforced):** **19 specs,
  552 assertions, 0 failed** — `m08-notify` (23), `m08-services` (36), `api-notify` (20 HTTP end-to-end), and the
  whole prior baseline still green.
- **CI (PostgreSQL 16, authoritative):** to be observed on the implementation PR — **not yet verified by CI** at
  the time of writing.

Local environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative); Node **v22.14.0**; npm
**10.9.2**. RLS FORCE / `tenant_isolation` / composite-FK semantics are identical on 15 and 16, so the local run
is a real proof; CI on 16 is the certification.

## Section-by-section evidence (matrix)

RLS + cross-tenant isolation + fail-closed (`m08-notify.db-spec`); no-DELETE + append-only delivery grants
(`m08-notify.db-spec`); permission seed (21) + privileged set (7); one-ACTIVE + idempotency unique indexes;
CHECK constraints. Template lifecycle + immutability + default-deny; idempotent request creation; suppression +
mandatory-category bypass; dispatch → delivered, retry → exhausted, single-winner under concurrent dispatch;
cancel + manual retry; in-app → inbox + recipient isolation; escalation lifecycle + idempotent open + bounded
advance; preferences (`m08-services.db-spec`). HTTP: 401 anon, 403 unprivileged (header cannot grant), tenant
isolation, request-view redaction of variable values + lease, author→publish→activate→create→cancel,
preferences + inbox (`api-notify.db-spec`). Safe-template negatives + retry/escalation/preference math
(`m08-notify.smoke`).

## Limitations (deferred, documented — not defects)

- **No real notification provider** — deterministic test doubles only; no secrets; an unconfigured channel fails
  safe as a retryable provider error (Framework Only). Real email/SMS/webhook adapters are a future
  responsibility behind the `NotificationProvider` port (ADR-038).
- **No standing dispatcher/timer worker** — dispatch + escalation advancement are service methods invoked by
  tests/callers (like m06's SLA path); a background worker + expiry sweeper are deferred.
- **Recipient resolution** is by declarative ref through a port; org-chart/manager-chain data owned by later
  modules is not invented here. Downstream notification fan-out on escalation advance is a documented hook.
- **Quiet-hours deferral** is evaluated and returned by the domain; full deferred-window scheduling is a
  follow-on. No escalation-history table (the trail is the audit spine + `notification.lifecycle` events).

## Scope discipline (contamination)

Only `m08-notify` (+ its API wiring, registries, contracts family, tests, docs) was built. **No m09/m12/m13/
finance/reconciliation/AI implementation** (grep of the merge diff for those modules returns nothing but
registry/doc lines). No shared platform service was duplicated; no second outbox; no duplicate audit table; no
architecture, RLS, authorization, audit, determinism, immutability, or test guarantee was weakened. The manifest
change is confined to the m08 block + the `certification_2_3` finalization. The implementation PR is open; it is
**not merged**.
