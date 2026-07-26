# Stage 2.3 — M07 Versioned Explainable Rules Engine — Post-Merge Certification

**Date:** 2026-07-26
**Module:** `m07-rules` (the generic enterprise decision-rules engine: versioned, immutable-after-publish rule
sets producing deterministic, explainable decisions through decision tables and structured typed conditions).
**Verdict:** ✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS** (certification on branch `cert/stage-2-3-m07-rules`;
certification PR pending, not merged).

## 1. Identity

| Fact | Value |
| --- | --- |
| Implementation PR | **#14** |
| Reviewed implementation head | `6c16aa301eff8d4ca885b181c384aa66e2c89299` |
| Implementation merge SHA (squash) | `0701a011b1fdf160e8348346f74aac3440cf32a9` |
| Certified baseline SHA (main tested) | `0701a011b1fdf160e8348346f74aac3440cf32a9` |
| Certification branch | `cert/stage-2-3-m07-rules` (cut from merged main) |
| Parent baseline (pre-merge main) | `130c28447a8e6f548b2f3048fdb9a0504470a2cd` (certified Stage 2.2, PR #13) |
| PR #14 | `state: closed`, `merged: true`, `merged_at: 2026-07-26T11:59:55Z` |

**Tree-equivalence:** PR #14 was **squash-merged** (`0701a01` has a single parent `130c284`), so the reviewed
head is not a literal ancestor — ancestry is not required. `git diff 6c16aa3 0701a01` is **empty**: the merged
tree is **byte-identical** to the reviewed head across the entire repository. All intended files are present; no
unexpected files were introduced.

## 2. Scope certified (merge diff `130c284..0701a01`)

ADR-032…037; the m07 completion report + this certification report; `packages/m07-rules` (24 files — PURE domain,
migrations, repository, services, emitter, permissions/audit codes, tests); `packages/contracts/src/rules-events.ts`
+ the `DomainEvent` union (6 families); rules permissions (13, registered **and seeded**); rules audit codes (17);
event-registry `rules.lifecycle` (GAP-2 closed); naming-map; m07 migrations; `/api/v1/rules` API (9 files under
`apps/api`) + platform/app wiring; m07 tests; build wiring (`tsconfig.json`); manifest Stage 2.3 block; the
assertion-count bump in `contracts`/`m02-identity` smoke.

**Exclusions (verified absent):** no m08/m09/m12/m13/m22 implementation (all README-only, 0 impl files — grep of
the merge diff for those modules returns nothing but registry/docs lines); no graphical rule designer; no
arbitrary scripting (`eval`/`Function`/`vm`); no autonomous approvals; no accounting posting/disbursement; no
direct notification delivery; no document storage; **no duplicate shared platform service; no second outbox; no
duplicate audit table**; no cross-tenant rule evaluation; no false certification claims.

## 3. Local gate results (baseline `0701a01`)

Environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative — see §12); Node **v22.14.0**;
npm **10.9.2**; connected via `DATABASE_APP_ROLE=finapp_app` (non-superuser, RLS enforced — not a superuser
session). Lint was run on a **wiped `dist`** (replicating CI's lint-before-build order, the Stage 1B trap).

| Gate | Result |
| --- | --- |
| Format check | ✅ PASS (all files Prettier-clean) |
| Lint (wiped dist) | ✅ **0 errors** (12 pre-existing non-blocking `no-unnecessary-condition` warnings only) |
| Build / typecheck | ✅ 0 type errors (`tsc --build` clean) |
| PURE smoke | ✅ **13 suites, 1869 assertions, 0 failures** (m07-rules 156) |
| Conformance (registries + manifest parse + `@Endpoint` perms/audit + RLS convention) | ✅ **602 assertions** |
| Migration ordering + checksums (dry-run) | ✅ **14 migrations**, dependency order, checksums valid |
| Fresh PostgreSQL replay | ✅ **14 applied, 0 already-applied** (from an empty database) |
| DB integration + API specs | ✅ **16 specs, 473 assertions, 0 failures** (m07-rules 22, m07-services 25, **api-rules 18**, rls-convention 26) |

The DB/API specs collectively exercise the certification matrix: RLS + cross-tenant isolation, default-deny +
permission-header-injection (a header cannot grant authority), append-only evidence + history, immutable published
versions, one-ACTIVE-per-set, deterministic evaluation, hash-verified non-mutating replay, per-key idempotency,
redacted evidence (input hash, not raw inputs), dry-run simulate, audited export, stable error codes, and tenant
non-leakage — all over the `finapp_app` non-owner role so RLS is genuinely enforced.

## 4. Domain model verification (§E)

Rule-set-version lifecycle DRAFT→VALIDATED→PUBLISHED→ACTIVE→RETIRED→ARCHIVED, **frozen at PUBLISHED** (immutable
`spec`; a change is a new version — ADR-032). Structured typed condition AST (compare / in / range / present /
absent / string / date / and / or / not) — **interpreted, never executed as host code** (ADR-033). Decision tables
with four hit policies (FIRST / UNIQUE / COLLECT+aggregate / PRIORITY — ADR-034). The evaluation engine produces a
structured `Explanation` (outputs, matched rule ids, machine reason codes, traces) plus a canonical SHA-256 input
hash. Decimal-safe numerics are BigInt-backed; float is rejected. The fail-closed definition validator rejects
malformed, non-MVP, or unsafe definitions before they can be published.

## 5. Database & RLS verification (§F)

All **5** m07 tables — `rule_set`, `rule_set_version`, `rule_evaluation`, `rule_test_case`, `rule_set_history` —
carry composite `(tenant_id, id)` PKs, composite tenant-safe FKs, and ENABLE + **FORCE** RLS with a
`tenant_isolation` policy. Live check on the certified baseline:

- `relrowsecurity=t` **and** `relforcerowsecurity=t` on **5/5** tables.
- `tenant_isolation` policy present on **5/5** tables.
- **0 DELETE grants** to `finapp_app` on any `rule_*` table (append-only evidence + history; live
  `information_schema.role_table_grants` check returned empty).
- `rule_set_version_one_active` **partial unique index** = exactly one ACTIVE version per set.
- `rule_evaluation_idem_key` **unique index** = idempotent governed evaluations (replay-safe de-dupe).
- `content_hash` frozen at publish (published `spec` never updated).

No hidden superuser dependency — the DB lane runs as `finapp_app` (proven by the RLS-enforced cross-tenant specs
passing as a non-owner, non-superuser role).

## 6. Authorization verification (§G)

**13** `rules.*` permissions: registered in the permission registry, **seeded into the `permissions` catalogue**
(live DB check confirms all 13 present — `role_permissions` FKs to it, so without the seed the API would be
unusable), three-segment compliant, enforced server-side in the services (default deny). The privileged surface
is the explicit `rules.platform.administer` (no vague 2-segment `rules.admin`). Verified through `api-rules`: a
header cannot grant authority (HTTP 403 even with an injected permissions header); every mutating route requires
its permission; tenant mismatch does not disclose. Platform-vs-tenant scope is distinct (ADR-037).

## 7. Audit verification (§H)

m07 writes through the kernel `AUDIT` port (m03 `AuditService`) via `M07Emitter` — **no duplicate audit table**
in m07. **17** `RULES_*` audit codes are registered (conformance validates every `@Endpoint` audit code against
the registry — an unregistered code fails CI). Audit `write(tx,…)` runs in the same transaction as the mutation
(fails the action if audit fails). Sensitive evaluation inputs are **not** placed in audit detail — evidence and
audit carry the input **hash** and a redacted outcome only (ADR-035).

## 8. Outbox & events verification (§I)

**m07 owns no outbox.** It publishes the `rules.lifecycle` family through **m06's** single durable
`workflow_event_outbox` (ADR-004/036) — live check confirms the only `%outbox%` table in the schema is
`workflow_event_outbox` (m06's). The event publish happens in the caller's business transaction (atomic with the
state change). The `rules.lifecycle` family is registered in `event-registry.yaml` (owner `m07-rules`, GAP-2
closed) and added to the contracts `DomainEvent` union (`RulesLifecycleEvent` exported from `rules-events.ts`).

## 9. Determinism, replay & idempotency verification (§J)

**Determinism:** the evaluation path has no `Date.now`, no `Math.random`, no env/fs/network — "now" comes only
from `context.evaluatedAt`; the same version + same input yields an identical `Explanation` and identical SHA-256
input hash (ADR-033; PURE-tested in the m07 smoke suite). **Replay:** `replay` re-runs the original **immutable**
version and verifies the re-supplied input's hash — non-mutating, hash-verified (DB-tested). **Idempotency:** the
`rule_evaluation_idem_key` partial unique index de-dupes governed evaluations per key; a retry is safe and
returns the original evidence rather than writing a duplicate (DB-tested).

## 10. Security & safe-execution verification (§L)

The condition engine is a structured typed AST interpreter over declared variables — **interpreted, never
executed as host code**. Verified: **no `eval`, no `Function` constructor, no `vm`, no `require`/dynamic `import`,
no `process`/`child_process`, no `Math.random`, no `Date.now`** in executable code (the only occurrences are a doc
comment naming their deliberate absence, and the `authz.require(...)` method). Definitions are schema-validated
and the validator fails closed on any structural, type, or limit error (ADR-033). Decimal-safe money: BigInt-backed
decimal, float rejected (`add("0.10","0.20") = "0.30"`).

## 11. API verification (§K)

Prefix **`/api/v1/rules`**. Route groups: rule-set authoring + lifecycle (author/validate/publish/activate/retire),
evaluate / replay / simulate / export, and tests. Every mutating route declares `@Endpoint({permission, auditCode})`
(conformance-validated) and is service-enforced with default-deny. `api-rules` (18 assertions) proves the surface
end-to-end over HTTP, including that a permission header cannot grant authority.

## 12. Authoritative CI (PostgreSQL 16)

Implementation PR **#14**, head `6c16aa3`, workflow run **30152364016** (`event: pull_request`) — **Smoke lane +
DB lane both `success`** on `postgres:16` (the DB lane asserts `server_version_num` is 16.x and fails otherwise).
The merged tree (`0701a01`) is byte-identical to that head, so the PG16 evidence transfers to the certified
baseline. The local PG15.2 run above independently re-confirms every gate; RLS FORCE, `tenant_isolation`, and
composite-FK semantics are identical on 15 and 16, so the local run is a real proof and CI on 16 is the
authoritative one.

## 13. Documented limitations (deferred, not defects)

Per the ADRs and completion report, the following are explicitly out of MVP scope and reserved for later stages:
no graphical/visual rule designer (authoring is API + structured JSON); no ML/statistical rule inference; no
standing background re-evaluation worker (evaluation is request-driven); rule-set import/export is JSON over the
API, not a package format; consumer integrations (Feedback/Cases/Finance/Credit/Pricing/Fraud/Reconciliation) are
**not** built here — m07 is the reusable engine those modules will consume. None weaken any architecture, RLS,
authorization, audit, determinism, explainability, immutability, or test guarantee.

## 14. Verdict

✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS.** The M07 versioned explainable rules engine is implemented on `main`
(`0701a01`), byte-identical to the reviewed PR #14 head, with all 19 certification gates executed and green
locally and both authoritative PG16 CI lanes green. Certification is recorded on branch `cert/stage-2-3-m07-rules`;
the certification PR is pending and **not merged**. No later module (m08+) was touched.
