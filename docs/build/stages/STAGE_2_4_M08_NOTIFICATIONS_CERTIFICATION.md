# Stage 2.4 — M08 Notifications & Escalation — Post-Merge Certification

**Date:** 2026-07-26
**Module:** `m08-notify` (generic multi-tenant notifications + escalation: templates, safe rendering, delivery
evidence, retry, escalation, preferences, in-app inbox).
**Verdict:** ✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS** (certification on branch
`cert/stage-2-4-m08-notifications`; certification PR pending, not merged).

## 1. Identity

| Fact | Value |
| --- | --- |
| Implementation PR | **#16** |
| Reviewed implementation head | `caebe7e62913b4f299f150e4c8f91e73bc7c0c74` |
| Implementation merge SHA (squash) | `f7a8c6b1f909c2e5602f1cc6c60de68d5f69f81d` |
| Certified baseline SHA (main tested) | `f7a8c6b1f909c2e5602f1cc6c60de68d5f69f81d` |
| Certification branch | `cert/stage-2-4-m08-notifications` (cut from merged main) |
| Parent baseline (pre-merge main) | `f5b06d7dda4619c7062a89c52ac2ee17a3e494f6` (certified Stage 2.3, PR #15) |
| PR #16 | `state: closed`, `merged: true`, `merged_at: 2026-07-26T13:53:42Z` |

**Tree-equivalence:** PR #16 was **squash-merged** (`f7a8c6b` has a single parent `f5b06d7`), so the reviewed
head is not a literal ancestor — ancestry is not required. `git diff caebe7e f7a8c6b` is **empty**: the merged
tree is **byte-identical** to the reviewed head across the entire repository. All intended files present; no
unexpected files introduced.

## 2. Scope certified (merge diff `f5b06d7..f7a8c6b`)

ADR-038…043; the m08 architecture/readiness/plan/completion docs + this certification report;
`packages/m08-notify` (domain, migrations, repository, services, emitter, provider ports, permissions/audit
codes, tests); `packages/contracts/src/notification-events.ts` + the `DomainEvent` union (7 families) + the
contracts smoke; notifications permissions (21, registered **and seeded**); notifications audit codes (29);
event-registry `notification.lifecycle` (GAP-1 closed) + naming-map flag; m08 migrations; `/api/v1/notifications`
API (10 files under `apps/api`) + `AppModule` wiring; m08 tests; build wiring (`tsconfig.json`); manifest Stage
2.4 block + the `certification_2_3` finalization; the assertion-count bump in `contracts`/`m02-identity` smoke.

**Exclusions (verified absent):** no m09/m12/m13/m14/m15/m19+/finance/reconciliation/AI/marketing implementation
(grep of the merge diff for those modules returns nothing but registry/doc lines); no CRM/campaign/dialer; no
real provider SDK or credentials; no arbitrary email/webhook; no organizational-directory ownership; **no second
outbox; no duplicate audit table; no duplicate shared platform service**; no cross-tenant access; no false
production-delivery claim.

## 3. Local gate results (baseline `f7a8c6b`)

Environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative — see §12); Node **v22.14.0**;
npm **10.9.2**; connected via `DATABASE_APP_ROLE=finapp_app` (non-superuser, RLS enforced). Lint ran on a
**wiped `dist`** (replicating CI's lint-before-build order).

| Gate | Result |
| --- | --- |
| Format check | ✅ PASS |
| Lint (wiped dist) | ✅ **0 errors** (13 pre-existing non-blocking warnings only) |
| Build / typecheck | ✅ 0 type errors |
| PURE smoke | ✅ **14 suites, 2066 assertions, 0 failures** (m08-notify 85) |
| Conformance | ✅ **708 assertions** (endpoint perms/audit + RLS convention + `registered_code_count`=len + GAP-1) |
| Migration dry-run | ✅ **16 migrations**, dependency order, checksums valid |
| Fresh PostgreSQL replay | ✅ **16 applied, 0 already-applied** (from an empty database) |
| DB integration + API specs | ✅ **19 specs, 552 assertions, 0 failures** (m08-notify 23, m08-services 36, **api-notify 20**) |

## 4. Database governance (live checks on `finapp_ci`)

- **RLS:** all **8** m08 tables report `relrowsecurity = t` **and** `relforcerowsecurity = t` (8/8); each has a
  `tenant_isolation` policy (8/8). Composite `(tenant_id, id)` PKs; **4** verified composite tenant-safe FKs on
  the child tables (a row cannot reference another tenant's parent).
- **Grants:** **0 DELETE** grants to `finapp_app` on any m08 table; `notification_delivery` grants exactly
  `INSERT, SELECT` (append-only evidence). Mutable aggregates get SELECT/INSERT/UPDATE.
- **Constraints:** one-ACTIVE partial unique indexes (`notification_template_version_one_active`,
  `escalation_policy_one_active`); idempotency unique indexes (`notification_request_idem_key`,
  `escalation_instance_idem_key`); attempt/level CHECKs (`notification_request_attempts_ck` ≥0/≥1,
  `notification_delivery_attempt_ck` ≥1, `escalation_instance_level_ck` ≥0); channel/status/category CHECKs.
- **Tables present (8):** `notification_template`, `notification_template_version`, `notification_request`,
  `notification_delivery`, `escalation_policy`, `escalation_instance`, `notification_preference`,
  `inbox_notification`. No hidden superuser dependency — the DB lane runs as the non-owner `finapp_app`.

## 5. Safe template rendering (§9)

The renderer is **explicit `{{ variable }}` substitution** over declared, typed variables — no expression
language. Verified: the m08 **domain + renderer contain no** `eval`, `Function` constructor, `vm`,
`require`/dynamic import, `process`/`child_process`, `Math.random`, or `Date.now`/`new Date` (the only match is a
doc comment naming their absence; clock use is confined to the service scheduling layer, never the deterministic
path). Rendering is a pure function of (template, values). Negative tests (`m08-notify.smoke`) prove: expression
injection (`{{ 2+2 }}`) and property access (`{{ a.b }}`) rejected as malformed; HTML/script escaped on
email/in-app; oversized template/value rejected; unknown + missing-required variables rejected; non-finite
numbers rejected; errors are structured (no value/secret echoed). Deterministic output asserted (same inputs →
same output). ADR-040.

## 6. Delivery lifecycle, retry & concurrency (§10-11)

`requested → queued → processing → {delivered | failed → retry_scheduled → … → exhausted}` with terminal
delivered/exhausted/cancelled/expired/suppressed; invalid transitions rejected (PURE `checkRequestTransition`).
Proven on a real DB (`m08-services`): a deliverable request dispatches to **delivered** (one append-only
attempt); a transient failure **schedules a retry** then **exhausts** on the last attempt (two attempts
recorded); **exactly one worker claims a contended request** (compare-and-set lease single-winner); cancel is
terminal-guarded; manual retry re-queues; provider secrets are never persisted (evidence carries a safe response
code + category only). Retry is bounded (`maxAttempts`, capped exponential backoff, non-retryable categories stop
immediately) — PURE-tested. ADR-043.

## 7. Escalation model (§12)

Immutable versioned policy (single `escalation_policy` table, one ACTIVE per key, content_hash frozen at publish);
instance lifecycle `pending/active/acknowledged/resolved/cancelled/exhausted/expired`. Proven: open is
**idempotent per key**; a due instance **advances** under a lease; acknowledge → resolve; a resolved instance
**cannot be cancelled** (terminal guard); advancement is **bounded** (no infinite escalation) and lease-guarded
(single-winner). ADR-043.

## 8. Recipient resolution, preferences & privacy (§13-14)

Recipients are declarative refs resolved through a port (org-directory data owned by later modules is not
invented); dedup + deterministic ordering are PURE-tested; a missing recipient fails safe. Preferences: four
categories (optional/operational/security/legal); **security + legal are mandatory and bypass opt-out,
suppression, and quiet hours** (a general opt-out can never silence them — PURE-tested); destination suppression
stops optional but not mandatory; quiet hours defer (never drop). **Privacy/redaction:** audit entries, events,
and delivery evidence carry ids/hashes/channel/status only; the request API view redacts raw variable values (a
`variablesHash` stands in) and the worker lease; the HTTP spec asserts the raw variable value never appears in
the response and the lease is not exposed. ADR-041/042.

## 9. In-app inbox (§15)

Tenant + recipient isolated; unread→read lifecycle with a read timestamp; optimistic-lock-guarded mark-read only
on the owning recipient's unread row. Proven: an in-app delivery creates an inbox row for the recipient; the
recipient marks it read; **another user sees none of it** (cross-user isolation), even in the same tenant.

## 10. Authorization, audit, events & outbox (§16-20)

- **Authorization:** **21** `notifications.*` permissions, **seeded** into the catalogue (7 privileged:
  publish/activate/retire, request.retry, escalation.manage, suppression.manage, platform.administer); no vague
  `notifications.admin`. Every mutating route declares its 3-segment permission (`@Endpoint`), enforced
  server-side (default deny). Proven over HTTP: an `x-permissions` header cannot self-grant authority (403).
- **Audit:** **29** `NOTIFY_*` codes registered (`registered_code_count` 119→**148**, = len(codes),
  conformance-enforced); emitted through the m03 `AUDIT` port in the business tx (no duplicate audit table);
  payloads carry ids/status/reason only — no destinations, bodies, secrets, or variable values.
- **Events / contracts:** `notification.lifecycle` family, **21** event types (version 1), owned by m08,
  registered in event-registry + naming-map (`event_family_registered: true`, GAP-1 closed), and in the contracts
  `DomainEvent` union (6→**7** families). Payloads are versioned, tenant-scoped, correlation/causation-carrying,
  and log-safe.
- **Outbox:** m08 owns **no** outbox — the only `%outbox%` table is m06's `workflow_event_outbox`. m08 publishes
  through it in the caller's transaction (atomic with the state change), so there is no dual-write and no second
  event-delivery path. ADR-004/038.

## 11. Idempotency & API security (§17/21-22)

**Idempotency** is DB-enforced (partial unique indexes) for request creation and escalation opening; a repeated
key returns the stored row, a different-payload reuse is 409 (proven in `m08-services` + `api-notify`). **API
security** (`api-notify`): 401 anonymous, 403 unprivileged (header cannot grant), tenant isolation (another
tenant lists zero templates), request-view redaction, optimistic-lock on mutations, cancel terminal guard,
self-service preferences + inbox. **Webhook SSRF (§22):** destinations are https-only, credentials-in-URL
rejected, and loopback/private/link-local/metadata hosts denied (PURE-tested); there is **no arbitrary-URL
fetcher**. Real webhook delivery is deferred (no false production-delivery claim).

## 12. Authoritative CI (PostgreSQL 16)

Implementation PR **#16**, head `caebe7e`, run **30204816392** (`pull_request`) — **Smoke lane + DB lane both
`success`** on `postgres:16` (the DB lane asserts `server_version_num` is 16.x). Post-merge push to main
`f7a8c6b`, run **30204969089** (`push`) — **success**. The merged tree is byte-identical to the reviewed head, so
the PG16 evidence transfers to the certified baseline. The local PG15.2 run independently re-confirms every gate;
RLS FORCE / `tenant_isolation` / composite-FK semantics are identical on 15 and 16.

## 13. Repository-derived counts (§25)

| Item | Count |
| --- | --- |
| Source files changed vs Stage 2.3 baseline (excl. build output) | **58** (+7098 / −47) |
| Migrations (m08) | **2** (16 total in the repo) |
| Tables | **8** |
| Permissions (`notifications.*`, 7 privileged) | **21** |
| Audit codes (`NOTIFY_*`) | **29** |
| Event types (`notification.lifecycle`) | **21** |
| API endpoints | **22** mutating + **13** reads |
| Smoke suites / assertions | **14** / **2066** (m08 85, conformance 708) |
| DB specs / assertions | **19** / **552** (m08-notify 23, m08-services 36, api-notify 20) |
| ADRs | **6** (ADR-038…043) |

## 14. Documented limitations (deferred, not defects — each verified)

- **Deterministic provider adapters only; no production provider** — `DeterministicProvider` test double; no
  secrets in source/fixtures/migrations/reports; an unconfigured channel fails safe as a retryable provider error
  (Framework Only). Real adapters are a future responsibility behind the `NotificationProvider` port (ADR-038).
- **No always-running dispatcher/timer worker** — dispatch + escalation advancement are service methods invoked
  by tests/callers (like m06's SLA path); a background worker + expiry sweeper are deferred.
- **Recipient directory resolution remains behind a port** — org-chart/manager-chain data owned by later modules
  is not invented; downstream notification fan-out on escalation advance is a documented hook.
- **Escalation evidence via audit + events** — there is no dedicated escalation-history table; the append-only
  trail is the m03 audit spine + `notification.lifecycle` events. Delivery attempts DO have a dedicated
  append-only table.

None weakens any architecture, RLS, authorization, audit, determinism, immutability, or test guarantee.

## 15. Verdict

✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS.** The M08 notifications & escalation module is implemented on `main`
(`f7a8c6b`), byte-identical to the reviewed PR #16 head, with all certification gates executed and green locally
and both authoritative PG16 CI lanes green. Certification is recorded on branch `cert/stage-2-4-m08-notifications`;
the certification PR is pending and **not merged**. No later module (m09+) was touched.
