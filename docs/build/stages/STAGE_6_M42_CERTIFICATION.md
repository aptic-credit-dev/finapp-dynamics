# Stage 6I — M42 Enterprise Integration / Certification / Production Release — Certification Report

**Module:** `m42-certification` · **Substage:** 6I · **Role:** the **final Stage-6 module** and the **Stage-6 closure gate**
**Verdict:** `M42: CERTIFIED ON BRANCH` (evidence-only)
**Date:** 2026-08-16 · **Certifier context:** post-merge certification against repository truth
**Nature:** governance runtime + evidence/closure layer — **records** certification state and **executes nothing**.

This certification is **evidence-only**. It changes exactly two files: this report and the `certification_6_m42`
block in `manifests/implementation-manifest.yaml`. No source, migration, test, contract, API, registry, ADR or
prior certification evidence was modified.

---

## 1. Implementation merge verification (authoritative)

| Fact | Value |
| --- | --- |
| Governance PR | #109 merged → `origin/main` `128faaa` (approved_for_build, 2026-08-15T19:03:56+03:00) |
| Implementation PR | **#110** — `merged=true`, `merged_at=2026-08-16T10:20:39Z` |
| Reviewed implementation head | `e09e011c6e664b90c9e5a1b54051211d956b5445` |
| Squash/merge SHA | `7ba280c5793d3904bad7cf5fd560749e5938d577` |
| Current `origin/main` | `7ba280c` (identical to merge SHA) |
| Tree equivalence | **`git diff e09e011 7ba280c` = EMPTY** (byte-identical squash) |
| M42 on main | present (13 package files + `apps/api/src/certification/`) |
| `implementation_6_m42` | present (1) |
| `certification_6_m42` | **absent before this certification** (0) |
| Post-merge CI on `7ba280c` | **Smoke lane = success · DB lane (PG16) = success** |

No tree divergence, no missing implementation, authoritative CI green → certification proceeded.

## 2. Certification baseline & branch

- Certification branch `cert/stage-6-m42-certification` cut from the exact merged main `7ba280c`.
- Certification baseline = `7ba280c`.
- Contamination diff `git diff 7ba280c HEAD` = **EMPTY** at the point of measurement (only the two evidence files are added by the certification commit).

## 3. Fresh-database certification (full replay)

Replayed the entire schema from zero on a throwaway **PostgreSQL 15.2** (local; **authoritative CI = PG16**).

- **Total migrations applied: 82 / 0 failures** (files on disk: 82 → 82 applied, exact).
- **M42 migrations: 2** (`0001_certification.sql`, `0002_grant_application_role.sql`), applied last in dependency order.
- **Checksums (recorded in `schema_migrations`):**
  - `0001_certification.sql` = `07493118c29c375fcac0fa7491a0198775ecf086df16b8930561119d50b02675`
  - `0002_grant_application_role.sql` = `53f3d300053c…`
  - Both match the values recorded at implementation → **migrations unmodified**.
- No historical migration modified (cert branch is byte-identical to merged main).

## 4. PostgreSQL catalogue verification (live, as non-owner `finapp_app`)

Verified directly against the live catalogue; `finapp_app` confirmed **NOBYPASSRLS, non-superuser, NOLOGIN**.

| Property | Result |
| --- | --- |
| `certification_*` tables | **13** |
| Mutable aggregates | **5** (programme, assessment, finding, waiver, readiness) |
| Append-only ledgers | **8** (signoff, decision, condition, evidence, review, history, closure, idempotency) |
| FORCE RLS | **13/13** (0 tables missing FORCE) |
| `tenant_isolation` policy | **13/13** |
| Composite `(tenant_id, id)` PKs | **13/13** |
| Composite FKs | **12** |
| Unsafe tenant FKs | **0** |
| DELETE grants (finapp_app) | **0** |
| UPDATE grants | **exactly the 5 mutable aggregates** — **0 UPDATE on the 8 append-only ledgers** |
| CHECK constraints | **32** |
| version/CAS columns | **5** (the 5 mutable aggregates) |
| float/double/real columns | **0** |
| Immutability triggers | **2** — `certification_decision_immutable_trg`, `certification_closure_immutable_trg` |
| M42-owned outbox tables | **0** |
| Repo-wide outbox tables | **1** — `workflow_event_outbox` (the single M06 outbox) |
| Suspect secret-value columns | **0** |

## 5. Stage-6 assessment matrix

- **12 domains** = `m30…m41` (the Stage-6 platform build) × **8 aspects** (`architecture`, `security`,
  `tenancy_rls`, `sod_maker_checker`, `events_outbox`, `shared_service_boundaries`, `tests_ci`, `data_migration`).
- Each cell references **opaque evidence** (`evidence_ref`); no operational data is copied.
- **Incomplete matrix cannot GO** — proven: an empty programme previews `NO_GO`; a complete pass-matrix alone is
  still `NO_GO` until readiness + sign-offs are satisfied (`m42-services` spec).

## 6. Decision engine (ADR-012, deny-by-default) — load-bearing — **PROVEN**

The verdict is **DERIVED** by `evaluateCertificationDecision`; `issueDecision` accepts no `decision` argument — a
caller can never set GO. Direct test evidence (`m42-services` DB spec):

- incomplete mandatory assessment ⇒ NO_GO · failed assessment ⇒ NO_GO
- unresolved **critical** finding ⇒ NO_GO
- missing mandatory readiness (migration/UAT/pilot/release) ⇒ NO_GO · missing **UAT** ⇒ NO_GO
- missing mandatory sign-off ⇒ NO_GO · any rejected sign-off ⇒ NO_GO
- **expired/invalid waiver** does not satisfy the gate (re-checked at decision time)
- all mandatory controls satisfied ⇒ **GO** (derived)
- bounded approved residual conditions ⇒ **CONDITIONAL_GO**

Stage-7 live-infra hardening is represented honestly as **bounded residual conditions ⇒ CONDITIONAL_GO**, never
fabricated production readiness.

## 7. Independence / maker-checker / AI — **PROVEN**

- Service: `evaluateSodGate` + `isHumanActor` (null/blank/`system`/`ai`/`automation` are not human) on waiver
  approval, decision issuance, closure, and sign-off.
- Database: SoD CHECKs `certification_decision_sod_ck`, `certification_review_sod_ck`, `certification_waiver_sod_ck`.
- Test evidence: requester cannot self-certify; **AI can never certify / issue GO**; waiver cannot be self-approved;
  a domain assessor cannot self-sign the domain they assessed.
- Platform-scope decision issuance additionally requires the control-plane permission `platform_certification.control.administer`.

## 8. Findings & waivers — **PROVEN** (with one documented limitation)

- Critical findings block GO while unresolved; findings preserve append-only history.
- Waivers: bounded scope + specific finding ref + reason + **expiry** + requester≠approver + **human** approver;
  an **absolute** control is **never** waivable; an **expired** waiver stops satisfying the gate.
- **Known limitation examined (not ignored):** an assessment cell may be set to `status='waived'` directly and the
  decision engine treats it as satisfying **without** a per-cell active-waiver linkage (unlike findings, which
  re-verify `waiverActive`). **Verdict: acceptable documented limitation → bounded certification CONDITION, not a
  blocker** — setting a cell `waived` is itself a governed (`assessment.manage`), audited, event-emitting action;
  the GO remains deny-by-default and additionally requires resolved criticals, all mandatory readiness, and all
  independent human sign-offs; no tenancy/immutability/privacy control is weakened. **Follow-up (Stage-7 hardening
  backlog):** require an active linked waiver for a `waived` assessment cell, mirroring the finding path.

## 9. Decision & closure immutability — **PROVEN**

- Issued decision and closure are immutable (BEFORE UPDATE triggers) — no UPDATE/DELETE grant on either ledger.
- A correction is a **new** decision (higher `decision_no`), never an edit.
- **A closed programme is terminal:** `issueDecision` rejects `p.state === 'closed'` (the implementation fix), with
  a dedicated test asserting a closed programme cannot be reopened by a new decision. Verified present in merged
  source and exercised by the passing `m42-services` spec.

## 10. Migration / UAT / pilot / release evidence — records only — **PROVEN**

M42 records readiness as evidence and executes nothing. Source scan finds **no** `child_process`, `execSync`,
`spawn`, `eval(`, `Function(`, dynamic `require(`, `fetch(`, `http.request`, `net.*`, `pg.Pool`, DDL, or migration
runner. `publishMigration`/readiness kinds only emit lifecycle **events** over the M06 outbox. No shell, arbitrary
SQL, dynamic executable loading, or production-provider/network execution exists.

## 11. Stage-6 closure artifact

`certification_closure` carries bounded governance metadata + opaque references only (programme, assessed modules,
implementation/certification refs, decision, conditions summary, findings/sign-offs summary, issued-by, issued
timestamp) and is immutable (trigger + no UPDATE/DELETE grant). No full reports or raw evidence bodies are embedded.

## 12. Tenancy / platform authority — **PROVEN**

- 13/13 FORCE RLS + tenant_isolation; cross-tenant reads are invisible (404/empty), proven by the DB specs and the
  repo-wide `rls-convention` lane.
- A tenant administrator cannot issue platform-wide Stage-6 certification: `openProgramme`, `issueDecision` and
  `closeStage` require `platform_certification.control.administer` for platform scope — a non-administer principal
  is rejected from opening a platform programme (test evidence).
- Cross-tenant opaque references fail closed (no owning-module private table is read).

## 13. Evidence privacy — **PROVEN**

Live `information_schema` scan across all 13 tables finds **0** secret/credential/token/password/private-key/
ciphertext/plaintext columns. Evidence is opaque references (`evidence_ref` / `sha_ref` / `plan_ref` /
`rollback_ref` / `impl_cert_refs` / `artifact_ref`) and bounded summaries. Audit payloads carry ids/states/
domain-aspect/reason-codes/evidence-refs only — never secret material or raw report bodies.

## 14. Permission / API / audit / event parity — **PROVEN**

- `platform_certification.*`: **12 codes**, source↔registry **12/12**; all 3-segment; **no wildcard**, **no
  `platform_certification.admin`**; privileged = `waiver.approve`, `signoff.approve`, `decision.issue`,
  `control.administer`.
- `CERT_*`: **18 codes**, source↔registry **18/18** (registered count 979). (`CERT_AUDIT_PREFIX` is the prefix
  constant, not a code.)
- **5** `certification.*` event families (programme/migration/uat/pilot/release `_lifecycle`, 10 types).
- Every mutating `/api/v1/platform-certification` route is `@Endpoint`-guarded (**11** routes) with an audit code;
  service authorization is present on every path; reads are in-service guarded.
- **One M06 outbox only** (`workflow_event_outbox`); M42 owns **no** second outbox.

## 15. No duplicate-engine — **PROVEN**

M42 created no second audit / workflow / approval / analytics / release-deployment / scheduler / security / secrets
/ notification / outbox engine. It publishes over the injected M06 outbox port and audits via the M03 audit port;
it assesses M30–M41 by contract (opaque evidence refs; reads no owning-module private table). M42 certifies;
owning modules operate.

## 16. Full Stage-6 contamination check — **CLEAN**

M01–M41 remain untouched (cert branch byte-identical to merged main). No historical migration edits, no Stage-7
implementation, no M43+ work, no production-provider integration, no unapproved egress.

## 17. Local quality gates

- format clean · lint 0 errors (68 baseline warnings; m42 contributes 0) · build clean
- **smoke 47 suites / 7900 / 0-fail** (m42-certification 94, conformance 3927, migrate 26)
- **migrate 82 applied / 0 err** (m42=2; checksums verified)
- **fresh-DB lane 97 specs / 2938 / 0-fail** (m42-certification 35, m42-services 25)
- local PostgreSQL **15.2** throwaway — **authoritative CI = PG16**

## 18. Authoritative PostgreSQL 16 CI

Post-merge CI on the merge commit `7ba280c`: **Smoke lane success + DB lane (PG16) success**. The certification PR
re-runs both lanes; certification is reported only after both conclude.

---

## 19. Formal verdicts

**A. M42 technical certification verdict:** `M42: CERTIFIED ON BRANCH` — the certification/closure engine is
architecturally sound, deny-by-default, independence-enforced, immutable, tenant-isolated, evidence-only, and
duplicates no shared engine; all local gates and authoritative PG16 CI are green. One bounded, documented
limitation (the `waived` assessment cell) is recorded as a Stage-7 hardening follow-up, not a blocker.

**B. Stage-6 programme closure / readiness verdict:**
- **Stage 6: FUNCTIONALLY / ARCHITECTURALLY COMPLETE** — M30–M41 implemented + certified-on-branch; M42, the
  closure gate, certified on branch.
- **Production readiness: `CONDITIONAL_GO` pending Stage-7 live-infrastructure hardening** (penetration test, DR
  drill, load + chaos, real-data migration). These remain deliberately positioned for Stage 7 and are represented
  as explicit, bounded, owned, time-boundable residual conditions — **not** fabricated production readiness.

Successful M42 technical certification does **not** by itself equal unconditional production GO.

---

_This report is evidence-only. Do not merge the certification PR until CI concludes; do not begin Stage 7 before the
certification merge is verified on main._
