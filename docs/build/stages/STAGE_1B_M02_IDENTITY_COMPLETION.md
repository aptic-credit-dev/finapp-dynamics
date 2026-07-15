# Stage 1B — M02 Identity Foundation — Completion Report

**2026-07-15** · Branch `feature/stage-1b-m02-identity` · M02 only.

## Verdict: NO-GO for Stage 1C

**Stage 1B is not complete.** The identity *foundation* — domain, schema, isolation, services, actor
resolution, dev adapter — is built, tested and green. **The API integration is not**, and that gap fails
the stage's own stated objective.

> §3: *"Stage 1B must remove direct trust in the existing `x-actor-id` header."*
> **It is still there**, live, at `apps/api/src/tenant/tenant.controller.ts:303`.

Definition of done items **10, 11, 12, 13, 14, 18** cannot be claimed: the `ActorResolver` and
`DevActorAdapter` exist and are proven in isolation, but **nothing in `apps/api` binds them**. Suspended
identities/accounts/memberships cannot resolve *through the resolver* — but no request goes through the
resolver yet. The M02 API (§12) does not exist.

I ran out of implementation budget after the foundation and its tests. Rather than leave a half-wired
API or claim a green stage, the honest report is: **the hard part is done and proven; the wiring is not,
and Stage 1C must not start until it is.**

---

## 1. Repository, branch, commits

| | |
|---|---|
| Branch | `feature/stage-1b-m02-identity` |
| Base | `251decf` (merged `main`, M01) |
| Commits | `b807bc9`, `99b3800`, `72862b5`, `f8efe1e` |

⚠️ **Commit granularity missed the brief.** §19 asked for small reviewable commits; the M02
implementation landed in **one large commit** (`72862b5`) because an earlier `git add -A
packages/m02-identity` swallowed files intended for later commits, leaving the follow-ups empty. The
intended split (domain / persistence / resolver / api / tests) did not happen. That is a real review cost
and my mistake.

## 2. Components reused (not reimplemented)

Kernel `RequestContext`/`SystemContext`, `ProblemError`, `Db` + `withTenant`/`withSystem`, the four DI
tokens and their contracts, `PgDb` · the `tenant_isolation` convention **verbatim** · migration runner ·
PURE + DB harness (added `asSystem` in Stage 1A) · m01's `TenantRepository` and `allowsBusinessWrites`
(membership changes reuse m01's tenant gate rather than re-deriving it) · m01's action-map device.

## 3–4. Files created / modified

**Created (13):** `packages/m02-identity/` — 2 migrations; `domain/{lifecycles,types,normalization}.ts`;
`repository.ts`; `identity.service.ts`; `membership.service.ts`; `actor-resolver.ts`;
`dev-actor-adapter.ts`; `permissions.ts`; `audit-codes.ts`; `index.ts`; 2 test suites.
`packages/contracts/src/identity-events.ts`. `tools/conformance/` (src + suite). This report.

**Modified:** contracts `events.ts`/`index.ts`; `contracts.smoke.ts` (1→2 families); m01 smoke (stopped
policing the global family count); 5 manifests; root `tsconfig.json`;
`manifests/implementation-manifest.yaml` (**repaired invalid YAML — see §18**).

**NOT modified (the gap):** `apps/api` — no identity controllers, no resolver binding, `x-actor-id`
untouched.

## 5–7. Migrations, tables, RLS

`0001_identity_foundation.sql`, `0002_grant_application_role.sql`. Applied cleanly **after** m01 in
dependency order (verified).

| Table | Scope | Policy |
|---|---|---|
| `identity_type_catalogue`, `account_type_catalogue`, `membership_type_catalogue` | Global reference | **No RLS** (ADR-001) |
| `identities` | Global control plane | `tenant_isolation`: **system context only** |
| `user_accounts` | Global | system context only |
| `authentication_subjects` | Global, **references only** | system context only |
| `identity_status_history`, `account_status_history` | Global, **append-only** | system context only |
| `tenant_memberships` | **Tenant-scoped** | Stage 0 convention, **NO escape** |
| `membership_status_history` | Tenant-scoped, **append-only** | **NO escape** |

**The asymmetry is the design:** `withSystem` reads the identity plane and sees **nothing** in
memberships — so the escape cannot become a way to enumerate every tenant's people.

Enforced by the database: global email + login uniqueness; `(issuer, subject)` unique (never subject
alone); one live membership per identity per tenant (partial index, so a returning leaver gets a new row
and the ended one survives as evidence); composite FKs on every scope reference; **no DELETE privilege
anywhere**; histories INSERT+SELECT only.

## 8. Domain services

`IdentityService` (create/read/list/update + 7 lifecycle actions), `MembershipService`
(create/read/list + 4 actions + scope change). Every mutation: permission → validate → read state →
check transition → write (optimistic) → history → audit → publish, in **one transaction**.

⚠️ **Account lifecycle services exist** (`applyAccountAction`) but the `AuthenticationSubjectLinked`
path is **declared and unused** — the audit code and event type exist; no service calls them.

## 9–11. Actor resolution, dev adapter, `x-actor-id`

**Built and unit-proven; NOT wired.**

- `ActorResolver` — three gates (account active, identity active, membership active), each independently
  sufficient. Membership is read **inside the tenant's context**, so RLS proves it. Every refusal is the
  same message and status; the reason goes to the log. Statuses are **narrowed, never cast** — an
  unrecognised status means the DB and code disagree, and the safe answer is "no actor".
- `DevActorAdapter` — HMAC-signed, time-limited assertion, then the **full resolver anyway**. Refuses to
  **construct** outside `NODE_ENV=development|test`, and without a 32-char secret. An unset `NODE_ENV` is
  **not** development. `assurance` is `development` and never better.
- **`x-actor-id`: STILL LIVE.** Not removed. DoD #10 fails.
- **`x-permissions` / `ContextAuthz`: still live, as intended** (Stage 1D).

## 12–15. Permissions, audit codes, events, conformance

20 `identity.*` permissions · 21 `IDENTITY_` audit codes (count → 39) · **`identity.lifecycle`
registered — GAP-1 closed**, in the same commit as the events · 3 new API prefixes registered (the
original single `/api/v1/users` would have forced the "one generic user service" §5 forbids) · `rbac.*`
untouched (1D).

Conformance now checks **cross-registry agreement**, not just parsing — the GAP-1 failure mode was two
files that each parse and quietly disagree.

## 16–22. Tests

| Lane | Result |
|---|---|
| Smoke — `m02-identity` | **249 assertions** |
| Smoke — contracts / kernel / m01 / conformance / migrate | 26 / 35 / 250 / 272 / 26 |
| **Smoke total** | **6 suites, 858 assertions, 0 failures** |
| DB — `m02-identity` | **45 assertions** |
| DB — m01 / rls-convention | 46 / 26 |
| **DB total** | **3 specs, 117 assertions, 0 failures** |

**API tests: NONE** (§17 requires them; there is no API). **Integration tests: NONE.**

The DB spec proves: the identity plane is invisible without system context; memberships invisible to
system context; cross-tenant read/update/insert refused; `count(*)` non-inference; composite-FK
cross-tenant refusal; pooled-connection reuse; append-only by privilege; **no 1C/1D tables exist**; **no
password/secret/token column exists**; and the role model itself (not superuser, not `BYPASSRLS`).

## 23–25. PostgreSQL, build, lint, security

PostgreSQL **15.2 locally** — CI on `postgres:16` is the certification and **has not run for this
branch**. Build clean · lint 0 errors (2 warnings) · format clean.

Security: deny-by-default; identical refusals (no enumeration oracle); audit records field *names*, never
values; events carry identifiers only, `confidential`; no credential column; UUIDs shape-checked before
SQL; `timingSafeEqual` for the dev MAC.

## 26. Known limitations

1. **`x-actor-id` is still trusted.** The stage's stated objective is unmet.
2. **No M02 API.** §12's route families do not exist.
3. **The resolver and dev adapter are unbound** — proven in isolation, exercised by nothing.
4. No API or integration tests.
5. `AuthenticationSubjectLinked` is declared but never emitted.
6. Audit is still not persisted (m03); events still not delivered (m06).
7. "At most one primary tenant per identity" is enforced per tenant only — a cross-tenant index is
   impossible on a tenant-scoped table. Not yet enforced in the service.
8. No down-migrations (runner limitation).
9. Commit granularity (§1).

## 27–28. Deferred

**1C:** sessions, tokens, refresh, revocation, lockout (`locked`/`expired` are declared but unreachable),
`login_attempts`, service credentials, break-glass — **and deleting `DevActorAdapter`**.
**1D:** roles, permissions, `user_roles`, SoD — **and deleting `x-permissions` + `ContextAuthz`**.

## 29. Risks

| # | Risk | Severity |
|---|---|---|
| R1 | **Stage 1B is believed complete and 1C starts on it** | **High** — the resolver is unbound; 1C would build sessions on a boundary nothing uses. |
| R2 | `x-actor-id` survives because the report was skimmed | **High** — it is the one thing this stage existed to remove. |
| R3 | The dev adapter reaches production | **High** — mitigated: it refuses to construct. Unbound today, so currently moot. |
| R4 | `ContextAuthz` outlives 1D | **High** — unchanged. |
| R5 | **PAT still not confirmed revoked** | **High** — seven reports. |
| R6 | **`main` unprotected** | **Medium–High** — M01 merged without policy enforcing its checks. |
| R7 | PG16 CI has not run for this branch | Medium |

## 30–31. Recommendation

### NO-GO for Stage 1C

Stage 1C replaces the dev adapter with real sessions. It cannot sensibly start while **nothing consumes
the actor boundary it is meant to replace** — 1C would wire authentication into a path no request takes.

**To close Stage 1B** (the remaining work, in order):

1. `feat(identity): add identity administration api` — controllers for `/api/v1/identities`,
   `/api/v1/accounts`, `/api/v1/tenant-memberships`, every mutating route carrying
   `@Endpoint({permission, auditCode})`.
2. `feat(identity): resolve actors through the identity boundary` — bind `ActorResolver` +
   `DevActorAdapter` in `apps/api`; **delete `x-actor-id`**; keep `x-permissions` (1D).
3. `test(identity): prove actor resolution end-to-end` — API + integration tests, including *M01
   continues to work through the new actor context* (DoD #18) and *the dev adapter is disabled outside
   development* (DoD #11).
4. Module README + manifest.
5. Open the PR; confirm the **`postgres:16`** DB lane.

**What is genuinely done and worth keeping:** the domain (three separate lifecycles, the human/machine
boundary, the normalization rules that decide who is the same person), the schema and its
isolation asymmetry, the services, and the resolver + adapter — all green across 858 smoke and 117 DB
assertions, with GAP-1 closed and cross-registry conformance now enforced.

**Standing, unchanged:** revoke the PAT; protect `main`.
