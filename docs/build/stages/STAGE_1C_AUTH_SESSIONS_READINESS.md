# Stage 1C — Authentication & Sessions (m02-auth) — Readiness Assessment

**2026-07-17** · Branch `feature/stage-1c-authentication-sessions` · **Planning/design only. No Stage 1C
source code.**

## Verdict: GO for Stage 1C implementation (2026-07-18)

**Implementation authorized.** The gate is cleared:

- **ADR-015 accepted** — opaque, revocable, server-side sessions + rotating refresh with reuse→family-revoke.
- **ADR-016 accepted** — Argon2id via `@node-rs/argon2` (subject to dependency/licence review); `node:crypto.scrypt` documented fallback only.
- **D3 resolved** — browser transport is **Secure, `HttpOnly`, `SameSite=Lax` cookies with CSRF protection**;
  separate refresh cookie scoped to the refresh path; strict credentialed CORS; production fail-closed on
  unsafe cookie/origin/secret config. Bearer/OAuth/OIDC out of scope for this stage.
- **Stage 1D remains excluded** — `x-permissions`, `ContextAuthz`, and the `AUTHZ` port are untouched.

The design below fits the certified Stage 1B baseline without changing it: sessions are a new `ActorSource`
behind the existing seam and `ActorResolver` stays authoritative on every request.

> Historical note: this report was issued CONDITIONAL GO pending the two ADRs and the transport decision; all
> three are now accepted (see the ADR register, ADR-015/ADR-016, both ACCEPTED 2026-07-18).

---

## 1. Certified Stage 1B baseline

Stage 1B (m02-identity) is **certified and complete**. Remediation PR #4 merged under active branch
protection after both lanes passed (CI run `29585327815`); local re-verification on the merge commit: smoke
**7 suites / 926 assertions**, DB **5 specs / 254 assertions**, 0 failures. Identity/account/membership
registries, three lifecycles, `ActorResolver`, `DevActorAdapter`, and the API boundary are live; raw
`x-actor-id` trust is gone; `x-permissions` + `ContextAuthz` remain temporary for Stage 1D.

## 2. Starting `main` SHA

**`e3e51a5e1364d85d40ed5a3af060230ca38868c8`** (PR #4 remediation merge; branch protection active).

## 3. Stage 1C branch

**`feature/stage-1c-authentication-sessions`**, created from `e3e51a5`.

## 4. Scope

Module **`m02-auth`** (per `implementation-manifest.yaml` substage 1C). Owns:

- Password credential storage and verification (hashed; never plaintext).
- Login (credential → session) and logout.
- Session issuance, validation, rotation, revocation.
- Refresh tokens with reuse detection.
- Authentication attempts (global, pre-auth) + lockout/throttling evaluation.
- Session-management APIs under `/api/v1/auth` (registered, `auth:mixed`).
- **Replacement of `DevActorAdapter`** with a session-backed `ActorSource`; deletion of `x-dev-actor`.
- Binding authenticated sessions into the existing `ActorResolver` (unchanged contract).

## 5. Explicit exclusions

Persistent RBAC, roles, permission assignment, role inheritance, SoD enforcement, final authorization
persistence, **removal of `x-permissions`**, **replacement of `ContextAuthz`** (all Stage 1D) · audit
persistence (m03) · outbox delivery (m06) · public self-service password **reset** communications · **MFA**
(designed-for, not implemented) · **OAuth/OIDC/SSO** (not implemented) · registration/self-signup · Feedback,
Legal, Finance, AI. Stage 1D continues to own persistent RBAC and `x-permissions` removal.

## 6. Existing architecture reused (do not reimplement)

- **`ActorResolver`** — the three gates (account/identity/membership active). Unchanged. Sessions feed it a
  `claimedAccountId`; it still decides.
- **`ActorSource`** interface (`actor-context.ts`) — `resolve({ token, tenantId?, correlationId })`. The
  session adapter implements this exact shape; `ActorContextFactory` and every controller are untouched.
- **`AuthenticatedActor`** — already carries `assurance: 'password'|'mfa'|'federated'` and `sessionRef?`,
  declared in 1B precisely so this stage adds no field.
- Kernel `Db` (`withSystem`/`withTenant`), `ProblemError`, `@Endpoint`, the four DI tokens · `PgDb` and the
  non-superuser app-role connection · the `tenant_isolation` + system-escape RLS conventions verbatim · the
  migration runner · the PURE + DB test harness · m02's append-only-history-by-privilege and
  lifecycle-state-machine patterns · `user_accounts` readiness columns (`auth_provider_ref`, `locked_at`,
  `last_authenticated_at`) already present.
- `authentication_subjects` (references-only external IdP subjects) — reused when federated auth lands; no
  credentials there, ever (ADR-009).

## 7. Authentication trust boundary

```
Incoming request
      ↓  session credential extracted (cookie or Authorization: Bearer; ONE transport, see §18/D3)
      ↓  session integrity: token hash looked up (constant-time), not decoded/trusted
      ↓  session status + expiry: active, not revoked, within idle + absolute expiry
      ↓  account reference resolved FROM the session record (never from the request)
      ↓  ActorResolver  ── account active? identity active? (tenant claim → membership active?)
      ↓  tenant context validated (m01 TenantContextResolver, unchanged)
      ↓  authoritative ActorContext → RequestContext → controller/service
```

**Invariant:** the session establishes only *which account* is acting; `ActorResolver` remains the sole
authority on identity/account/membership/tenant state. A suspended person, suspended account, or ended
membership is refused **on the very next request** even with a valid session, because the gates run every
time. The session is never allowed to bypass the resolver.

## 8. Credential model

Table **`authentication_credentials`** (global account-plane; one active password credential per account):

- `id`, `account_id` (FK → `user_accounts`), `credential_type` (`password` in 1C; `mfa_totp`/`webauthn`
  reserved), `algorithm` (`argon2id`), `params` (jsonb: memory/iterations/parallelism), `hash` (encoded
  Argon2id string — salt embedded), `status` (`active` | `disabled`), `version` (rehash/rotation counter),
  `created_at`, `last_changed_at`, `disabled_at`, `disabled_reason`.
- **No plaintext, ever.** Passwords and hashes are never logged, never in events, never in audit detail.
- **Rehash-on-login:** if the stored `algorithm`/`params` are below current policy, re-hash after a
  successful verify (transparent credential upgrade).
- **Password-change revokes sessions** (§18).
- **Hashing:** Argon2id (ADR-016) — memory ≥ 19 MiB, iterations ≥ 2, parallelism 1 as a starting policy,
  tuned to ~250 ms on target hardware. Fallback if the native dependency is rejected: `node:crypto.scrypt`
  (N=2^17, r=8, p=1) — OWASP-acceptable, zero-dependency. Verification is constant-time
  (`timingSafeEqual`, or the library's own verify).

## 9. Session model

Table **`sessions`** (global account-plane; opaque, revocable):

- `id`, `account_id`, `identity_id` (denormalised for audit convenience, still FK-checked),
  `token_hash` (SHA-256 of a 256-bit random token; the raw token is returned once and never stored),
  `refresh_token_hash`, `rotation_family` (uuid; groups a refresh chain), `token_version` (int; increments
  each rotation), `assurance` (`password`|`mfa`|`federated`), `authenticated_at`, `issued_at`,
  `last_used_at`, `idle_expires_at`, `absolute_expires_at`, `status` (`active`|`revoked`|`expired`),
  `revoked_at`, `revoked_reason`, `client_user_agent` (policy-gated), `client_ip` (policy-gated),
  `selected_tenant_id` (nullable; convenience only — membership is still re-checked per request).
- Append-only history: **`session_status_history`** (INSERT+SELECT only, by privilege) records every
  transition (issued/refreshed/revoked/expired) with reason — same pattern as identity/account histories.
- **Opaque, not a JWT.** The token carries no claims; it is a lookup key. This makes revocation instant and
  keeps zero authorization data in the client's hands.
- **Rotation:** refresh mints a new `token_hash`/`refresh_token_hash`, increments `token_version`, keeps the
  `rotation_family`. Presenting a **superseded** refresh token (reuse) → the whole family is revoked
  (theft detection).

## 10. Session-strategy comparison

| Criterion | (1) Opaque server-side session | (2) Signed access token + server refresh | (3) Stateless signed JWT |
|---|---|---|---|
| Instant revocation | ✅ delete/revoke row | ⚠️ refresh revocable; access valid till expiry | ❌ not without a denylist (which is state) |
| Membership/identity/account suspension takes effect | ✅ next request (resolver gates) | ✅ next request | ✅ next request (resolver still runs) |
| Force-logout / password-change kill | ✅ trivial | ⚠️ access token lingers | ❌ hard |
| Secret rotation | ✅ n/a (random tokens) | ⚠️ signing-key rotation | ❌ painful |
| Replay / theft response | ✅ revoke family | ✅ revoke refresh | ❌ token valid till exp |
| Horizontal scaling | ✅ (shared DB; cache optional) | ✅ | ✅ |
| DB load per request | one indexed lookup | lower (verify sig) | none |
| Auditability / incident response | ✅ every session is a row | ✅ | ❌ opaque to the server |
| Compatibility with `ActorResolver` | ✅ native (token→account) | ✅ | ✅ |

The platform already pays for a per-request `ActorResolver` lookup, so option (1)'s "extra" session lookup
is marginal, and it is the only option that gives an enterprise governance system **instant, auditable
revocation** and clean force-logout. Statelessness (3) buys request-time DB savings the platform does not
need and costs exactly the revocation/auditability it must have.

## 11. ADR recommendation

- **ADR-015 (draft): Opaque, revocable, server-side sessions with rotating refresh tokens and reuse
  detection.** Access is the session itself (validated per request through `ActorResolver`); long-lived
  continuity is a rotating refresh chain with family-revocation on reuse. Rejected: stateless JWTs as the
  primary session (revocation/audit), and long-lived non-rotating refresh tokens (theft blast radius).
- **ADR-016 (draft): Password hashing = Argon2id** via a vetted, actively-maintained native binding
  (candidate `@node-rs/argon2`), pinned and reviewed; `node:crypto.scrypt` is the zero-dependency fallback
  if adding a native runtime dependency is declined. Either way: per-credential parameters stored for
  transparent upgrade, constant-time verify, no plaintext/hашes in logs.

Both are **drafts pending product-owner/security acceptance** (D1, D2). Implementation must not start until
accepted.

## 12. API catalogue (`/api/v1/auth`, `auth:mixed`)

| Method & path | Auth | Purpose | Permission |
|---|---|---|---|
| `POST /api/v1/auth/login` | pre-auth | credential → session (+ refresh). Generic failure. | none (pre-auth) |
| `POST /api/v1/auth/logout` | session | revoke the current session | none (self) |
| `POST /api/v1/auth/session/refresh` | refresh token | rotate; reuse → family revoke | none |
| `GET  /api/v1/auth/session` | session | describe the current session (no secrets) | none (self) |
| `GET  /api/v1/auth/sessions` | session | list the caller's own sessions | none (self) |
| `POST /api/v1/auth/sessions/:id/revoke` | session | revoke one of the caller's own sessions | none (self) |
| `GET  /api/v1/auth/admin/sessions` | session | administrative session listing (any account) | `auth.session.view` |
| `POST /api/v1/auth/admin/sessions/:id/revoke` | session | administrative revocation | `auth.session.revoke` |

Self-service on the caller's own sessions needs no permission (identity == owner). **Administrative** listing/
revocation across accounts is separately authorized behind the AUTHZ port (declared, not granted, until 1D).
No registration, no public password-reset in 1C.

## 13. Database design

All new tables are **global account-plane** (like `user_accounts`), RLS FORCE with **system-context access
only** — there is no tenant that owns a credential or a session; tenant reach stays a membership question.

| Table | Scope | Sensitive columns | Notes |
|---|---|---|---|
| `authentication_credentials` | global | `hash` (Argon2id), `params` | one active per account; append-only change history via `version`; **no plaintext** |
| `sessions` | global | `token_hash`, `refresh_token_hash` | opaque; hashed at rest; idle + absolute expiry; rotation family |
| `session_status_history` | global, append-only | — | INSERT+SELECT by privilege; every transition + reason |
| `login_attempts` | **global, pre-authentication** (ADR-001 enumerated exception) | `login_ref_hash` (hash of normalized identifier, **not** the raw), `client_ip`/`user_agent` (policy-gated) | outcome + generic reason category; **never** the supplied password; feeds lockout/throttle |

Per column: owning module `m02-auth`; retention policy (sessions purged after absolute expiry + grace;
attempts retained per security policy, e.g. 90 days); hashing/encryption (token hashes SHA-256 — safe
because tokens are 256-bit random, not passwords; passwords Argon2id); indexes (`token_hash` unique,
`account_id`, `login_ref_hash`+`created_at`); unique constraints (one `active` credential per account via
partial index; `token_hash` globally unique); status/lifecycle fields as above; audit + event intent per
§19/§20. **No `DELETE` privilege** anywhere (retire by status; purge is a privileged maintenance job).

## 14. RLS design

- Credentials, sessions, and their history are **global with a system escape** — read/written only inside
  `Db.withSystem` (a stated reason), exactly as the identity plane. A tenant context can never see another
  account's credentials or sessions, because it never enters the account plane at all.
- `login_attempts` is **global and pre-authentication** — there is no actor and no tenant when it is written
  (ADR-001's enumerated exception, same class as the identity control plane).
- **Pooled-connection safety** proven the same way as 1B: `SET LOCAL ROLE` + transaction-scoped GUCs, tested
  by a reuse spec.
- Roles: app role is non-superuser, `NOBYPASSRLS`; INSERT/UPDATE/SELECT only; history INSERT+SELECT only.

## 15. `ActorResolver` integration

A new **`SessionActorAdapter implements ActorSource`** replaces `DevActorAdapter`:

```
resolve({ token, tenantId, correlationId }):
  session = load active session by SHA-256(token)      # constant-time miss == generic 401
  assert status active, now < idle_expires_at, now < absolute_expires_at
  slide idle_expires_at; set last_used_at
  return ActorResolver.resolve({
    claimedAccountId: session.account_id,
    tenantId, correlationId,
    assurance: session.assurance,      # 'password' | 'mfa' | 'federated'
    sessionRef: session.id,
  })
```

`ActorResolver`, `ActorContextFactory`, `contextFromActor`, and **every controller are unchanged**. The
`assurance` and `sessionRef` fields the resolver already carries now get real values. `RequestContext.userId`
is still the identity.

## 16. `DevActorAdapter` retirement

- **Replaced by** `SessionActorAdapter` (same `ActorSource`), bound in `actor.module.ts` in place of the dev
  adapter.
- **Not available in any environment after 1C** — the file `dev-actor-adapter.ts`, the `x-dev-actor` header
  constant, `signDevAssertion`, and `FINAPP_DEV_ACTOR_SECRET` are **deleted**, not disabled.
- **Production guarantee:** deletion is absolute; additionally a conformance check asserts `x-dev-actor` has
  **zero** live source references (mirroring the `x-actor-id` guard), and the `assurance: 'development'`
  literal is removed from the union.
- **Tests after retirement:** integration/API specs authenticate through the **real** `POST /auth/login`
  flow (seed an account + credential, log in, use the returned session) — no dev bypass. Unit tests may use
  explicit `ActorSource` test doubles. `x-actor-id`/`x-dev-actor` negative tests remain (both must be
  rejected).

## 17. Stage 1D boundary (preserved, unchanged)

`x-permissions`, `ContextAuthz`, and the `AUTHZ` port stay exactly as 1B left them. 1C authenticates the
actor; **1D authorizes** the actor through persistent RBAC and deletes `x-permissions` + `ContextAuthz` in
one commit. 1C adds **no** role or persistent permission assignment merely to make login work — session
admin endpoints declare `auth.*` permissions (checked through the unchanged port), granted by nobody until
1D, exactly as 1B declared `identity.*`.

## 18. Security controls

Credential: constant-time verify · generic `invalid credentials` for both unknown identifier and wrong
password (no enumeration) · rehash-on-login · password-change revokes all of the account's sessions ·
credential compromise → disable + force re-set. Attempts/lockout: per-account and per-source rate limiting ·
progressive delay then temporary lockout (writes `user_accounts.locked_at`, status `locked`) · credential-
stuffing/brute-force detection off `login_attempts`. Sessions: 256-bit random tokens, hashed at rest ·
session-fixation prevented (a fresh session id is minted on every login) · rotation on refresh · **refresh
reuse detection** → family revoke · idle + absolute expiry · logout revokes · identity/account suspension and
membership suspension take effect next request (resolver). Transport (**D3, ADR-015**): if cookie-based —
`Secure`, `HttpOnly`, `SameSite=Lax|Strict` + CSRF token (double-submit or origin check); if `Authorization:
Bearer` — no ambient credential, so no CSRF, but XSS token-exfiltration is the trade. **Recommendation:
HttpOnly cookie + CSRF token** for a browser-facing governance app. CORS locked to approved origins. Secret
management: dev secret is gone; no long-lived signing secret exists (opaque tokens). Clock-skew: expiry
checks server-side only. Tenant switching: `x-tenant-id` per request, membership re-checked (unchanged).
Pooled-connection safety: proven. All errors non-enumerating; **production refusal** if auth configuration
(hash policy) is missing — the API refuses to boot, mirroring 1B's dev-adapter boot gate.

## 19. Event catalogue

New family **`identity.authentication`** (owner m02-auth), registered in `event-registry.yaml` + declared in
the contracts union + `naming-map` `event_family_registered: true`, **in the same commit as the first event**
(GAP-1 discipline). Classification **`confidential`** (natural persons + security signal). Types (payload
v1, **identifiers/transitions only** — never passwords, tokens, or raw identifiers; IP only if policy allows
and then `restricted`): `AuthenticationSucceeded`, `AuthenticationFailed`, `SessionIssued`,
`SessionRefreshed`, `SessionRevoked`, `SessionExpired`, `CredentialCreated`, `CredentialChanged`,
`CredentialDisabled`, `AccountLockoutInitiated`, `AccountLockoutCleared`. Delivered through the **existing
OUTBOX port** (in-memory stand-in until m06) — no second event path.

## 20. Audit-code catalogue

Register a new prefix **`AUTH_`** (m02-auth) in `audit-code-registry.yaml`, format `<PREFIX>_<ENTITY>_<ACTION>`:
`AUTH_LOGIN_SUCCEEDED`, `AUTH_LOGIN_FAILED`, `AUTH_SESSION_ISSUED`, `AUTH_SESSION_REFRESHED`,
`AUTH_SESSION_REVOKED`, `AUTH_SESSION_EXPIRED`, `AUTH_CREDENTIAL_CREATED`, `AUTH_CREDENTIAL_CHANGED`,
`AUTH_CREDENTIAL_DISABLED`, `AUTH_LOCKOUT_INITIATED`, `AUTH_LOCKOUT_CLEARED`. Adverse/terminal actions
(`FAILED`, `DISABLED`, `REVOKED`, `LOCKOUT_INITIATED`) are `reason_required`. Written through the AUDIT port
(m03 stand-in); **never** record secrets — code + entity id + generic reason only.

## 21. Permission catalogue

Register namespace **`auth.*`** (m02-auth, substage 1C) in `permission-registry.yaml`. Three segments per
the `@Endpoint` validator: `auth.session.view`, `auth.session.revoke` (administrative cross-account session
management). Self-service on one's own sessions needs no permission. **Declared, not granted** until 1D.
`rbac.*` remains 1D.

## 22. Test catalogue

**PURE smoke:** credential policy (hash params, no-plaintext invariant), session state machine (issue/
refresh/rotate/revoke/expire, reuse→family-revoke), lockout/throttle math, login-identifier normalization,
enumeration-resistance (identical failures), permission/audit/event **registry conformance**, and the
`x-dev-actor`-is-gone conformance check.

**DB (PostgreSQL 16):** credential + session global isolation (invisible without system context); pre-auth
`login_attempts` writes with no actor; append-only session history by privilege; no-DELETE; pooled-connection
non-leak; the role model (non-superuser, NOBYPASSRLS); **no Stage 1D RBAC table exists**; **no plaintext/token
column exists** (assert column names).

**Credential tests:** correct password · wrong password · unknown identifier · suspended identity · suspended
account · disabled credential · hash verify · hash upgrade-on-login · no password in logs · enumeration
resistance.

**Session tests:** issue · validate · expire (idle + absolute) · refresh · rotate · revoke · logout · replay
old refresh (→ family revoke) · reuse revoked session · password-change revocation · account suspension ·
identity suspension · membership suspension · tenant mismatch · concurrent sessions · administrative
revocation.

**Security tests:** forged/altered/missing/expired token · stolen-refresh replay · session fixation · CSRF
(if cookie) · CORS misconfig · brute force · rate-limit bypass · timing enumeration · cross-tenant session
use · system-actor misuse · permission injection.

**Integration (real login, no dev bypass):** login → M01 Tenant API · login → M02 Identity API · resolve
`ActorContext` through a real session · `x-dev-actor` rejected · `x-actor-id` rejected · `x-permissions`
still isolated behind AUTHZ · Stage 1D tables absent · system context distinct from actor context.

## 23. Implementation sequence

1. **ADR-015 + ADR-016 accepted** (D1, D2) — gate; nothing below starts until then.
2. `feat(auth): domain + session/credential state machines` — pure, no I/O.
3. `feat(auth): migrations + RLS` — `authentication_credentials`, `sessions`, `session_status_history`,
   `login_attempts`; grants; no DELETE.
4. `feat(auth): credential + session services` — hashing (ADR-016), issue/verify/rotate/revoke, lockout.
   Register `identity.authentication` family + first event in the same commit.
5. `feat(auth): SessionActorAdapter + bind in apps/api` — replace `DevActorAdapter`; **delete** it and
   `x-dev-actor`.
6. `feat(auth): /api/v1/auth API` — login/logout/refresh/session/sessions/admin.
7. `test(auth): prove sessions, lockout, isolation and dev-adapter removal` — PURE + DB + API + security.
8. `test(conformance): forbid live x-dev-actor; assert no credential/token columns` .
9. `docs(auth): document m02-auth` + manifest/registries; ADRs moved to Approved.

## 24. Commit plan

Small, reviewable, Conventional Commits as in §23 (one concern each: domain → persistence → services →
adapter/retirement → API → tests → conformance → docs). Register each cross-cutting artifact (permission,
audit code, event family) **in the same commit** as the code that first uses it.

## 25. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Native Argon2 dependency (supply chain, build) | Medium | ADR-016 pin+review; `scrypt` fallback needs no dep |
| R2 | Token/credential leaks into logs, events, audit | **High** | No-plaintext invariant tested; identifiers-only payloads; `confidential`/`restricted` |
| R3 | Refresh-token theft | **High** | Rotation + reuse→family-revoke; short idle expiry; hashed at rest |
| R4 | CSRF (if cookie) / XSS (if bearer) | **High** | ADR-015 D3: HttpOnly cookie + CSRF token; strict CORS |
| R5 | Dev adapter survives into 1C/prod | **High** | Deleted, not disabled; conformance forbids `x-dev-actor` |
| R6 | `ContextAuthz`/`x-permissions` mistaken as 1C's job | Medium | §17: explicitly 1D; unchanged here |
| R7 | Audit/outbox still stand-ins (m03/m06) | Medium | Behind ports; auth events are what an auditor wants first — sequence m03 close behind |
| R8 | Lockout as a denial-of-service vector | Medium | Per-source + per-account throttling; lockout is time-boxed, not permanent |
| R9 | PAT still unconfirmed revoked; repo public | Medium–High | Standing governance items, carried since Stage 0 |

## 26. Open questions

1. **D2/ADR-016:** accept a native Argon2 dependency, or take the zero-dependency `scrypt` route?
2. **D3:** session transport — **HttpOnly cookie + CSRF** (recommended) vs `Authorization: Bearer`?
3. Idle vs absolute session lifetimes (proposed: 30 min idle, 12 h absolute; refresh 14 d rotating) — confirm.
4. `login_attempts` retention + whether client IP/UA may be stored (Kenya DPA — `OPEN_QUESTIONS` #6/#7).
5. Service-account credentials (manifest lists `service_account_credentials`) — in 1C or deferred with MFA?
6. Sequence m03 (audit spine) close behind 1C so authentication audit is persisted.

## 27. Definition of Done (for the eventual implementation)

Credentials stored Argon2id, never plaintext, never logged · login issues a session; logout/refresh/revoke
work · sessions opaque, hashed at rest, idle+absolute expiry, rotation + reuse detection · `SessionActorAdapter`
bound; **`DevActorAdapter` and `x-dev-actor` deleted**; `x-actor-id` still rejected · `ActorResolver`
unchanged and authoritative; suspension/ended-membership take effect next request · `x-permissions` +
`ContextAuthz` unchanged (1D) · new global tables RLS-isolated, no DELETE, append-only history · no Stage 1D
table exists · `auth.*` permissions, `AUTH_` audit codes, `identity.authentication` events registered and
agreeing across manifests · PURE + DB (PG16) + API + security + integration tests green, no skips · build/
lint/format clean on a **clean checkout** (the Stage 1B CI lesson) · docs + manifest + ADRs updated · CI both
lanes green under branch protection.

## 28. Recommendation

### GO for Stage 1C implementation (2026-07-18)

The trust boundary, credential/session model, RLS, `ActorResolver` integration, `DevActorAdapter` retirement,
Stage 1D boundary, APIs, events, audit, permissions and test plan are all specified and consistent with the
certified baseline. **ADR-015 and ADR-016 are accepted and D3 is resolved (Secure HttpOnly cookie + CSRF), so
implementation is authorized** on `feature/stage-1c-authentication-sessions`. Stage 1D remains excluded.
Governance items (PAT revocation, repository visibility) remain standing but do not block Stage 1C.
