# Stage 1C — Authentication & Sessions (m02-auth) — Completion Report

**2026-07-18** · Branch `feature/stage-1c-authentication-sessions` · m02-auth only.

## FINAL STATUS: CERTIFIED AND COMPLETE — Stage gate GO (2026-07-18)

> **Certified on `main` at `48cba39` (2026-07-18).** PR **#5** merged `feature/stage-1c-authentication-sessions`
> (head `8d1eeac`) into `main` under active branch protection after both required lanes passed on CI run
> **`29646472150`** — **Smoke lane success** (Format, Lint, Build, PURE smoke; no step skipped) and **DB lane
> success** (Assert PostgreSQL 16, migrations dry-run + real, DB integration specs; no step skipped). The
> post-merge push run on `main` (`29653121124`) also passed. The merged tree is byte-identical to the CI-
> tested head. Local re-verification on merged `main`: smoke **8 suites / 1004 assertions**, DB **7 specs /
> 301 assertions**, 0 failures. **Stage 1C is complete; Stage 1D may begin.** Evidence is authoritative in
> the "STAGE 1C CERTIFICATION COMPLETE" section at the end. The pre-merge verdict below is retained as the
> record of how the gate was reached.

## Verdict (historical, superseded by FINAL STATUS above): CONDITIONAL GO for merge

Stage 1C was implemented on the branch and green on every local lane; certification awaited the PostgreSQL 16
CI on the PR. That CI has since run green and the PR merged — see the certification section at the end.

## 1. Certified starting baseline SHA

`e3e51a5` — the certified Stage 1B remediation merge (PR #4), the mandatory parent baseline.

## 2. Branch

`feature/stage-1c-authentication-sessions`, head **`de910f2`** at the time of writing.

## 3. ADR acceptance evidence

- **ADR-015 — Opaque, revocable, server-side sessions** — ACCEPTED 2026-07-18 (product owner + security).
- **ADR-016 — Password hashing = Argon2id** (`@node-rs/argon2`; scrypt fallback) — ACCEPTED 2026-07-18.
- **D3 (transport)** — RESOLVED: Secure, `HttpOnly`, `SameSite=Lax` cookies with CSRF; strict credentialed
  CORS; production fail-closed. Recorded in `docs/01-architecture/ARCHITECTURE_DECISION_REGISTER.md` and the
  readiness report (verdict flipped CONDITIONAL GO → GO). Committed separately: `0b43e2e`.

## 4. Scope implemented

Credential storage + Argon2id verification; authentication attempts + durable lockout/throttle; login;
session issuance/validation/refresh/rotation/family-revocation; logout; administrative revocation; session
listing; secure cookie transport; CSRF; the session-backed `ActorSource`; **retirement of the Stage 1B dev
assertion**; authentication events + audit intents through the existing ports; full test coverage; registry
updates.

## 5. Explicit exclusions

Persistent RBAC / roles / permission assignment / SoD / **`x-permissions` and `ContextAuthz` removal** (all
Stage 1D); audit persistence (m03); outbox delivery (m06); OAuth/OIDC/API-key; MFA; registration; public
self-service password reset; service-account credentials (deferred with MFA). `x-permissions` and
`ContextAuthz` remain **untouched** behind the AUTHZ port.

## 6. Files changed

53 files, +4208/-690 vs `main`. New package `packages/m02-auth/**` (domain, hashing, csrf, repository, five
services, adapter, index, 2 migrations, 2 test suites); `packages/contracts/src/auth-events.ts`;
`apps/api/src/auth/**` (module, controller, cookies, config, csrf.middleware) + `apps/api/test/api-auth.db-spec.ts`.
Modified: contracts union/index/smoke; the four registries + naming-map + manifest; `tools/migrate` order;
`apps/api` actor/app/main modules + tsconfig/package; `m02-identity` actor-context (TokenExtractor) + index;
conformance; several existing specs re-pointed to real login. **Deleted**: `packages/m02-identity/src/dev-actor-adapter.ts`.

## 7. Database migrations

`m02-auth/0001_auth_sessions.sql`, `0002_grant_application_role.sql` — apply after m02-identity in dependency
order (verified). Tables (all **global account-plane, RLS FORCE + system escape**, ADR-014):
`authentication_credentials` (one active per account, partial unique index), `login_attempts` (global
pre-auth), `sessions`, `session_status_history` (append-only), `session_refresh_tokens` (rotation ledger).
No `DELETE` grant anywhere. Column names are hash-only (`secret_hash`, `token_hash`, `refresh_token_hash`,
`login_ref_hash`) — a conformance check asserts no plaintext credential/token column exists.

## 8. Credential model

Argon2id (`@node-rs/argon2`), per-credential `algorithm` + `params` stored for transparent upgrade;
**rehash-on-successful-login** when parameters fall below policy; constant-time verify (library / scrypt
`timingSafeEqual`). No plaintext or hash is ever logged, returned, or placed in an event/audit detail. scrypt
is a documented fallback selected only by explicit `FINAPP_PASSWORD_HASHER=scrypt` — no silent downgrade.

## 9. Session model

Opaque: a 256-bit random token returned once, stored only as its SHA-256 hash; each request looks it up,
checks status + idle + absolute expiry, slides the idle window (throttled write), and hands the account id to
`ActorResolver`. Idle 30 min / absolute 12 h / refresh 14 d (policy constants). Session fixation is prevented
— every login mints a fresh id and rotation family.

## 10. Refresh and replay behavior

Refresh tokens live in the `session_refresh_tokens` ledger, consumed exactly once. A valid refresh rotates the
session (new access + refresh, `token_version`++) and is proven at the DB level. **Presenting a consumed
refresh token — or losing the consume race — is reuse: the entire rotation family is revoked** and a
`SessionRevoked` event (`reason: refresh_reuse`) is emitted. Proven both at the service level and over HTTP.

## 11. ActorResolver integration

`SessionActorAdapter implements ActorSource`. It resolves the session to an account reference, then calls the
**unchanged** `ActorResolver` with `{ claimedAccountId, tenantId, assurance, sessionRef }`. The resolver
independently re-checks account, identity, membership and tenant context **every request** — a suspended
person or ended membership is refused on the next call even with a valid session. No account/identity/
membership logic is duplicated in the adapter; `ActorContextFactory` and every controller are untouched.

## 12. Development-adapter retirement

`DevActorAdapter`, `x-dev-actor`, `signDevAssertion`, `verifyDevAssertion`, `FINAPP_DEV_ACTOR_SECRET` are
**deleted**. `ActorContextFactory` now takes a `TokenExtractor` (apps/api injects the session-cookie reader).
Conformance asserts **zero** live source use of `x-dev-actor` (and still `x-actor-id`). Integration/API tests
authenticate through the real `POST /auth/login`; unit tests use an explicit `ActorSource` double.

## 13. Cookie and CSRF controls

`finapp_session` (HttpOnly, Secure, SameSite=Lax, path `/`), `finapp_refresh` (HttpOnly, Secure, path-scoped
to `/api/v1/auth/session/refresh` — never exposed to JS beyond that route), `finapp_csrf` (readable,
double-submit). A **global `CsrfMiddleware`** requires the `x-csrf-token` header to match the CSRF cookie on
every state-changing request that carries a session cookie; safe methods and login (no session cookie) are
exempt. Logout and invalid-session responses clear all three cookies. Strict credentialed CORS allow-list; no
wildcard. Production **fails closed** (`loadAuthConfig`) on missing origins or unsafe cookie config.

## 14. APIs

`POST /auth/login` · `POST /auth/logout` · `POST /auth/session/refresh` · `GET /auth/session` · `GET
/auth/sessions` · `POST /auth/sessions/:id/revoke` · `GET /auth/admin/sessions` · `POST
/auth/admin/sessions/:id/revoke`. Self-service acts on the caller's own sessions (no permission); admin
listing/revocation is behind `auth.session.view|revoke` via the AUTHZ port. Responses expose no token hashes
or secrets; errors follow the RFC-9457 `ProblemFilter` envelope.

## 15. Permissions

`auth.*` namespace (registered): `auth.session.view`, `auth.session.revoke` — declared, **not granted** until
1D, exactly as `identity.*` in 1B.

## 16. Events

Family `identity.authentication` (registered; classification `confidential`), 11 types
(`AuthenticationSucceeded/Failed`, `SessionIssued/Refreshed/Revoked/Expired`, `CredentialCreated/Changed/
Disabled`, `AccountLockoutInitiated/Cleared`). Payloads carry identifiers/transitions only — never a
password, hash, token, raw identifier, email or name. Delivered through the existing OUTBOX port (no second
pipeline).

## 17. Audit intents

`AUTH_` prefix (registered), 11 codes; adverse actions `reason_required`. Written through the existing AUDIT
port; details never contain a secret.

## 18. Security controls

Enumeration resistance (one generic `Invalid credentials.`; unknown vs wrong-password vs suspended are
byte-identical); constant-time verify; 256-bit random tokens hashed at rest; session fixation prevented;
refresh rotation + reuse→family-revoke; idle + absolute expiry; credential-change revokes all sessions;
account/identity/membership suspension and tenant mismatch denied by the resolver; durable (DB-backed)
lockout/throttle; CSRF; strict credentialed CORS; production fail-closed; pooled-connection non-leak; no
permission injection (system actors inherit nothing; `x-permissions` still one file behind AUTHZ).

## 19. Test evidence

Smoke: **8 suites / 1004 assertions**, 0 failures (m02-auth pure 65; contracts 32; conformance 331; others).
DB (PostgreSQL 15.2 local): **7 specs / 301 assertions**, 0 failures — m01-tenant 46, m02-auth 32,
m02-actor-resolution 37, m02-identity 45, api-auth 37, api-identity 78, rls-convention 26. No spec skipped.

## 20. CI evidence

**PASSED (updated post-merge).** PR #5 CI run `29646472150`: Smoke lane success (Format/Lint/Build/PURE smoke)
and DB lane success (Assert PostgreSQL 16 + migrations + DB integration specs); post-merge push run
`29653121124` on `main` also success; no step skipped. See the authoritative "STAGE 1C CERTIFICATION
COMPLETE" section at the end of this report.

## 21. Remaining limitations

No authentication provider beyond password (MFA/federation designed-for, not built); service-account
credentials deferred; no public registration or self-service reset; audit/outbox still in-memory stand-ins
(m03/m06); `x-permissions`/`ContextAuthz` remain (1D); PG16 CI unproven for this branch; local DB is 15.2.

## 22. Stage 1D boundary

`x-permissions`, `ContextAuthz` and the `AUTHZ` port are unchanged. **Stage 1C authenticates the actor;
Stage 1D authorizes the actor** and deletes `x-permissions` + `ContextAuthz` in one commit.

## 23. Risks

Native Argon2 dependency (supply chain — mitigated by pin/review + scrypt fallback); token/credential leakage
into logs/events (mitigated: hash-only, identifiers-only payloads, tested); refresh theft (rotation + reuse
revoke); CSRF/XSS (HttpOnly + double-submit + strict CORS); dev adapter resurrection (deleted + conformance);
`ContextAuthz` outliving 1D (unchanged standing risk); PAT unrevoked / repo public (standing governance).

## 24. Definition of Done

Met locally: ADR-015/016 accepted, D3 resolved, registries updated, credentials secure, sessions revocable,
refresh rotation + replay detection + family revoke, `SessionActorAdapter` bound, `ActorResolver`
authoritative, dev assertion removed, secure cookies + CSRF + restricted CORS, production fail-closed, all
Stage 1A/1B/1C tests green, smoke + DB green, no skips, this report produced, manifest updated, Stage 1D not
begun. **Outstanding:** PostgreSQL-16 CI green on the PR (the one DoD item that requires the PR to exist).

## 25. Recommendation

### GO — Stage 1C certified and complete

PR #5 merged into `main` (`48cba39`) under active branch protection after both required lanes passed (CI run
`29646472150`); local re-verification on merged `main` is green (smoke 1004 / DB 301, 0 failures). C-CI is
discharged. Standing governance items — PAT revocation and repository visibility — remain but do not gate
Stage 1C. **Stage 1D (`m02-rbac`) may now begin from certified `main`; it has not been started.**

---

# STAGE 1C CERTIFICATION COMPLETE (2026-07-18)

PR #5 merged into `main` under active branch protection after both required lanes passed. Stage 1C is
**certified and complete**.

| Item | Evidence |
|---|---|
| **Certified Stage 1B baseline** | `e3e51a5e1364d85d40ed5a3af060230ca38868c8` (parent of the merge) |
| **Stage 1C feature head** | `8d1eeacf0a2b6b8a64716955aba91d5fd6fd90c8` |
| **Stage 1C merge commit** | **`48cba39fe59b19c03648623b1dbd92ac4a70017c`** — `main` HEAD (squash of PR #5) |
| **Pull request** | **#5** — `feature/stage-1c-authentication-sessions` → `main`, merged 2026-07-18 |
| **Tree parity** | `git diff 8d1eeac 48cba39` is empty — the certified code is byte-identical to what CI tested |
| **CI workflow run** | **`29646472150`** (PR #5, `pull_request`). Post-merge push run on `main`: `29653121124` — also success. |
| **Smoke lane** | **PASSED** — Format check ✅, Lint ✅, Build ✅, PURE smoke suites ✅. No relevant step skipped. |
| **PostgreSQL 16 DB lane** | **PASSED** — `Assert PostgreSQL 16` ✅, `Migrations (dry run — ordering and checksums)` ✅, `Migrations` ✅, `DB integration specs` ✅. No relevant step skipped. |
| **CI totals** | The GitHub REST API exposes step conclusions (all success, no skips) but not the in-log assertion counts; the merged tree is identical to the CI-tested head, so the local totals below are authoritative for the same code. |
| **Local re-verification (merged `main`, clean checkout)** | `npm ci` (0 vulns) · `format:check` ✅ · `lint` **0 errors** ✅ · `build` ✅ · smoke **8 suites / 1004 assertions** · DB **7 specs / 301 assertions** (PostgreSQL 15.2). No suite/spec skipped. |
| **Smoke suite totals** | contracts 32, kernel 35, m01-tenant 250, m02-auth 65, m02-actor-context 33, m02-identity 232, conformance 331, migrate 26 = **1004**, 0 failures |
| **DB spec totals** | m01-tenant 46, **m02-auth 32**, m02-actor-resolution 37, m02-identity 45, **api-auth 37**, api-identity 78, rls-convention 26 = **301**, 0 failures |
| **DB specs that ran** | Stage 1A (m01), 1B (m02-identity, m02-actor-resolution incl. pooled-connection + cross-tenant), 1C (m02-auth: credentials/sessions/**refresh rotation**/**reuse→family-revoke**/RLS/no-plaintext; api-auth: login/CSRF/refresh/reuse/lockout/session-backed actor over HTTP), rls-convention. None skipped. |
| **Merge status** | **MERGED into `main`.** |
| **Branch protection** | **ACTIVE** — `main` requires the Smoke and PostgreSQL 16 lanes and PR review; PR #5 merged under it. |
| **`x-dev-actor` / `DevActorAdapter`** | **Absent** from live source on `main` (file deleted; conformance forbids the header). `SessionActorAdapter` is the bound `ActorSource`; `ActorResolver` unchanged and authoritative. |
| **`x-actor-id`** | Absent from live source (conformance-enforced). |
| **Stage 1D boundary** | `x-permissions` + `ContextAuthz` unchanged; no RBAC tables/source; Stage 1D not begun. |
| **Stage 1C gate** | **GO.** |
| **Stage 1C status** | **CERTIFIED AND COMPLETE.** |

## Remaining governance (standing, not gating Stage 1C)

- **PAT revocation** — still not verifiable from here; treat as unrevoked until confirmed.
- **Repository visibility** — still public; no recorded owner decision.

## Stage 1D

Stage 1D (`m02-rbac`: roles, permission catalogue, `user_roles`, SoD; delete `x-permissions` + `ContextAuthz`
and bind `RbacAuthz`) may now begin from certified `main` (`48cba39`). It has **not** been started.
