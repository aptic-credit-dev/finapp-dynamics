# Stage 1B — M02 Identity Foundation — Completion Report

**2026-07-17** · Branch `feature/stage-1b-m02-identity` · M02 (substage 1B) only.

## Verdict: CONDITIONAL GO for Stage 1C

Stage 1B is **functionally complete**. The identity foundation is bound into the running API, actors are
resolved through the M02 identity/account/membership model on every request, raw `x-actor-id` trust is
gone, and the whole boundary is proven end-to-end over HTTP against a real PostgreSQL. Every Definition-of-
Done item (§18 of the prompt) is met in code and in tests.

The decision is **CONDITIONAL**, not unconditional, for two reasons that are process, not design:

- **C-CI** — the PostgreSQL **16** DB lane has **not yet run for this branch**. All lanes are green locally
  on PostgreSQL 15.2 (the only server on the build machine, same as Stage 1A). CI on `postgres:16` is the
  authoritative certification and must run green before merge, exactly as it did for M01.
- **C-GOV** — the two standing governance gaps carried since Stage 0 are unchanged: the **compromised PAT
  is still not confirmed revoked**, and **`main` is still unprotected**. Neither blocks starting 1C design,
  but both **block the merge of 1B to `main`** (readiness §23, conditions C1/C2).

> This report **supersedes** the earlier `af24e24` version, which recorded NO-GO because the API
> integration had not yet been built. It has since been built (`a277780`…`80c06c4`) and the remaining
> defects — two DB specs written against non-existent catalogue codes, an un-lintable test directory, and
> three seed/expectation bugs in the new API spec — were found and fixed in this continuation once the
> specs were finally run against a live database. The honest earlier report did its job: it stopped 1C
> from starting on an unwired boundary.

---

## 1. Previous NO-GO reason

`af24e24` (2026-07-15) declared NO-GO because DoD items 10–14 and 18 could not be claimed: the
`ActorResolver` and `DevActorAdapter` existed and were unit-proven, but **nothing in `apps/api` bound
them**, `x-actor-id` was still live in `tenant.controller.ts`, and the M02 API did not exist. The
foundation was real; the wiring was not.

## 2. Work completed in this continuation

1. Bound the M02 actor boundary into the API (`ActorModule`, `PlatformModule`, `IdentityModule`) —
   `a277780`…`8bf85bc`.
2. Added the identity, account and membership controllers and removed `x-actor-id` trust from the tenant
   controller — `1688f34`, `5c1850d`.
3. Added the boundary and conformance tests — `9b76b81`, `80c06c4`.
4. **This session:** ran the two DB integration specs against a live PostgreSQL for the first time, which
   surfaced and fixed:
   - `api-identity.db-spec.ts` and `m02-actor-resolution.db-spec.ts` seeded `internal_staff` /
     `human_user` — codes **absent from the catalogues**; corrected to `internal_person` / `employee`.
   - `m02-actor-resolution.db-spec.ts` seeded a `suspended` tenant without `suspended_at`, violating
     `tenants_suspended_ck`; now sets it.
   - `api-identity.db-spec.ts` sent an **uppercase** tenant code (`TENANT_CODE_PATTERN` requires
     lowercase), omitted the required `reason` on account `deactivate`, granted no tenant-lifecycle
     permissions to its admin, and scoped the tenant read-back to the wrong tenant. All corrected.
   - The API test directory was in **no tsconfig**, so eslint could not parse it. Added a dedicated
     eslint-only `apps/api/tsconfig.eslint.json` and wired it in `eslint.config.mjs`, keeping `test/**`
     out of the app's build graph.
5. Rewrote this completion report and finalised the manifest for substage 1B.

## 3. Files created

- `apps/api/src/actor/actor.module.ts` — actor-resolution bindings (resolver, dev adapter, tenant gate).
- `apps/api/src/platform.module.ts` — the single `@Global` shared-service binding site (DB/AUTHZ/AUDIT/OUTBOX).
- `apps/api/src/identity/identity.controller.ts`, `account.controller.ts`, `membership.controller.ts`.
- `apps/api/src/identity/identity.module.ts`, `http.ts`, `views.ts` — DTO helpers and response views.
- `apps/api/test/api-identity.db-spec.ts` — the full-stack HTTP integration spec.
- `packages/m02-identity/test/m02-actor-resolution.db-spec.ts` — resolver/adapter DB spec.
- `apps/api/tsconfig.eslint.json` — eslint-only project for the API integration spec.

(The identity domain, migrations, services, resolver and dev adapter were created in the earlier 1B
commits and are unchanged here.)

## 4. Files modified

- `apps/api/src/tenant/tenant.controller.ts` — `x-actor-id` parsing deleted; consumes `ActorContextFactory`.
- `apps/api/src/app.module.ts` — composition root re-organised (Platform / Actor / Tenant / Identity).
- `apps/api/tsconfig.json`, `package.json` — m02 dependency and project reference.
- `eslint.config.mjs` — API-test lint project.
- `manifests/implementation-manifest.yaml` — substage 1B marked `implemented`; ownership, API prefixes and
  open-gaps updated.

## 5. API bindings

`PlatformModule` (`@Global`) binds `DB` (real `PgDb`, honouring `DATABASE_APP_ROLE` so the API connects as
the non-superuser app role), and the temporary `AUTHZ`/`AUDIT`/`OUTBOX` stand-ins **once for the process**.
`ActorModule` binds `TenantContextResolver` (m01's), `ActorResolver`, the `ACTOR_SOURCE`
(`DevActorAdapter`, behind the production boot-gate) and `ActorContextFactory`. Both feature modules import
`ActorModule`; it imports neither — the graph is acyclic and M01↔M02 never becomes a cycle.

## 6. Controllers added

`IdentityController` (`/api/v1/identities`), `AccountController` (`/api/v1/accounts`), `MembershipController`
(`/api/v1/tenant-memberships`). Every mutating route carries `@Endpoint({ permission, auditCode })`.

## 7. Actor-resolution flow

```
request → x-dev-actor assertion → DevActorAdapter (verify HMAC + expiry)
        → account claim → ActorResolver → account active? identity active? membership active?
        → (tenant claim) → TenantContextResolver (tenant exists + status permits)
        → AuthenticatedActor → RequestContext { tenantId, userId=identityId, permissions, correlationId }
        → controller → service
```

There is exactly one constructor of a request context (`ActorContextFactory`) and one writer of
`userId` — which is the **identity**, not the account, so a person with two logins is one actor in the
trail. Actor resolution runs **before** the tenant gate, so a caller who cannot prove an actor learns only
that.

## 8. Development assertion format

`base64url(JSON{ accountId, expiresAt }) + "." + hex(HMAC-SHA256(payload, secret))`. Signed and
time-limited; carries an account claim and **nothing else** — no permissions, no identity, no tenant.
Header: `x-dev-actor`. The MAC is checked with `timingSafeEqual`; the payload is parsed only after the
signature verifies.

## 9. Environment restrictions

`DevActorAdapter` refuses to **construct** unless `NODE_ENV ∈ {development, test}` and a ≥32-char
`FINAPP_DEV_ACTOR_SECRET` is set. An unset `NODE_ENV` is **not** development. Independently, `ActorModule`'s
factory makes the API **refuse to boot** in production rather than serve without an actor source. Two
checks, one property, on purpose: a dev auth path that silently works in production is the classic breach.

## 10. `x-actor-id` removal evidence

- The header parser (`actorOf`) is **deleted** from `tenant.controller.ts`; a comment marks the grave.
- No `src/**` file reads `x-actor-id` — every remaining occurrence is a comment about its removal or a
  **test** that sends it and asserts `401`.
- The API spec proves it directly: `x-actor-id` naming a **real, active** account id → `401`; the same for
  M01's controller.
- The conformance suite asserts **no live source reference** to `x-actor-id` (fails CI otherwise).

## 11. Remaining `x-permissions` dependency

Unchanged, by design. `x-permissions` still carries the caller's privileges. It is named and read in
**exactly one file** (`packages/m02-identity/src/actor-context.ts`) and leaves it only as
`RequestContext.permissions`, behind the kernel `AUTHZ` port. No controller or service reads it. A **system
actor inherits nothing** from it (§4.5). Deletion is Stage 1D.

## 12. Remaining `ContextAuthz` dependency

Unchanged, by design. Bound in one line in `platform.module.ts`. It enforces real authorization through the
unchanged `Authz` contract; only its **input** is untrusted. Scheduled for deletion in Stage 1D, in the
same commit that binds `RbacAuthz`.

**Explicit debt ladder:** Stage 1B removes `x-actor-id`. Stage 1C removes the development identity
assertion (`DevActorAdapter`, `x-dev-actor`). Stage 1D removes `x-permissions` **and** `ContextAuthz`.

## 13. M01 integration results

M01 is now multi-actor-safe and consumes the M02 actor context with **no change to its services** (all 15
`authz.require` sites unchanged). Proven over HTTP: create → submit-review → approve → start/complete
provisioning → activate → suspend → reactivate all succeed through the actor context; read, list and status
history work; the acting **identity** is recorded as `created_by`; a request carrying only `x-actor-id` is
`401`. M01 reads no M02 table.

## 14. Identity API results

Create (draft) / read / list / update / activate / suspend / reactivate / close all pass. Optimistic
concurrency enforced (stale/absent `expectedVersion` → `409`/`400`); illegal transitions → `409`; malformed
id → `400` before SQL; a service identity with an email → `400`; normalised email/classification **not**
exposed.

## 15. Account API results

Create (pending) / read / activate / suspend / reactivate / deactivate all pass. Duplicate **normalised**
login → `409`; a system account on a human identity → `400`; activating a login for a non-active person →
`409`; normalised login and any auth-provider detail **not** exposed.

## 16. Membership API results

Create (pending) / read / list / activate / suspend / reactivate / end / scope all pass, tenant taken from
context and **never** the body. Duplicate live membership → `409`; another tenant's real membership reads as
`404` with a message **identical** to a never-existed id; cross-tenant read and write both refused. Lifecycle
history preserved (`end_date` set on end).

## 17. Unit tests (PURE smoke)

`7 suites, 919 assertions, 0 failures`: contracts 26 · kernel 35 · m01-tenant 250 · m02-actor-context 33 ·
m02-identity 249 · conformance 300 · migrate 26.

## 18. API tests

`apps/api/test/api-identity.db-spec.ts` — **85 assertions**, boots the real `AppModule` on an ephemeral port
(same wiring as `main.ts`) and drives it with real `fetch` over a socket. Covers the boundary, every route
family, authorization-vs-identity separation, optimistic concurrency, data minimisation, cross-tenant
isolation and error hygiene (no stack trace, no SQL leak).

## 19. Integration tests (actor resolution)

`packages/m02-identity/test/m02-actor-resolution.db-spec.ts` — **52 assertions** through a real `PgDb` on
the non-superuser app role: three independent gates (account/identity/membership), cross-tenant refusal
proven to be RLS (not luck), non-enumerating refusals, signature forgery/tamper/expiry, permission-injection
resistance, system-actor behaviour, production-refusal, and pooled-connection non-leak.

## 20. Database tests

`5 specs, 254 assertions, 0 failures` on PostgreSQL 15.2: m01-tenant 46 · m02-actor-resolution 52 ·
m02-identity 45 · api-identity 85 · rls-convention 26. Proves M01 and M02 RLS, the identity-plane/membership
asymmetry, append-only-by-privilege, no-DELETE, pooled-connection non-leak, and the absence of any
1C/1D table or any credential column.

## 21. Conformance tests

`300 assertions`. Asserts: no live `x-actor-id`; `x-permissions`/`x-dev-actor` each named in exactly one
file; M02 routes match `naming-map.yaml`; M02 permissions, audit codes and the `identity.lifecycle` event
family are registered and agree across manifests, the registry and the contracts union; **no 1C session or
1D RBAC table exists**; every manifest parses; 1B status is internally consistent.

## 22. PostgreSQL version

Local: **15.2** (all lanes green). CI target: **16** — the authoritative certification, **not yet run for
this branch** (see condition C-CI). RLS FORCE, `tenant_isolation`, composite FKs and the CHECK semantics
exercised here are identical across 15 and 16.

## 23. Build results

`tsc --build` clean.

## 24. Lint results

`eslint .` — **0 errors**. Two pre-existing warnings in `m01-tenant.smoke.ts` (unchanged baseline).

## 25. Formatting results

`prettier --check .` — clean.

## 26. Security results

All §15 attacks fail closed: forged / re-pointed / replayed / expired assertions → `401`; suspended account,
suspended identity, ended/suspended membership → `401`; `x-actor-id` alone → `401`; cross-tenant read/write
→ `401`/`404`; another tenant's membership count is invisible (RLS); a system actor inherits no human
permission; permissions injected into the signed payload are ignored; the `AUTHZ` port cannot be bypassed;
all refusals are byte-identical (no enumeration oracle). Identity data is `confidential`, never in event
payloads, no credential column exists.

## 27. Known limitations

1. API has **no authentication** until 1C — the dev adapter proves possession of a secret, not a person. Not
   exposable to an untrusted network.
2. Audit is **not persisted** (m03) and events are **not delivered** (m06) — in-memory stand-ins.
3. `x-permissions` + `ContextAuthz` remain a claimed-privilege surface until 1D.
4. `AuthenticationSubjectLinked` is declared but never emitted.
5. "At most one primary tenant per identity" is enforced per-tenant only (a tenant-scoped table cannot hold
   a cross-tenant index); not yet enforced in the service.
6. No down-migrations (runner limitation).
7. PG16 CI has not run for this branch.

## 28. Deferred Stage 1C work

Sessions, tokens + refresh, revocation, lockout (`locked`/`expired` declared but unreachable),
`login_attempts` (global, pre-auth), service-account credentials, break-glass — **and deleting
`DevActorAdapter` / `x-dev-actor`**.

## 29. Deferred Stage 1D work

Roles, permission catalogue seed, `user_roles`, scopes, SoD — **and deleting `x-permissions` +
`ContextAuthz`** in the same commit that binds `RbacAuthz`.

## 30. Commit references

Foundation: `b807bc9`, `99b3800`, `72862b5`, `f8efe1e`, `af24e24`. API integration: `a277780`, `75dd491`,
`8bf85bc`, `d4f2a8d`, `1688f34`, `5c1850d`, `9b76b81`, `80c06c4`. This continuation: the DB-spec fixes,
eslint-project wiring, and documentation commits at the tip of `feature/stage-1b-m02-identity`.

## 31. Recommendation

### CONDITIONAL GO for Stage 1C

The engineering Definition of Done is met: identity/account/membership registries work, all three APIs
exist, the resolver and dev adapter are bound (the adapter dev/test-only), `x-actor-id` trust is gone and
requests carrying only it fail, M01 runs through the new context, suspended/ended principals cannot resolve,
cross-tenant access fails, refusals do not enumerate, and `x-permissions`/`ContextAuthz` are contained and
dated for deletion. Locally: build/lint/format clean; **919 smoke + 254 DB assertions green**.

Conditions before **merge** (not before 1C design):

| # | Condition | Owner |
|---|---|---|
| C-CI | Push the branch; confirm the **`postgres:16`** DB lane runs green | Engineer |
| C1 | **Revoke the compromised PAT** | Repository owner |
| C2 | **Enable branch protection on `main`** (both checks required) | Repository admin |

Stage 1C replaces the dev adapter with real sessions; it can begin now because the boundary it replaces is
real and consumed on every request. **1B must not merge to `main` until C-CI, C1 and C2 are closed.**

**Do not start Stage 1C implementation until this gate is formally accepted.**
