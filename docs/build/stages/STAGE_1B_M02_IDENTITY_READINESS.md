# Stage 1B — M02 Identity Foundation — Readiness Assessment

**2026-07-15** · Branch `feature/stage-1b-m02-identity` · Planning only. **No M02 implementation.**

## Verdict: CONDITIONAL GO for M02 implementation

M01 is merged and **certified on PostgreSQL 16**. The M02 branch exists from merged `main` with zero
divergence and no implementation. The design below is ready to build.

Two conditions are **governance gaps, not design gaps**, and both have been open across six reports:
`main` is **still unprotected**, and the **compromised PAT is still not confirmed revoked**. M01 merged
into an unprotected branch — its checks passed by diligence, not by policy.

---

## 1. M01 merge confirmation

| | |
|---|---|
| Pull request | **#2** — *Stage 1A: Implement M01 Tenant Foundation* |
| State | closed, **merged: true** |
| Merge method | True merge commit (original history preserved) |
| Merge commit | **`251decf`** |
| Base ← head | `main` ← `feature/stage-1-saas-foundation` (head `0a2644f`) |

All seven commits are ancestors of `main` — verified individually, not assumed:

`f2c680b` kernel contracts + PgDb · `75f3501` domain + lifecycle · `833bdf9` persistence + RLS ·
`3a2fa13` administration API · `e5ffbcb` isolation + lifecycle tests · `a0de973` module docs ·
`0a2644f` completion report.

`feature/stage-1-saas-foundation` is **merged into `main` and retained**. Deleting it is a governance
decision and was not taken here.

## 2. PostgreSQL 16 certification evidence

**The M01 stage gate (C1) is DISCHARGED.** Read from the GitHub API — the repository is public, so no
credential was used.

| Run | Event | Head | Smoke lane | DB lane |
|---|---|---|---|---|
| `29417651716` | **`pull_request`** | `0a2644f` (PR #2 head) | ✅ PASS | ✅ **PASS** |
| `29417746720` | `push` | `251decf` (`main`) | ✅ PASS | ✅ **PASS** |

DB-lane steps on `main` (`29417746720`) — every one `success`, **none skipped**:

```text
  ok  Initialize containers
  ok  Assert the database lane can actually run     <- DATABASE_URL non-empty + pg_isready
  ok  Assert PostgreSQL 16                          <- server_version_num asserted 16.x
  ok  Migrations (dry run — ordering and checksums)
  ok  Migrations
  ok  DB integration specs                          <- M01 isolation + Stage 0 RLS convention
```

- ✅ Build, lint, formatting and smoke passed.
- ✅ The DB lane asserted PostgreSQL 16 **via `server_version_num`**, not via the image tag.
- ✅ M01 database, lifecycle and tenant-isolation specs ran and passed.
- ✅ **No database test was skipped.** The lane's fail-closed guard makes a silent skip impossible.

M01's isolation was developed against local PostgreSQL 15.2; **this run is the certification on 16.**

## 3. Branch-protection status

**❌ NOT ENABLED. `main` is unprotected** — `GET /branches/main` → `"protected": false`. The detailed
protection endpoint returns HTTP 401 unauthenticated, so this is the boolean GitHub itself reports.

**M01 merged into an unprotected branch.** Its checks passed because the engineer ran them, not because
policy required them. Nothing today mechanically prevents a direct push to `main`, a force push, or a
merge with a red DB lane.

Nothing blocks fixing it: both `Smoke lane` and `DB lane` have now run four times and **are selectable**.
Spec: `docs/build/GITHUB_BRANCH_PROTECTION_RECOMMENDATION.md` §7.

## 4. PAT-revocation status

**❓ NOT VERIFIABLE from here, and therefore a standing security blocker.**

The token beginning `ghp_0jL…` was embedded in the remote URL and copied to world-readable
`C:\Windows\System32\finapp-dynamics\.git\config`. Write access was restored by granting `wacherakelvin`
repository access — which **does not revoke the leaked token**. Whether it has since been revoked cannot
be determined without authenticated access to the issuing account's token list.

**Treated as unrevoked until someone confirms otherwise.** Open across six reports.

## 5. Repository-visibility status

**⚠️ PUBLIC, and not recorded as an approved decision anywhere.**

`"private": false`, `"visibility": "public"`. Verified decisively: an unauthenticated
`GET raw.githubusercontent.com/.../main/README.md` returns **HTTP 200**.

The full enterprise architecture, ADRs, security/GRC posture, database conventions, tenant-isolation
design and threat reasoning for a financial-services platform are world-readable. No credential is
exposed by it, and the CI evidence in this report was gathered through that public access. It may be
deliberate — but it should be an explicit decision with an owner, not a default.

## 6. M02 branch and base commit

| | |
|---|---|
| Branch | **`feature/stage-1b-m02-identity`** |
| Base commit | **`251decf`** (== merged `origin/main`) |
| Divergence from `main` | **0 files, 0 commits** |
| Pushed | ✅ remote matches local |
| M02 implementation present | ✅ **none** — 0 source files, 0 migrations, 0 identity permissions |

Validation on the branch: `npm install` (0 vulnerabilities); `npm run verify` — **4 suites, 333
assertions, 0 failures**; format clean.

## 7. Existing identity-related components

| Component | Where | What it is today |
|---|---|---|
| `RequestContext.userId?: string` | `kernel/src/request-context.ts` | **The actor seam.** Optional and unpopulated by anything trustworthy. |
| `RequestContext.permissions: readonly string[]` | kernel | Pre-resolved permissions. The authorization input. |
| `SystemContext { reason, correlationId }` | kernel | No tenant, no actor. Requires a stated reason. |
| `AUTHZ` token + `Authz` contract | `kernel/src/authz.ts` | `can()` / `require()`. **Authoritative.** |
| `ContextAuthz` | `m01-tenant/src/adapters.ts` | **TEMPORARY.** Reads permissions off the context. |
| `RecordingAudit` / `RecordingOutbox` | `m01-tenant/src/adapters.ts` | **TEMPORARY.** In-memory; not m03/m06. |
| `x-actor-id` | `apps/api/.../tenant.controller.ts:303` | **TEMPORARY.** Unauthenticated actor claim. |
| `x-permissions` | `apps/api/.../tenant.controller.ts:298` | **TEMPORARY.** Unauthenticated permission claim. |
| `x-tenant-id` | `tenant.controller.ts:273` → `TenantContextResolver` | Claim, **validated server-side**. Authoritative pattern. |
| `TenantContextResolver` | `m01-tenant/src/tenant-context.ts` | **Authoritative.** Verifies tenant exists + status permits. |
| `@Endpoint({permission, auditCode})` | `kernel/src/endpoint.ts` | **Authoritative.** Route authorization metadata. |
| Permission registry | `manifests/permission-registry.yaml` | **Authoritative.** `identity.*`, `rbac.*` reserved for m02. |

### The temporary surface is small — deliberately

`ContextAuthz` is bound in **exactly one line**: `apps/api/src/tenant/tenant.module.ts:47`. There are 15
`authz.require(...)` call sites across M01's services, and **every one goes through the kernel `Authz`
contract**. Header parsing is confined to `tenant.controller.ts`.

That is the payoff of the port design: replacing the binding requires **zero changes to any service**.

## 8. Authoritative components to reuse (do not reimplement)

Kernel `RequestContext`/`SystemContext`, `ProblemError`, `@Endpoint`, the ambient-transaction `Db`, the
four tokens and their contracts · `PgDb` · the `tenant_isolation` convention **verbatim** including
`NULLIF(..., '')` · the migration runner · the PURE + DB harness · `TenantContextResolver` (extend, do
not fork) · `tenants` and the org tree (**read via m01's API/contract — never query m01's tables**).

## 9. Temporary components to replace

| Component | Replaced by | Stage |
|---|---|---|
| `x-actor-id` | Signed dev-identity adapter → real session | **1B** → 1C |
| `x-permissions` | Persistent RBAC resolution | **1D** |
| `ContextAuthz` | `RbacAuthz` (m02-rbac) — **deleted, not left bound** | **1D** |
| `RecordingAudit` | m03-audit spine | Stage 1 (m03) |
| `RecordingOutbox` | m06 transactional outbox | Stage 1 (m06) |

## 10. M02 domain boundaries — the 1B/1C/1D split

**A scope conflict was found and resolved by decision.** Your §5 excludes RBAC and password
authentication from M02 "unless approved architecture expressly places them here" — and it does:
`implementation-manifest.yaml` gives m02 the capability *"Authentication + RBAC + permission catalogue +
SoD"* with `db_ownership: [users, roles, permissions, user_roles, login_attempts(global), sessions]`, and
`STAGE_1_PROMPT.md` / `AUTH_MULTI_TENANCY_RBAC.md` agree. The escape clause fires, so the two readings
contradict.

**Decision (product owner, this session): split m02 into three sub-stages.** The manifest must record the
split — a manifest that says m02 is one thing while the build treats it as three is the drift CLAUDE.md
forbids.

| Stage | Module | Owns | Ends with |
|---|---|---|---|
| **1B** | `m02-identity` | Identity registry, accounts, identity↔account links, account statuses, internal/external users, service-account **readiness**, auth-subject **references**, identity lifecycle, actor resolution, tenant membership, environment-membership readiness | `x-actor-id` gone; actor enters context via a **signed dev adapter** |
| **1C** | `m02-auth` | Sessions, tokens + refresh, revocation, lockout, dormant detection, service-account credentials, break-glass seam, `login_attempts` (global, pre-auth) | Dev adapter gone; real authenticated session |
| **1D** | `m02-rbac` | Roles, permission catalogue seed, `user_roles`, scopes, SoD detection | `x-permissions` gone; **`ContextAuthz` DELETED** |

**Keep these concerns separate. Do not merge them into one user service.**

- **Identity** — who someone *is*. A person, independent of any tenant.
- **Authentication** — proving they are that person. 1C.
- **Authorization** — what they may do. 1D.
- **Tenant membership** — which tenants they belong to. 1B. *Not* a role.
- **Role assignment** — what they may do *within* a tenant. 1D.

Membership and role assignment are the pair most often collapsed, and collapsing them is how "can this
person see this tenant at all?" becomes indistinguishable from "may they approve a journal in it?" —
which is exactly the SoD boundary ADR-007 depends on.

### M02 (1B) must NOT own

Full role/permission assignment (1D) · complete RBAC administration (1D) · PAM · identity-governance
campaigns · password-provider implementation (1C) · MFA provider · production SSO · billing/licensed
seats (m39) · **audit persistence (m03)** · **outbox delivery (m06)** · business-module users.

## 11. Proposed database ownership (Stage 1B)

| Table | Scope | Notes |
|---|---|---|
| `identities` | **Global control plane**, RLS FORCE + system escape (ADR-014 pattern) | A person. Exists independently of tenants — one human may belong to several. |
| `accounts` | **Global**, RLS FORCE + system escape | A usable login subject bound to one identity. Identity ≠ account. |
| `account_identity_links` | Global | Explicit link table; supports service accounts with no human identity. |
| `account_tenant_memberships` | **Tenant-scoped**, RLS FORCE, **no escape** | The join. Membership is per tenant, so it lives inside the tenant. |
| `account_environment_memberships` | Tenant-scoped, RLS FORCE, no escape | Readiness only; environments are m01's. |
| `identity_status_history` | Tenant-scoped/global mirror, **append-only** | Same append-only-by-privilege pattern as `tenant_status_history`. |
| `auth_subjects` | Global | **References only** to an external IdP subject. **No credentials, no secrets** (ADR-009: no raw key storage). |

Rationale for the global/tenant split: an identity that existed only inside one tenant could not be the
same person in two tenants without duplication, and duplicated humans are how a leaver is offboarded from
one tenant and silently retained in another. Membership is the tenant-scoped part, so a tenant can see
its own members and nothing else.

**`login_attempts` is global and pre-authentication** (ADR-001 enumerated exception,
`AUTH_MULTI_TENANCY_RBAC.md`) — it belongs to **1C**, not 1B.

## 12. Proposed APIs

Registered prefixes (`naming-map.yaml`, authoritative): `/api/v1/auth` (**auth: mixed** — pre-auth routes
are the documented exception to tenant resolution), `/api/v1/users`, `/api/v1/roles`.

- **1B** — `/api/v1/users`: identity + account CRUD, lifecycle actions, membership management.
- **1C** — `/api/v1/auth`: login, refresh, logout, revoke.
- **1D** — `/api/v1/roles`: roles, assignment, SoD checks.

## 13. Proposed events

Family **`identity.lifecycle`** (`naming-map.yaml`).

> ⚠️ **GAP-1 recurs for m02.** `naming-map.yaml` records `event_family_registered: false` —
> `identity.lifecycle` is declared in `implementation-manifest.yaml:58` but is **absent from
> `event-registry.yaml`**. This is the identical defect closed for m01 in Stage 1A.
>
> **Deliberately NOT fixed on this branch** (product-owner decision). Registering a family before the
> module that emits it would declare an event ahead of its module — the rule the contracts smoke suite
> exists to catch. **M02 step 1** is to register it in the same commit as the first identity event, and
> flip the flag to `true`.

Proposed types (v1): `IdentityCreated`, `IdentityUpdated`, `AccountCreated`, `AccountLinked`,
`AccountActivated`, `AccountSuspended`, `AccountDeactivated`, `AccountClosed`, `MembershipGranted`,
`MembershipRevoked`. Payloads carry identifiers and transitions — **never** email, phone or names.
Classification **`confidential`** (higher than `tenant.lifecycle`'s `internal`: these events concern
natural persons).

## 14. Proposed permissions

Namespaces `identity.*` and `rbac.*` (registered). **Three segments** — `<domain>.<entity>.<action>` —
the kernel's `@Endpoint` validator rejects two.

**1B:** `identity.person.view|create|edit`, `identity.account.view|create|edit|activate|suspend|reactivate|close`,
`identity.membership.view|grant|revoke`, `identity.service_account.view|manage`.
**1D:** `rbac.role.view|create|edit|assign|revoke`, `rbac.permission.view`, `rbac.sod.view|override`.

**Declared, not granted.** No role holds them until 1D. See §17 on the bootstrap administrator.

## 15. Proposed audit codes

Prefixes `IDENTITY_` and `RBAC_` (registered). Format `<PREFIX>_<ENTITY>_<ACTION>` — **three segments**;
`IDENTITY_CREATED` is invalid.

`IDENTITY_PERSON_CREATED`, `IDENTITY_ACCOUNT_CREATED|ACTIVATED|SUSPENDED|REACTIVATED|CLOSED`,
`IDENTITY_MEMBERSHIP_GRANTED|REVOKED`, `IDENTITY_LINK_CREATED`. Suspension, closure and revocation are
`reason_required: true`. **All must be registered in `audit-code-registry.yaml`** — the m02 smoke suite
should assert this exactly as m01's does.

## 16. Actor-resolution design

`RequestContext.userId` is the seam and it is **optional today**. The resolution chain:

```text
credential ──> AuthenticatedActor ──┐
                                    ├──> RequestContext { tenantId, userId, permissions, correlationId }
tenant claim ──> TenantContextResolver ─┘   (m01 — authoritative, reuse it)
```

- **1B** — `ActorResolver` contract + a **signed dev-identity adapter**: a short-lived, signed token
  minted by a dev-only endpoint, carrying an account id. It replaces `x-actor-id`, whose problem is not
  that it is a header but that it is **unverified**. Signed is not authenticated — it must be
  environment-gated and **refuse to load when `NODE_ENV=production`**.
- **1C** — a real session replaces the adapter. `ActorResolver`'s contract does not change.
- **System actor** — `SystemContext` stays **actorless**. Do not invent a synthetic system user: an audit
  row naming "system" as the actor is indistinguishable from a real person having done it, which
  destroys the accountability the audit spine exists for. `reason` is the accountability.
- **Impersonation** — **prohibited in 1B.** No design, no seam, no flag. When it is eventually needed it
  must arrive as its own ADR with both identities recorded in every audit entry. A capability added
  "for readiness" is a capability nobody reviewed.

## 17. Tenant-membership design

- Membership is **`account_tenant_memberships`**, tenant-scoped, RLS FORCE, **no system escape**.
- **This is what M01 could not check.** `TenantContextResolver` proves the claimed tenant is real and
  usable; it cannot prove *this caller is entitled to it*, because there is no authenticated actor. 1B
  closes that: resolution becomes *tenant is valid* **AND** *this actor is a member*.
- A **multi-tenant identity** is one `identities` row with several memberships — never duplicated people.
- **Uniqueness:** `accounts.email_normalized` unique **globally**, not per tenant. Two tenants sharing a
  human must share the account, or offboarding one silently leaves the other.
- **Email normalization:** lowercase + trim, stored in a separate `email_normalized` column with the
  original preserved. **Do not strip dots or `+tags`** — that is provider-specific folding, and applying
  Gmail's rules to a corporate domain merges two different people.
- **Phone:** E.164 readiness column; no verification in 1B.
- **Lifecycle:** `invited → active → suspended → deactivated → closed`, with the same discipline as m01 —
  reason required on adverse/terminal transitions, `closed` terminal, append-only history.
- **Joiner/mover/leaver:** joiner = grant membership; mover = revoke + grant (never mutate in place — a
  mutated membership loses the record that the old access ever existed); leaver = revoke all + deactivate.
- **Data classification: `confidential`.** Identity data is personal data (Kenya DPA — `OPEN_QUESTIONS`
  #6/#7). It must never reach an AI provider (ADR-006) and must not appear in event payloads.

## 18. `ContextAuthz` removal plan

**`ContextAuthz` must not outlive 1D.** It is bound in one line (`tenant.module.ts:47`), so removal is
mechanical — the risk is not difficulty, it is forgetting.

| Step | Stage | What happens |
|---|---|---|
| 1 | **1B** | `ActorResolver` + signed dev adapter. **`x-actor-id` deleted.** `RequestContext.userId` becomes authoritative. `ContextAuthz` still reads `x-permissions`. |
| 2 | **1B** | Tenant resolution additionally requires **membership**. Closes M01's stated gap. |
| 3 | **1C** | Real sessions replace the dev adapter; the adapter is **deleted**, not disabled. |
| 4 | **1D** | `RbacAuthz` implements `Authz` from `user_roles`. Bind `AUTHZ` to it, **delete `ContextAuthz` and `x-permissions` in the same commit.** |
| 5 | **1D** | Delete the m01 smoke assertions that construct permissions by hand; replace with RBAC-backed fixtures. |

**Answers to the required questions:**

- *Replaces `x-actor-id`:* signed dev-identity token (1B) → authenticated session (1C).
- *Replaces `x-permissions`:* RBAC resolution from `user_roles` (1D).
- *How the actor enters `RequestContext`:* `ActorResolver` populates `userId`; nothing else may.
- *How permissions stay enforced before persistent RBAC:* `ContextAuthz` keeps enforcing through the
  **unchanged** `Authz` contract. The enforcement is real; only its input is untrusted. That is why the
  API must not face an untrusted network until 1D.
- *Is a temporary signed dev adapter required:* **yes** — 1B has no authentication by definition, and
  something must populate `userId`. It must be environment-gated and refuse to load in production.
- *How system context stays separate:* `SystemContext` carries no actor and holds permissions only when a
  platform action explicitly supplies them. `withSystem` relaxes **which rows** the database shows
  (ADR-014), never **which actions** are allowed. This must not regress.
- *How M01 is migrated without duplicating authorization:* it is not touched. All 15 `authz.require` call
  sites go through the kernel contract; swapping the binding changes no service. **Do not add a second
  authorization path in the API layer.**
- *Tests:* m01's smoke suite is unaffected (pure domain). Its DB spec is unaffected (tests the database).
  The API-level fixtures that mint permissions by hand change at 1D.
- *Final RBAC binding completes at:* **Stage 1D**.

⚠️ **Both paths must never coexist beyond 1D.** If 1D slips, `ContextAuthz` is a live
authorization-bypass surface in any environment where the API is reachable. Track it as a dated
obligation, not a TODO.

## 19. Dependencies on later RBAC, Audit and Outbox work

| Dependency | Owner | Impact on M02 |
|---|---|---|
| `AUDIT` → real spine | **m03** | 1B's audit entries are **not persisted**. Identity events are exactly what an auditor will demand first. m03 should follow 1B closely. |
| `OUTBOX` → real delivery | **m06** | `identity.lifecycle` events are **not delivered**. **Do not** build an identity outbox (ADR-004). |
| RBAC persistence | **1D** | `ContextAuthz` survives until then. |
| Status engine / workflow | m06 | Identity lifecycle uses its own state machine (m01's pattern), **not** a second workflow engine. |

## 20. Security risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **`ContextAuthz` outlives 1D** | **High** | §18. A live authorization bypass wherever the API is reachable. |
| R2 | The signed dev adapter reaches production | **High** | Environment-gate it; make it **fail to load** under `NODE_ENV=production`. A dev auth bypass in production is the classic breach. |
| R3 | **The API has no authentication until 1C** | **High** | Do not expose it outside a trusted network. Unchanged from M01. |
| R4 | Identity data leaks into events or AI | **High** | Classification `confidential`; identifiers-only payloads; ADR-006. |
| R5 | **PAT still not confirmed revoked** | **High** | §4. Six reports. |
| R6 | **`main` unprotected** | **Medium–High** | §3. M01 merged with no policy enforcing its checks. |
| R7 | Identity/account collapsed into one table | Medium | §10. Kills multi-tenant identities and clean offboarding. |
| R8 | Membership conflated with roles | Medium | §10. Destroys the SoD boundary. |
| R9 | Credentials stored in `auth_subjects` | **High** | **References only.** ADR-009: no raw key storage. |
| R10 | Repository public | Medium | §5. Needs an explicit decision. |
| R11 | Enumeration via identity APIs | Medium | Reuse m01's pattern: unknown and unauthorised return the **same** refusal. |

## 21. Test strategy

- **PURE smoke** — lifecycle state machine, email normalization (including the dots/`+tag` cases that
  must **not** fold), uniqueness rules, membership rules, permission/audit-code shape against the
  kernel's own validator, and **registry conformance** (every code registered — m01's pattern).
- **DB spec (PostgreSQL 16)** — membership isolation (tenant A cannot see tenant B's members); global
  identity + system escape (ADR-014); **pooled-connection reuse**; append-only history by privilege; the
  role model itself (app role not superuser, not `BYPASSRLS`, owns nothing).
- **API** — 401/403 separation, unknown-vs-unauthorised indistinguishability, optimistic concurrency,
  membership enforcement, correlation ids.
- **Integration** — actor resolution end-to-end; **a non-member is refused**; system context stays
  actorless.
- Prove it against **PostgreSQL 16 in CI** — never substitute 15.

## 22. Recommended M02 (1B) implementation sequence

1. Register `identity.lifecycle` in `event-registry.yaml`; flip `naming-map` → `true` (**GAP-1**) — in
   the same commit as the first event.
2. `feat(identity): add identity domain and lifecycle` — pure state machine, normalization, membership
   rules. No I/O. **No parameter properties** (strip-types).
3. `feat(identity): add identity persistence and rls` — migrations, ADR-014 pattern for global tables,
   no-escape for membership, append-only history by privilege, no DELETE grants.
4. `feat(identity): add actor resolution and the signed dev adapter` — **delete `x-actor-id`**;
   environment-gate the adapter.
5. `feat(identity): extend tenant resolution with membership` — closes M01's gap.
6. `feat(identity): add identity administration api` — `/api/v1/users`.
7. `test(identity): prove membership isolation and lifecycle`.
8. `docs(identity): document m02 identity foundation` + manifest.

## 23. Recommendation

### CONDITIONAL GO for M02 (Stage 1B) implementation

Satisfied:

- ✅ M01 merged (PR #2, `251decf`), all seven commits present
- ✅ **PostgreSQL 16 certified** — `Assert PostgreSQL 16` + `DB integration specs` passed on the PR and
  on `main`; **no test skipped**
- ✅ Build, lint, format, smoke green on the M02 branch (333 assertions)
- ✅ `feature/stage-1b-m02-identity` from merged `main`, **0 divergence, no implementation**
- ✅ Boundaries mapped; the temporary surface is one binding and two headers
- ✅ Scope conflict surfaced and **resolved by decision** (1B/1C/1D split)
- ✅ `ContextAuthz` removal plan with a named terminating stage (**1D**)

Conditions — **governance, not design**; none blocks starting 1B:

| # | Condition | Owner | Required by |
|---|---|---|---|
| **C1** | **Revoke the compromised PAT** | Repository owner | **Immediately.** Six reports. |
| **C2** | **Enable branch protection on `main`** (both checks selectable) | Repository admin | **Before 1B merges.** M01 already merged without it. |
| C3 | **Update the manifest to record the 1B/1C/1D split** | Engineer | **With the first 1B commit** — otherwise the manifest and the build disagree. |
| C4 | Decide repository visibility | Repository owner | At convenience |
| C5 | Close GAP-1 (`identity.lifecycle`) | Engineer | 1B step 1 |
| C6 | Sequence m03 (audit) close behind 1B | Engineering lead | Identity audit is unpersisted until m03 |

**Not GO**, because C1 and C2 are the same two governance gaps carried since Stage 0, and C2 now has
evidence of real consequence: **M01 merged into an unprotected `main`.** The design is ready; the
guardrails around it are not.

**M02 must not merge to `main` until C2 is done** — otherwise 1B's certification is, once again, a
matter of diligence rather than policy.
