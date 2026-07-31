# Stage 3 — M20 GL Reconciliation — Post-Merge Certification

**Verdict: CERTIFIED ON BRANCH.** The merged implementation of `m20-glrecon` on `main` (`c05a772`, PR #41) has been
re-verified from a clean checkout: every gate is green, the certification branch is byte-identical to the reviewed
head, all governance guarantees hold on a real PostgreSQL, the GL balance invariant + matching are deterministic and
explainable, and the module honours its GL-reconciliation boundary (it never posts a journal, writes to the GL, or
approves anything). This record + the manifest update are the only changes on the certification branch (evidence
only — no feature work). The certification PR is open and **not merged**.

## 1. Identity

| Fact | Value |
| --- | --- |
| Implementation PR | **#41** |
| Reviewed implementation head | `862d6e3caecaf7b4d881bbf4712e3035968b4bad` |
| Implementation merge SHA (squash) | `c05a7722a9262cbf111320a7be31802e05c43204` |
| Certified baseline SHA (main tested) | `c05a7722a9262cbf111320a7be31802e05c43204` |
| Current `origin/main` | `c05a7722a9262cbf111320a7be31802e05c43204` (= the merge commit) |
| Certification branch | `cert/stage-3-m20-gl-reconciliation` (cut from merged main) |
| Parent governance SHA (pre-merge main) | `6cf749bf4c798e4863d564693e04dfcdcacce2d5` (governance PR #40) |
| PR #41 | `state: closed`, `merged: true`, `merged_at: 2026-07-31T11:19:46Z`, base `main` |
| Dependencies | m01/m02/m03/m06/m15a/m19; all certified |

## 2. Tree equivalence

`git diff 862d6e3 c05a772` → **EMPTY** (0 lines). PR #41 was squash-merged; the certified tree is byte-identical to
the reviewed head. The certification branch is cut from the merge SHA; its only diff vs the merge is this report + the
manifest record.

## 3. Local gate results (baseline `c05a772`, clean checkout)

| Gate | Result |
| --- | --- |
| Build / typecheck (wiped `dist`) | ✅ `tsc --build` **exit 0** |
| Format check | ✅ `prettier --check .` clean |
| Lint | ✅ `eslint` **0 errors** (64 style warnings) |
| PURE smoke | ✅ **24 suites, 4619 assertions, 0 failures** (m20-glrecon balance engine + determinism 54) |
| Conformance | ✅ **2551 assertions** (endpoint perms/audit vs registries, RLS convention, `registered_code_count` = 585, `glrecon.lifecycle` family registration) |
| Migration replay (fresh) | ✅ **36 applied, 0 already-applied** (from an empty database) |
| DB integration + API specs | ✅ **49 specs, 1587 assertions, 0 failures** (m20-glrecon.db-spec 48, m20-services.db-spec 31, api-gl-reconciliation.db-spec 14) |

Local environment: PostgreSQL **15.2** throwaway; the authoritative PostgreSQL **16** CI is verified on the
implementation PR (§9) and re-run on the certification PR.

## 4. Database certification (live checks on the fresh certified schema)

**24** gl_ tables verified: RLS **ENABLE + FORCE** + a `tenant_isolation` policy (24/24), composite `(tenant_id, id)`
primary keys. **27** composite foreign keys, **0** single-column FKs. **0 DELETE grants** for the app role; the **10**
append-only ledgers (ruleset/status/certification history, import errors, run balances, match line, match candidate,
manual decision, run summary, note) have **0 UPDATE grant**. **0** gl_ columns use a binary float; **26** money
columns are `bigint` minor units. The **GL balance invariant** is DB-enforced by **2** CHECK constraints
(`gl_balance_invariant_ck`, `gl_run_balance_invariant_ck` — calculated closing = opening + debits − credits); the
**draft-only** guarantee by `gl_journal_recommendation_draft_ck` (`is_draft = true`); the certification **override**
gate by `gl_certification_override_ck` (override ⇒ reason). Per-account `gl_import_dedup` (duplicate protection),
`gl_ruleset_one_active`, `gl_match_idem` and `gl_import_idem` (idempotency) indexes present; direction / match-type /
confidence-band / score / exception-type / status CHECKs enforced. **35** permissions seeded (**11** privileged).
Exactly **one** outbox (`workflow_event_outbox`) — **m20 owns no outbox**.

## 5. Domain certification (deterministic + explainable)

Verified against the built module and the services spec: **same inputs + same ruleset version = identical output**.
The GL **balance invariant** is reproducible (`reconcileBalance` twice returns a byte-identical result; calculated
closing = opening + debits − credits; exact integer variance + a stable reason code). **Line matching** (reused from
m15a) is reproducible — identical score, confidence band and reason codes; `bestCandidate` is a deterministic
tie-break. Grouped/split matches balance exactly in minor units (`balances([10000],[6000,4000])` true; unbalanced
false). Imports, runs, grouped reconciliation, exceptions, balance certification and draft recommendations were
driven end-to-end in `m20-services.db-spec` with stable, explainable evidence recorded as append-only rows.

## 6. Security & tenancy

Default-deny: every mutation `authz.require`s its three-segment `gl_reconciliation.*` permission; over HTTP an
anonymous caller is 401, an unprivileged caller with a forged `x-permissions` header is 403, a cross-tenant GET is
404. **35** permissions (**11** privileged — account manage/deactivate, ruleset manage/publish, run reopen, manual
match, unmatch, exception waive, **certification override**, analytics export, platform administer); certifying over
open blockers additionally requires the privileged override permission + a non-empty reason (DB-enforced). Cross-
tenant reads/lists/actions are denied through the non-owner `finapp_app` role bound by FORCE RLS. Enforcement lives
server-side in the services (not only controllers).

## 7. Audit & events

**37** `GLRECON_` audit codes (all ≥ 3 segments) written through the m03 AUDIT port in the business transaction;
`registered_code_count` = **585** = len(codes). One event family `glrecon.lifecycle` (**33** types, v1) published on
the **single m06 outbox** (ordering key = aggregate id `recordId`; consumers dedupe on `eventId`);
`DOMAIN_EVENT_FAMILIES` = **18**. State change + audit + event publication commit atomically. The services spec
proves audit/event payloads carry no GL account numbers, no raw source narratives and no float.

## 8. API certification

The `/api/v1/gl-reconciliation` surface — **30** mutating routes (each `@Endpoint` permission + GLRECON_ audit code)
+ **31** read routes — was exercised by booting the REAL AppModule over HTTP: register a GL account → create + publish
a ruleset → import GL (with the balance invariant) + source lines → create a run → execute deterministic matching +
balance → read the auto-proposed match + confirm it → create a DRAFT journal recommendation; money reads back as
strings; plus 401/403 + cross-tenant 404 + optimistic-concurrency + import idempotency.

## 9. Boundary certification

M20 owns **only** GL reconciliation. It owns **none** of: chart of accounts (M19), bank reconciliation (M15),
journals/postings (M21), approvals (M22), integration (M23), payments, receivables, payables, cash management, or AI
(M27). Line matching **reuses** `@finapp/m15a-matching` (no duplicated algorithm — ADR-087). Every real SQL table
reference is `gl_*`; m19 is referenced by opaque id. **m20 never posts a journal, writes to the general ledger, or
approves anything**: `gl_journal_recommendation.is_draft` is DB-pinned true, and there is no posting/approval surface.

## 10. Repository-derived counts

| Item | Count |
| --- | --- |
| Migrations (m20 / replayed) | **2** / **36** |
| Tables | **24** |
| FORCE RLS tables | **24** |
| Append-only ledgers | **10** |
| Composite FKs (single-column) | **27** (**0**) |
| Float columns | **0** (bigint minor units: **26**) |
| Permissions (privileged) | **35** (**11**) |
| Audit codes (m20) | **37** |
| Registered audit codes (total) | **585** |
| Event types (`glrecon.lifecycle`) | **33** |
| Event families | **18** |
| Mutating routes / read routes | **30** / **31** |
| ADRs | **6** (ADR-085…090) |
| Smoke suites / assertions | **24** / **4619** |
| Conformance assertions | **2551** |
| DB + API specs / assertions | **49** / **1587** |

## 11. Authoritative CI (PostgreSQL 16)

Implementation PR #41 (head `862d6e3`, merge `c05a772`): **Smoke lane ✅ success** + **DB lane (PostgreSQL 16) ✅
success** on the full head SHA. The certification PR re-runs both lanes on the certification head — recorded green
before this record is considered final.

## 12. Contamination verdict — CLEAN

Only `m20-glrecon` (+ its API wiring, registries, contracts family, tests, docs) is present. No chart-of-accounts /
bank-recon / journal / posting / approval / integration / payments / AR/AP / cash / AI implementation; every SQL
table reference is `gl_*`; line matching reuses m15a (no second matching engine); no historical migration edited; no
duplicated shared service; no second outbox; m20 posts nothing. On the certification branch the only changes are this
report + the manifest certification record.

## Verdict

**CERTIFIED ON BRANCH.** All gates green from a clean checkout of merged `main`; tree byte-identical to the reviewed
head; database, balance-invariant + matching determinism, security, tenancy, audit, event, API, boundary and
contamination checks all pass. The certification PR is open and **not merged**.
