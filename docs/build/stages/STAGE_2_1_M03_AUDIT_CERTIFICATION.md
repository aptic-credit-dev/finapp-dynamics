# Stage 2.1 — M03 Enterprise Audit Foundation — Post-Merge Certification

**Date:** 2026-07-22
**Module:** `m03-audit` (append-only, tamper-evident audit spine — the persistent `AUDIT` port)
**Verdict:** ✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS** (certification on branch `cert/stage-2-1-m03-audit`; certification PR pending, not merged).

---

## 1. Identity of what was certified

| Fact | Value |
| --- | --- |
| Implementation PR | **#9** |
| PR base → head | `main` ← `feature/stage-2-1-m03-audit` |
| Reviewed implementation head SHA | `f6dd8e9af8385778689533131898f3332a033d64` |
| Implementation merge SHA (squash) | `587a3ce6afdbcd3d4d7e3735117c4e7220568a0e` |
| Certified baseline SHA (main tested) | `587a3ce6afdbcd3d4d7e3735117c4e7220568a0e` |
| Certification branch | `cert/stage-2-1-m03-audit` (cut from merged main) |
| Parent baseline (pre-merge main) | `56b7d3ea9cba42a81685fb6aefa1735fe8d314b3` (certified Stage 1D) |

**Merge representation.** PR #9 was **squash-merged**: `587a3ce` has a single parent (`56b7d3e`), so the reviewed
head `f6dd8e9` is not a literal ancestor. Ancestry is **not** required. Tree-equivalence is the strongest
possible: `git diff f6dd8e9 587a3ce` is **empty** — the merged tree is byte-identical to the reviewed head across
the entire repository. All intended files are present; no unexpected files were introduced.

**Main hygiene.** Working tree clean; local `main` == `origin/main` == `587a3ce`; PR #9 `merged: true`,
`state: closed`.

---

## 2. Implementation scope (contamination check)

The Stage 2.1 merge diff (`56b7d3e..587a3ce`) touches only:
- `packages/m03-audit` (module src, migrations, tests — 15 files),
- `apps/api/src/audit` + `apps/api/src/platform.module.ts` + `app.module.ts` + `apps/api/package.json` + `apps/api/tsconfig.json` (audit API wiring),
- `docs/01-architecture/ARCHITECTURE_DECISION_REGISTER.md` (ADR-029, ADR-030, ADR-031),
- `manifests/{permission-registry,audit-code-registry,implementation-manifest}.yaml` (m03 registry + manifest additions),
- `docs/build/stages/STAGE_2_1_M03_AUDIT_COMPLETION.md`,
- `package-lock.json`, `tsconfig.json` (build wiring).

**No contamination:** m06/m08/m09/m12/m13 remain README-only placeholders (0 implementation files each); no
duplicate Stage 1D implementation; the m06 planning docs (PR #10) are **not** on main (PR #10 not merged); no
false certification claims.

---

## 3. Local certification gate results (baseline `587a3ce`)

Environment: PostgreSQL **15.2** throwaway cluster (local; CI's PostgreSQL 16 is the authoritative gate),
connected via `DATABASE_APP_ROLE=finapp_app` (RLS enforced — **not** run as a superuser).

| Gate | Command | Result |
| --- | --- | --- |
| Format check | `npm run format:check` | ✅ PASS — all files Prettier-clean |
| Lint | `npm run lint` | ✅ 0 errors, **6 warnings** (pre-existing `no-unnecessary-condition`, non-blocking) |
| Build / typecheck | `npm run build` (`tsc --build`) | ✅ PASS — 0 type errors |
| PURE smoke | `npm run test:smoke` | ✅ **10 suites, 1256 assertions, 0 failures, 0 skipped** |
| Conformance | (within smoke) | ✅ **421 assertions** (manifest/registries parse + cross-checked) |
| Migration ordering + checksums | `npm run migrate -- --dry-run` | ✅ **10 migrations** in dependency order, checksums valid |
| Fresh PostgreSQL replay | `npm run migrate` | ✅ **10 applied, 0 already-applied** (incl. 2 m03 migrations) |
| DB integration specs | `npm run test:db` | ✅ **10 specs, 356 assertions, 0 failures** |
| Security-negative | (within DB specs) | ✅ default-deny, cross-tenant isolation, append-only refusal |
| RLS verification | (within DB specs + live check) | ✅ `audit_events` FORCE RLS (live `relforcerowsecurity=t`) |
| Audit append-only | (m03 db-spec) | ✅ UPDATE/DELETE/TRUNCATE refused |
| Audit hash-chain | (m03 db-spec) | ✅ chain built + `verifyChain` continuity |
| Authorization enforcement | (rbac + api db-specs) | ✅ default-deny 403; server-side permissions |

**PURE smoke suites:** contracts (37), kernel (35), m01-tenant (250), m02-auth (65), m02-actor-context (32),
m02-identity (232), m02-rbac (100), **m03-audit (58)**, conformance (421), migrate (26).

**DB specs:** m01-tenant (46), m02-auth (32), m02-actor-resolution (37), m02-identity (78), m02-rbac (12),
**m03-audit (24)**, api-auth (37), api-identity (78), api-rbac (20), rls-convention (26).

**Lint warnings (6):** all `no-unnecessary-condition` in `role.service.ts` / `repository.ts` (Stage 1D code);
CI's `eslint .` does not fail on warnings.

### CI evidence (authoritative — PostgreSQL 16)
Implementation PR #9, head `f6dd8e9`, run **29909503769**: **Smoke lane → success**, **DB lane → success**
(PostgreSQL 16; migrations dry-run + apply + DB integration specs). Merged tree is byte-identical to that head.

---

## 4. Architecture verification (on merged main)

| Claim | Verified | Evidence |
| --- | --- | --- |
| `AUDIT` → persistent `AuditService` | ✅ | `platform.module.ts`: `{ provide: AuditService, useFactory: db => new AuditService(db) }` + `{ provide: AUDIT, useExisting: AuditService }` |
| `AUTHZ` → `RbacAuthz` (unchanged) | ✅ | `platform.module.ts:53` `{ provide: AUTHZ, useClass: RbacAuthz }` |
| `RecordingAudit` retired from production | ✅ | No longer imported/bound in `platform.module.ts`; survives only as a test double |
| `audit_events` tenant-isolated | ✅ | ENABLE + **FORCE** RLS (live `relforcerowsecurity=t`); `tenant_isolation` policy + `scope_key`/`tenant_id` coherence CHECK; system escape for PLATFORM rows |
| Append-only (no UPDATE/DELETE/TRUNCATE) | ✅ | Triggers `audit_events_no_update/no_delete/no_truncate` → `RAISE EXCEPTION` for **every** role (binds owner); **plus** grant is `SELECT, INSERT` only |
| Hash chaining deterministic + verifiable | ✅ | `hashEvent(prev, e)` = SHA-256 over `INTEGRITY_VERSION\nprev\ncanonicalize(e)`; genesis = 64 zeros |
| Chain continuity checked | ✅ | `verifyChain`: seq contiguity + each `previousHash == prior` + recomputed hash match; per-scope `pg_advisory_xact_lock` gives gap-free `seq` |
| Audit write in the intended tx boundary | ✅ | `write(tx, ctx, entry)` uses the caller's tx (audit + business change commit/rollback together); `recordFailure`/`recordAuthorizationDecision` use an **independent** tx so denial/failure evidence survives a rolled-back business tx |
| No cross-tenant audit reads | ✅ | RLS proven through the app role in DB specs; api-identity cross-tenant checks green |
| Audit query APIs require permissions | ✅ | `query.service.ts` every method calls `authz.require(ctx, AUDIT_PERMISSIONS.*)` (eventView/eventSearch/platformView/eventExport/integrityVerify) |
| Metadata: actor/tenant/subject/correlation/causation | ✅ | `audit_events` columns: `actor_type/actor_id`, `tenant_id/scope_key`, `resource_type/resource_id`, `correlation_id`, `causation_id` (+ request/session/source) |
| Redaction of sensitive values | ✅ | PURE `redaction.ts` masks sensitive keys → `[REDACTED]` before persistence |
| Audit failure fails the business action | ✅ | `write` insert is in the caller's tx — a failed audit insert rolls back the business mutation |
| System context not a universal allow | ✅ | `RbacAuthz` grants a SystemContext permission only if explicitly carried; `withSystem` relaxes rows, not actions |
| No m06 outbox binding yet | ✅ | `OUTBOX` still `{ useClass: RecordingOutbox }` (m06 stand-in); m06 unbuilt |

---

## 5. Security verification

- **Tenant isolation:** every audit table RLS FORCE; all reads through `withTenant`/app role; PLATFORM rows only under `app.system_context='on'`.
- **Tamper-evidence:** two independent append-only layers (triggers binding all roles + INSERT/SELECT-only grants) and a per-scope SHA-256 hash chain verified by `verifyChain`.
- **Authorization:** default-deny; permissions resolved server-side (m02 `PermissionResolver`); audit query/export/integrity endpoints each gated by an `audit.*` permission.
- **Evidence durability:** failed/denied actions recorded in an independent transaction, so a rolled-back business tx still leaves the security record.
- **No data leakage:** structured detail/snapshots redacted before persistence; audit payloads classified.
- **Fail-closed:** an audit insert failure inside a business tx fails that business action.

---

## 6. Known limitations (honest — deferred by ADR-029/030/031 and the completion report)

1. **Monthly range partitioning** of `audit_events` — deferred (single table in MVP).
2. **DB-backed `audit_code_registry` table** — deferred; the YAML registry (`manifests/audit-code-registry.yaml`) remains authoritative.
3. **`chain_anchors` external anchoring** (periodic notarization of chain heads) — deferred.
4. **Retention-enforcement worker** — `audit_retention_policy` / `audit_legal_hold` model exists; automated enforcement is deferred.
5. **Operational metrics / health endpoints** for the audit subsystem — deferred.
6. **Finer platform-actor attribution** — platform-scoped human actions record `system_process` (SystemContext carries no identity); boundary enrichment (actor/ip/user_agent/session/causation on platform events) is a follow-on; the columns exist and populate when present.
7. **Audit-of-audit for plain reads** limited to export + integrity (search/view are not individually audited, to avoid unusable noise).
8. **OUTBOX is still the in-memory `RecordingOutbox` stand-in** — the durable outbox lands with **m06** (not this stage). m03 does not bind OUTBOX.
9. **Local certification on PostgreSQL 15.2** — the authoritative PostgreSQL 16 evidence is CI (PR #9 run 29909503769).

These are documented, intentional deferrals — not defects. They do not affect the correctness of the append-only,
tamper-evident, tenant-isolated audit spine that ships in this stage.

---

## 7. Certification verdict

✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS.** Stage 2.1 (`m03-audit`) is merged to `main` (`587a3ce`, PR #9), the
merged tree is byte-identical to the reviewed head `f6dd8e9`, the authoritative CI Smoke and DB (PostgreSQL 16)
lanes passed on that head, and all local gates — format, lint (0 errors), build, smoke (1256 assertions),
conformance (421), migrations (10), and DB specs (356 assertions, including append-only, hash-chain, RLS, and
security-negative paths) — pass on the certified baseline `587a3ce` under the non-superuser app role. Architecture
and security claims are verified against the merged code. No functional defect was found. The verdict is
"with documented limitations" solely because of the intentional, ADR-recorded deferrals in §6.

**Scope of this certification:** documentation only. The certification PR must **not** be merged, and no m06 or
later-stage work is authorized by this document.
