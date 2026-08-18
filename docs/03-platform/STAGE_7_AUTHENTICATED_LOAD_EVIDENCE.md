# STAGE-7 AUTHENTICATED DB-WRITE LOAD — TECHNICAL EVIDENCE (Contabo staging, PG16)

> Tier-1 automated execution on the approved **Contabo** staging host (ADR-131). Closes the honest limitation
> recorded in `STAGE_7_CONTABO_FULLSTACK_EVIDENCE.md` §Limitations ("authenticated DB-write load was not
> executed — the synthetic bootstrap seeds identities but not loginable credentials"). This is **NOT** Tier-2
> operational acceptance and **NOT** a production GO. The `load_and_chaos_at_scale` workstream remains
> `requires_review`; production readiness remains `CONDITIONAL_GO`. Observed metrics are printed beside the
> approved SLO thresholds **for information only** — acceptance vs SLO is a human COO/Ops decision (OQ#13). No
> passwords, tokens, or customer data appear here or were committed. Synthetic non-PII data only.

## What changed since the full-stack evidence

The full-stack run exercised the auth **guard** and the DB-free health path but not authenticated write
throughput, because no login credentials were seeded. This run adds the canonical missing piece:

- **`deploy/staging/seed-login.mjs`** — makes the two synthetic identities from `bootstrap-synthetic.mjs`
  loginable using the **canonical** credential mechanism: `argon2idHasher.hash()` from `@finapp/m02-auth`
  produces the Argon2id verifier the app's own login path verifies. The password is supplied via `LOGIN_PW`
  (session-only), **never printed, logged, or stored in clear** — only its Argon2id hash is persisted, exactly
  as a real login. It also grants the privileged identity live `tenant_memberships` in both synthetic tenants
  for multi-tenant load. Superuser seeding; the app still runs as the non-owner `finapp_app` role.
- **`deploy/staging/auth-load-harness.mjs`** — a real cookie/session client: `POST /api/v1/auth/login` →
  `finapp_session` cookie + `csrfToken`; authenticated `GET` reads; authenticated `POST` **writes** (create
  identity) with the `x-csrf-token` double-submit; multi-tenant via `x-tenant-id`; plus a negative security
  matrix. Refuses production + non-loopback; writes create only synthetic **non-PII machine** identities
  (`service_identity`, classification `internal`). Pure-function self-test: `auth-load-selftest.mjs`.

## Environment

Contabo staging `169.58.194.151` — **PostgreSQL 16.15** + API (merged `main`), FORCE RLS active, `finapp_app`
NOBYPASSRLS non-owner, 2 synthetic tenants. The harness ran **inside the api container** against its own
`http://127.0.0.1:3000` (loopback), so nothing was exposed off-host. The full write path was exercised —
each create persists a row **plus** its audit event and transactional-outbox entry.

## Authenticated load results (real PG16; 0×5xx, 0 errors across all scenarios)

| Scenario | Conc | Requests | Statuses | p50 ms | p95 ms | p99 ms | max ms | rps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| auth_read (GET /identities) | 12 | 469 | 200×469 | 96.7 | **192.4** | 258.7 | 292.7 | 115.9 |
| auth_write (POST /identities) | 8 | 407 | 201×407 | 74.0 | **125.1** | 142.3 | 152.6 | 99.7 |
| auth_mixed (read+write) | 12 | 555 | 200×279 / 201×276 | 82.7 | **161.1** | 188.6 | 212.8 | 135.8 |
| auth_write_burst | 32 | 177 | 201×177 | 397.4 | **508.0** | 529.7 | 538.1 | 73.7 |
| multi_tenant_read (2 tenants) | 12 | 349 | 200×349 | 96.0 | **193.0** | 245.1 | 261.5 | 112.2 |

**≈ 860 authenticated identity CREATE writes** committed to PG16 across the write/mixed/burst scenarios (all
`201`, 0 failures) — real authenticated DB writes through auth → RBAC → CSRF → service → audit → outbox → RLS.

### Negative security matrix (authenticated path) — all PASS

| Check | Expected | Got | Pass |
| --- | --- | --- | --- |
| Unauthenticated read denied | 401 | 401 | ✅ |
| Write without CSRF denied | 403 | 403 | ✅ |
| Unprivileged identity write denied | 403 | 403 | ✅ |

Proves auth, RBAC permission enforcement, CSRF double-submit, and requester-permission (SoD-adjacent) controls
hold under the authenticated write path — not just the unauthenticated guard.

## Observed vs approved SLO (OQ#13) — INFORMATIONAL, not acceptance

Approved targets: availability ≥ 99.9%, p95 ≤ 200 ms, p99 ≤ 500 ms, platform error rate (excl. expected 4xx)
≤ 0.5%.

| Scenario | p95 ≤ 200 | p99 ≤ 500 | err ≤ 0.5% | Observed vs SLO |
| --- | --- | --- | --- | --- |
| auth_read | ✅ 192.4 | ✅ 258.7 | ✅ 0% | meets |
| auth_write | ✅ 125.1 | ✅ 142.3 | ✅ 0% | meets |
| auth_mixed | ✅ 161.1 | ✅ 188.6 | ✅ 0% | meets |
| **auth_write_burst (32 conc)** | ❌ **508.0** | ❌ **529.7** | ✅ 0% | **exceeds latency SLO** |
| multi_tenant_read | ✅ 193.0 | ✅ 245.1 | ✅ 0% | meets |

**Honest finding (bottleneck):** at **8–12** concurrency, authenticated reads, writes, mixed, and multi-tenant
reads **meet** the approved p95/p99/error SLOs on this single-node box. At **32** concurrent writes the p95/p99
**exceed** the latency SLOs (though error rate stays 0% and no request failed). This is expected on a
**single API replica + single PostgreSQL** with each write carrying audit + outbox work, and is a genuine
**capacity-planning signal** — production sizing should validate the target write-concurrency profile (refined
from the first pilot tenant's real volumes) and consider horizontal API scaling / DB connection tuning. It is
recorded as an observation, **not** accepted, and **not** waved away.

## What this does and does not establish

- **Establishes (Tier-1):** authenticated login + authenticated reads + authenticated **DB writes** + multi-tenant
  authenticated concurrency execute correctly on real PG16 with 0 errors; the security controls hold under load;
  observed latency meets the approved SLOs up to ~12 concurrency and exceeds them under a 32-concurrency write
  burst.
- **Does NOT establish:** operational acceptance (COO/Ops, Tier-2); the production write-concurrency profile
  (pilot-derived, OQ#14); a maker/checker **finance** posting load — deliberately **excluded** (platform rule:
  AI/automation must never post or approve controlled finance actions; the maker/checker-adjacent evidence here is
  the authenticated-write + authz-deny matrix, not a journal posting).

## Cleanup / footprint

The write scenarios created synthetic `service_identity` rows (non-PII, classification `internal`,
`stg-load-*` display names) on the staging DB. They are harmless synthetic staging data and are left in place
(deleting audited rows would disturb the audit/outbox trail). A fresh production DB is a commissioning
requirement regardless (see the full-stack evidence §Future production).

## Status

`load_and_chaos_at_scale` **WORKSTREAM-ENTRY** criteria (charter §7.2) are now materially satisfied — test
environment identified (Contabo staging), infra resolved (OQ#16 Contabo), evidence template (§5.3), SLO targets
(OQ#13). The workstream is **not transitioned by this evidence**; the status change + operational acceptance are
a **human COO/Ops** act. No Tier-2 acceptance, no GO.
