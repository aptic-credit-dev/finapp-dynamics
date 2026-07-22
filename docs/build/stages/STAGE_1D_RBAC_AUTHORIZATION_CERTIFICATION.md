# Stage 1D — RBAC & Authorization — Post-Merge Certification

**Date:** 2026-07-22
**Module:** `m02-rbac` (persistent RBAC & authorization)
**Verdict:** ✅ **CERTIFIED ON BRANCH** (`cert/stage-1d-rbac-authorization`) — certification PR pending, not merged.

---

## 1. Identity of what was certified

| Fact | Value |
| ---- | ----- |
| Implementation PR | **#7** |
| PR base → head | `main` ← `feature/stage-1d-rbac-authorization` |
| Reviewed feature head SHA | `4669cca45e27a177dd1e63790058da6cb2cb527e` |
| Implementation merge SHA (squash) | `beea0d90dd283b1289a74af0107b3751794dd245` |
| Certified baseline SHA (main tested) | `beea0d90dd283b1289a74af0107b3751794dd245` |
| Certification branch | `cert/stage-1d-rbac-authorization` (cut from merged main) |
| Parent baseline (pre-merge main) | `004b2fd57f3caa15dad6c47c34dbd8a13093cbc2` (certified Stage 1C) |

**Merge representation.** PR #7 was **squash-merged**: `beea0d9` has a single parent (`004b2fd`), so the
reviewed head `4669cca` is not a literal ancestor. Its content is nonetheless fully represented — the merged
tree is **byte-identical** to `4669cca` across every Stage 1D path (`packages/m02-rbac`, `packages/m02-identity`,
`packages/contracts`, `apps/api/src/rbac`, `tools/conformance`), verified by `git diff 4669cca..beea0d9`.

**Main hygiene at certification time.** Working tree clean; local `main` == `origin/main` == `beea0d9`;
`packages/m02-rbac` present; the Stage 1D merge diff (`004b2fd..beea0d9`) touches only Stage 1 areas
(`m01-tenant`, `m02-identity`, `m02-rbac`, `contracts`, `apps/api`, `tools/conformance`, `tools/migrate`,
`docs`, `manifests`, lockfiles) and **no** later-stage module.

---

## 2. Authoritative CI results (PR #7, head `4669cca`)

Run `29898123814` (event `pull_request`) — **success**:

| Lane | Result | Notes |
| ---- | ------ | ----- |
| **Smoke lane** | ✅ passed | Format check ✅, Lint ✅, Build ✅, PURE smoke suites ✅ |
| **DB lane** | ✅ passed | PostgreSQL **16**; migrations dry-run + apply + DB integration specs ✅ |

The DB lane runs on PostgreSQL 16 (the authoritative version) and is green including the “Assert PostgreSQL 16”
guard, migrations (dry-run ordering/checksums, then apply), and all discovered `*.db-spec.ts` specs.

---

## 3. Local certification results (baseline `beea0d9`)

Environment: PostgreSQL **15.2** throwaway cluster (local; CI’s PostgreSQL 16 remains the authoritative gate),
connected as a non-privileged app role via `DATABASE_APP_ROLE=finapp_app` (RLS enforced).

| Gate | Command | Result |
| ---- | ------- | ------ |
| Format check | `npm run format:check` | ✅ PASS — all files match Prettier |
| Lint | `npm run lint` | ✅ 0 errors, **6 warnings** (all `no-unnecessary-condition`, non-blocking) |
| Build / typecheck | `npm run build` (`tsc --build`) | ✅ PASS — 0 type errors |
| PURE smoke suites | `npm run test:smoke` | ✅ **9 suites, 1166 assertions, 0 failures, 0 skipped** |
| Conformance | (within smoke lane) | ✅ **389 assertions** |
| Migration validation | `npm run migrate -- --dry-run` then `npm run migrate` | ✅ **8 migrations**, ordering + checksums valid; 8 applied, 0 already-applied |
| PostgreSQL DB specs | `npm run test:db` | ✅ **9 specs, 332 assertions, 0 failures** |
| Security-negative | (within DB specs, see §5) | ✅ default-deny, no self-escalation, immutability, cross-tenant isolation |

**Smoke suites:** contracts (37), kernel (35), m01-tenant (250), m02-auth (65), m02-actor-context (32),
m02-identity (232), m02-rbac (100), conformance (389), migrate (26).

**DB specs:** m01-tenant (46), m02-auth (32), m02-actor-resolution (37), m02-identity (78), m02-rbac (12),
api-auth (37), api-identity (78), api-rbac (20), rls-convention (26).

**Lint warnings (6):** `role.service.ts:367`, `repository.ts:228`, `repository.ts:235`
(`??` left-hand always defined), plus three `no-overlap`/`always-falsy` conditionals. All are defensive
conditions; CI’s `eslint .` does not fail on warnings.

> **Reproducibility note (honest).** An initial local `test:db` run reported 1 failing spec (`api-identity`,
> 5 cross-tenant assertions). Root cause was **environment, not code**: `DATABASE_APP_ROLE` was unset and the
> connection used the `postgres` superuser, so the API never `SET ROLE`d down and PostgreSQL bypassed RLS for
> the superuser (`platform.module.ts` binds no app role when the env var is absent — the code comment warns of
> exactly this). Re-running with `DATABASE_APP_ROLE=finapp_app` (as CI does) made all 9 specs green. No source
> change was made.

---

## 4. Architecture verification (on merged main)

| Claim | Verified | Evidence |
| ----- | -------- | -------- |
| Persistent `m02-rbac` active | ✅ | Module, migrations (`0001_rbac.sql`), DB specs green |
| `AUTHZ` bound to `RbacAuthz` | ✅ | `apps/api/src/platform.module.ts:47` `{ provide: AUTHZ, useClass: RbacAuthz }` |
| `ContextAuthz` retired | ✅ | No source `class ContextAuthz`; only comments documenting its deletion |
| `x-permissions` retired | ✅ | Stripped in `main.ts`; no live source use; tests assert it is dead |
| Permissions resolved server-side | ✅ | `PermissionResolver.resolve` reads persistent assignments per request |
| No authorization cache (immediate revocation) | ✅ | Resolver reads fresh per request; nothing cached across requests |
| No Stage 2 implementation on main | ✅ | m03/m06/m08/m09/m12/m13 are README-only placeholders (“No code yet”) |

---

## 5. Authorization & security verification (on merged main)

| Property | Verified | Evidence |
| -------- | -------- | -------- |
| Default deny enforced | ✅ | `RbacAuthz.can` returns `ctx.permissions.includes(permission)`; absent ⇒ deny; DB spec: create refused without `rbac.role.create` (403) |
| INDETERMINATE denied (fail-closed) | ✅ (by construction) | Model is binary default-deny; unresolved/absent permission ⇒ deny. No tri-state engine exists — see Known Limitations |
| Tenant vs platform scopes separated | ✅ | `assignment.service.ts` rejects `platform` scope on the tenant path; platform assignments read in system context, tenant in tenant context |
| Cross-tenant role assignment blocked | ✅ | Resolver reads tenant permissions under RLS; DB specs prove tenant isolation |
| Role assignment & revocation work | ✅ | `api-rbac` / `m02-rbac` DB specs green |
| Immediate revocation works | ✅ | No cache; permissions recomputed per request |
| SoD conflict enforcement works | ✅ | `sod.service.ts`; DB specs assert conflicting grants blocked |
| Bootstrap administrator idempotent | ✅ | `bootstrap.ts` “idempotent no-op” when already provisioned (`ON CONFLICT`) |
| Production bootstrap fails closed | ✅ | `bootstrap.ts` `failClosed(isProduction, …)` throws in production (ADR-020) |
| System context is not a universal allow | ✅ | `RbacAuthz` grants a SystemContext permission only if explicitly carried; `withSystem` relaxes rows, not actions |
| System roles immutable | ✅ | `updateRoleMeta` guarded `WHERE … is_immutable = false`; DB spec: editing `platform_admin` refused (409) |
| Physical deletion of roles/assignments prevented | ✅ | No `DELETE` grant on `roles`/`role_assignments`; no hard `DELETE FROM roles`/`role_assignments`; status-based retirement (ADR-005/010) |
| Authorization decisions audited via available audit port | ✅ | m02-rbac writes through kernel `AUDIT` port (`emit.ts` → `this.audit.write`); bound to `RecordingAudit` (pre-m03) — see Known Limitations |

> Note on physical deletion: `role_permissions` (the role→permission mapping) does carry `DELETE` — removing a
> permission from a role is legitimate. The **entities** `roles` and `role_assignments` cannot be physically
> deleted; assignments are revoked/expired via status transitions with append-only history.

---

## 6. Known limitations (honest)

1. **Audit uses the pre-m03 audit boundary.** `AUDIT` is bound to `RecordingAudit` (from `@finapp/m01-tenant`),
   an in-process recording adapter. The persistent audit spine (`m03-audit`) is a documented placeholder and
   is deferred. RBAC writes through the correct kernel port, so the sink is swappable when m03 lands.
2. **No authorization cache.** Permissions are resolved fresh per request. This is deliberate (immediate
   revocation) and trades a per-request resolve cost that a future cache/ADR may optimize.
3. **Exact-node org containment.** Scope validation checks the exact org node ref exists; there is no
   hierarchical descendant containment (a scope grant does not implicitly cover child nodes).
4. **Break-glass deferred.** No emergency break-glass elevation path is implemented in Stage 1D.
5. **Local certification on PostgreSQL 15.2.** The authoritative PostgreSQL 16 evidence is CI (PR #7 DB lane).
   Local re-verification used a 15.2 throwaway cluster.
6. **Outbox delivery deferred to m06.** Domain events are emitted through the outbox port; durable delivery is
   an m06 concern (deferred).

---

## 7. Certification verdict

✅ **CERTIFIED ON BRANCH.** Stage 1D (`m02-rbac`) is merged to `main` (`beea0d9`), the authoritative CI Smoke
and DB (PostgreSQL 16) lanes passed on the reviewed head `4669cca`, and all local gates — format, lint, build,
smoke (1166 assertions), conformance (389), migrations (8), and DB specs (332 assertions, including the
security-negative paths) — pass on the certified baseline `beea0d9`. No functional defect was found; the one
initial local DB failure was an environment misconfiguration (missing `DATABASE_APP_ROLE`), corrected without
any source change.

**Scope of this certification:** documentation only. The certification PR must **not** be merged, m03 must
**not** be rebased, and no Stage 2 implementation is authorized by this document.
