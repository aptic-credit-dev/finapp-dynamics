# Stage 6D-4 — M36 Webhooks & Event Streaming — Certification

**Module:** `m36-events` · **Verdict:** **CERTIFIED ON BRANCH** · **Date:** 2026-08-12. **Seventh Stage-6 module certified.**
**ADR:** ADR-123 (outbound fan-out over M06's ONE outbox — not a second outbox/delivery path; framework-only / fail-closed external egress; SSRF-allow-listed URLs; opaque `secretref:` signing secrets; human/maker-checker endpoint activation; registered-family subscriptions; `events.*` closes GAP-4; `webhook_`/`eventstream_`/`events_` prefixes).

## A. Merge & baseline

| Item | Value |
|------|-------|
| Governance PR | #91 — merged → `main` `72a138e` (m36 `approved_for_build`) |
| Implementation PR | #92 — closed, merged, merged_at `2026-08-12T06:48:39Z` |
| Reviewed implementation head | `0688a58` |
| Implementation merge SHA | `1ad7d4d2005f2396302ba556b8949ff0511ec128` (single parent `72a138e` = squash) |
| Tree equivalence | `git diff 0688a58 1ad7d4d` = **EMPTY** (byte-identical) |
| Current `main` / certification baseline | `1ad7d4d2005f2396302ba556b8949ff0511ec128` |
| Certification branch | `cert/stage-6-m36-events` (from `1ad7d4d`) |
| Implementation CI (reviewed head `0688a58`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |
| Implementation CI (merge commit `1ad7d4d`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |

## B. Scope confirmed

module `m36-events` · Stage 6D-4 · **Webhooks & Event Streaming** (external webhook endpoints, event subscriptions/filters,
webhook delivery evidence, tenant event streams + consumer cursors) · **mvp:false** · a governed **outbound fan-out** over the
platform's domain events — **not a second outbox / event-delivery path**, **not a secrets manager**, **framework-only**
external egress, **no arbitrary code** · **`/api/v1/webhooks`** + **`/api/v1/events`** · `events.*` permissions · audit
prefixes `WEBHOOK_`/`EVENTSTREAM_` · event families `webhook.lifecycle` + `eventstream.lifecycle` · one m06 outbox · consumes
the platform's domain events through a fail-closed `EventSourcePort` (fed by the m06 dispatcher) and delivers through a
fail-closed `WebhookDeliveryPort` · uses the **`webhook_`/`eventstream_`/`events_`** table prefixes (`integration_*` is m23's,
`connector_*` is m33's, `marketplace_*` is m34's, `devportal_*` is m35's) · **M41 real secrets + a real HTTP runtime deferred behind fail-closed ports**.

## C. Local certification gates (clean checkout on baseline `1ad7d4d`, PostgreSQL 15.2 throwaway, non-owner `finapp_app`)

| Gate | Result |
|------|--------|
| generated-output cleanup (`tsc --build --clean`) | done |
| format:check | pass |
| lint | **0 errors** (68 pre-existing baseline warnings; m36 adds none) |
| build | pass |
| smoke lane | 41 suites, **6891** assertions, 0 failures (m36-events 87 · conformance **3546**) |
| migration ordering + checksums (dry-run) | pass |
| fresh migration replay | **70** migrations applied (m36 = 2; no historical migration edited) |
| DB/API lane (fresh DB) | **85** specs, **2607** assertions, 0 failures |
| — `m36-events` DB spec | 32 |
| — `m36-services` DB spec | 22 |

Authoritative CI is **PostgreSQL 16**; the local lane ran on PG 15.2 (honest — no PG16 claimed locally). The implementation
PR's PG16 DB lane, the merge commit's PG16 DB lane, and this cert PR's lanes are the authoritative PG16 evidence.

## D. Database — live catalogue evidence (m36-owned 9 tables, non-owner application role)

9 tables · **9/9 RLS ENABLE · 9/9 FORCE · 9/9 `tenant_isolation`** · **4 composite tenant-safe FKs · 0 unsafe single-column
tenant FKs** · **0 DELETE grants** · 5 append-only ledgers (INSERT+SELECT: `webhook_delivery`, `webhook_review`,
`eventstream_subscription`, `events_history`, `events_idempotency`) · 4 mutable aggregates (INSERT+SELECT+UPDATE:
`webhook_endpoint`, `webhook_subscription`, `eventstream_config`, `eventstream_cursor`) · **20 governance CHECK constraints** ·
4 version columns · **0 float** (a cursor position is `bigint`) · **0 secret-value columns** (`webhook_endpoint.signing_secret_ref`
is a `text` opaque pointer with a `secretref:` shape CHECK) · **1 endpoint-immutability trigger** (`webhook_endpoint` — an
approved endpoint's `url`/`endpoint_key` is frozen) · **1 outbox (m06 `workflow_event_outbox` — m36 owns none)** · 8
`events.*` permissions (3 privileged, all 3-segment, no wildcard) · 17 `WEBHOOK_`/`EVENTSTREAM_` audit codes · `webhook.lifecycle`
(4 types) + `eventstream.lifecycle` (3 types) · **70 total migrations**. reference_tables reconciled **34 → 9** (documented in
module-registry + implementation-manifest — the 34 was the full reference-implementation baseline; this Stage-6D-4 core is the
governed outbound fan-out over the platform's domain events).

## Verdicts

| Aspect | Verdict |
|--------|---------|
| **Outbound fan-out over the ONE m06 outbox — not a second outbox** — m06 owns THE ONE outbox/event-delivery path; m36 owns none (DB-proven: the only `%outbox%` table is `workflow_event_outbox`). `RelayService` CONSUMES domain events through a fail-closed `EventSourcePort` (default `EmptyEventSource` invents no traffic; the m06 dispatcher is the real source) and records append-only `webhook_delivery`; m36 source reads NO m06/other-module table | **PASS** |
| **Framework-only / fail-closed external egress** — webhook delivery runs behind a fail-closed `WebhookDeliveryPort` bound to `UnavailableWebhookDelivery` (every attempt durably **BLOCKED**; no network/provider); no eval/`Function`/`vm`/shell/`child_process`/`fetch`/http in source; a real HTTP runtime drops in behind the port unchanged | **PASS** |
| **SSRF allow-list** — an endpoint URL must be https to a PUBLIC host (`validateEndpointUrl`): localhost/loopback/`10.x`/`172.16–31`/`192.168.x`/`169.254.x` (incl. the `169.254.169.254` metadata address)/CGNAT, embedded credentials, and malformed URLs are refused, fail closed | **PASS** |
| **Not a secrets manager (M30 seam / M41 boundary)** — an endpoint signing secret is an opaque `secretref:` pointer (`webhook_endpoint_secret_ref_ck`; the m30 seam); **0 secret-value columns**; real resolution deferred to M41 behind a fail-closed port | **PASS** |
| **Human-governed controlled activation; AI cannot approve** — activating an endpoint requires a passing validation + an independent human approver (`webhook_review` `decided_by <> requested_by` + `_decider_ck`; `evaluateApprovalGate`); the requester cannot self-approve; AI/system/automation are refused | **PASS** |
| **Approved-endpoint immutability** — an approved endpoint's `url`/`endpoint_key` is immutable (trigger — an approved egress target can never be silently repointed); a rejected endpoint is terminal; one active endpoint per key | **PASS** |
| **Registered families only / privacy** — a subscription and a stream may only target a REGISTERED `DOMAIN_EVENT_FAMILIES` family (`isRegisteredEventFamily`); delivery/stream payloads are privacy-safe (ids/families/types/statuses/reason codes only — never a signing secret, an event body or an endpoint credential) | **PASS** |
| **Idempotent, bounded delivery** — at most one `delivered` per endpoint per event (`webhook_delivery_one_delivered`); attempts are bounded (dead_letter past max); replay is a controlled action (`events.delivery.replay`) | **PASS** |
| **Events / outbox** — `webhook.lifecycle` (4 types) + `eventstream.lifecycle` (3 types) registered once (m36-owned, newest tail), published through the one m06 outbox (m36 owns none) | **PASS** |
| **Permissions** — `events.*`, 8 codes all 3-segment, 3 privileged (`webhook.approve`, `delivery.replay`, `control.administer`); no `events.admin`/wildcard; default deny | **PASS** |
| **Audit** — 17 `WEBHOOK_`/`EVENTSTREAM_` codes, registry **865**, source↔registry parity; no secret/body/credential in payloads | **PASS** |
| **Tenancy / privacy** — FORCE RLS across endpoints/subscriptions/deliveries/streams/cursors; a subscriber receives only its own tenant's events; cross-tenant invisible; composite tenant-safe FKs; monotonic bigint cursor | **PASS** |
| **No REST bypass** — every mutating `/api/v1/webhooks` + `/api/v1/events` route authorizes an `events.*` permission via `@Endpoint`; the internal fan-out relay is dispatcher-driven (not a REST surface); reads default-deny in-service | **PASS** |
| Contamination | **CLEAN** |

## Metrics

migrations 2 (total 70) · tables 9 · FORCE RLS 9 · policies 9 · composite FKs 4 · unsafe tenant FKs 0 · DELETE grants 0 ·
append-only ledgers 5 · mutable aggregates 4 · governance CHECKs 20 · version columns 4 · float 0 · secret-value columns 0 ·
immutability triggers 1 · permissions 8 (privileged 3) · audit codes 17 (registry 865) · event families 2 (`webhook.lifecycle`
4 types + `eventstream.lifecycle` 3 types) · outboxes 1 (m06) · routes: `/api/v1/webhooks` + `/api/v1/events` · smoke 6891/41 ·
conformance 3546 · DB/API 2607/85 (m36-events 32 · m36-services 22).

## Contamination — CLEAN

Only `packages/m36-events/*` + the `webhook.lifecycle`/`eventstream.lifecycle` contracts families + `apps/api/src/events/*` +
registries/manifests/docs were added on the implementation branch. **m23/m28/m30/m31/m32/m33/m34/m35 source untouched** (the
m06 outbox is consumed by contract, not read or modified — m36 owns no outbox; no `integration_*`/`connector_*`/`marketplace_*`/
`devportal_*` collision — m36 uses `webhook_`/`eventstream_`/`events_`); no m37+/m41 implementation; no second outbox/delivery/
scheduler/notification/RBAC/audit/secrets engine; no production network/provider dependency; no arbitrary-code runner; no
historical migration edited; no business-state mutation; no permission/RLS bypass.

## Documented limitations

- `mvp:false`. reference_tables reconciled **34 → 9** — the governed outbound fan-out core.
- The m06 event source, the real HTTP delivery runtime and the M41 secret backend are deterministic offline doubles /
  fail-closed ports; the real HTTP runtime and the real M41 drop in behind the ports unchanged (an unavailable delivery
  runtime yields a durable BLOCKED outcome — never a false "delivered").
- Integration governance/QA/release (m37), scheduler/automation/extensions (m38), commercial SaaS (m39) and security/secrets
  (m41) are deferred (not this module).

## Report path

`docs/build/stages/STAGE_6_M36_EVENTS_CERTIFICATION.md` (this file); implementation evidence lives in PR #92.

## Verdict: **CERTIFIED ON BRANCH**

Evidence-only certification. No runtime code, migration, test, registry or contract was changed on this branch.
