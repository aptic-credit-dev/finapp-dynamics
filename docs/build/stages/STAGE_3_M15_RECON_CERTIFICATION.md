# Stage 3 — M15 Bank Reconciliation + Matching Engine — Post-Merge Certification

**Verdict: CERTIFIED ON BRANCH.** The merged implementation of `m15-recon` + `m15a-matching` on `main` (`46880e7`,
PR #38) has been re-verified from a clean checkout: every gate is green, the certification branch is byte-identical
to the reviewed head, all governance guarantees hold on a real PostgreSQL, the matching engine is deterministic +
explainable, and the module honours its reconciliation boundaries. This record + the manifest update are the only
changes on the certification branch (evidence only — no feature work). The certification PR is open and **not
merged**.

## 1. Identity

| Fact | Value |
| --- | --- |
| Implementation PR | **#38** |
| Reviewed implementation head | `640c008f42249aa436b110b0825ab592e14a3db0` |
| Implementation merge SHA (squash) | `46880e71e8365e99c55b101e6a67b9793d460c14` |
| Certified baseline SHA (main tested) | `46880e71e8365e99c55b101e6a67b9793d460c14` |
| Current `origin/main` | `46880e71e8365e99c55b101e6a67b9793d460c14` (= the merge commit) |
| Certification branch | `cert/stage-3-m15-reconciliation-matching` (cut from merged main) |
| Parent governance SHA (pre-merge main) | `f01f9cff73838c9347a90de9f95e71c8c739ec51` (governance PR #37) |
| PR #38 | `state: closed`, `merged: true`, `merged_at: 2026-07-30T11:54:22Z`, base `main` |
| Dependencies | m02/m03/m06/m07/m09/m19 (+ the m15a engine); all certified |

## 2. Tree equivalence

`git diff 640c008 46880e7` → **EMPTY** (0 lines). PR #38 was squash-merged; the certified tree is byte-identical
to the reviewed head. The certification branch is cut from the merge SHA; its only diff vs the merge is this report
+ the manifest record.

## 3. Local gate results (baseline `46880e7`, clean checkout)

| Gate | Result |
| --- | --- |
| Build / typecheck (wiped `dist`) | ✅ `tsc --build` **exit 0** |
| Format check | ✅ `prettier --check .` clean |
| Lint | ✅ `eslint` **0 errors** (63 style warnings) |
| PURE smoke | ✅ **23 suites, 4407 assertions, 0 failures** (m15a-matching engine 43) |
| Conformance | ✅ **2400 assertions** (endpoint perms/audit vs registries, RLS convention, `registered_code_count` = 548, `reconciliation.lifecycle` family registration) |
| Migration replay (fresh) | ✅ **34 applied, 0 already-applied** (from an empty database) |
| DB integration + API specs | ✅ **46 specs, 1494 assertions, 0 failures** (m15-recon.db-spec 36, m15-services.db-spec 37, api-reconciliation.db-spec 11) |

Local environment: PostgreSQL **15.2** throwaway; the authoritative PostgreSQL **16** CI is verified on the
implementation PR (§CI) and re-run on the certification PR.

## 4. Database certification (live checks on the fresh certified schema)

**18** recon tables verified: RLS **ENABLE + FORCE** + a `tenant_isolation` policy (18/18), composite
`(tenant_id, id)` primary keys. **19** composite foreign keys, **0** single-column FKs. **0 DELETE grants** for the
app role; the **8** append-only ledgers (ruleset/status history, match_line, match_candidate, manual_decision,
run_summary, note, import_error) have **0 UPDATE grant**. **0** recon columns use a binary float; **10** money
columns are `bigint` minor units. Per-account statement `recon_statement_import_dedup` (duplicate protection),
`recon_matching_ruleset_one_active` and `recon_match_idem` (idempotency) indexes present. direction / match-type /
confidence-band / score / exception-type / status CHECKs enforced. **29** permissions seeded (**11** privileged).
Exactly **one** outbox (`workflow_event_outbox`) — **m15 owns no outbox**. **m15a-matching owns 0 tables.**

## 5. Matching-engine certification (deterministic + explainable)

Verified against the built engine: **same inputs + same ruleset version = identical output** (`scoreCandidate`
called twice returns a byte-identical result). All five confidence bands map correctly
(`exact`/`strong`/`partial`/`review`/`unmatched`), with `exact` a qualitative determination (zero amount variance +
exact reference + compatible direction). Match cardinality classifies correctly (`one_to_one`/`one_to_many`/
`many_to_one`; split + grouped for manual matches). Split/grouped balancing is exact in minor units
(`balances([10000],[6000,4000])` true; unbalanced false). Every candidate carries stable reason codes, amount +
date variances (minor units), confidence band, rule codes and score — recorded as append-only evidence.

## 6. Security & tenancy

Default-deny: every mutation `authz.require`s its three-segment `reconciliation.*` permission; over HTTP an
anonymous caller is 401, an unprivileged caller with a forged `x-permissions` header is 403, a cross-tenant GET is
404. **29** permissions (**11** privileged — `match.unmatch`, `manual.match`/`manual.group`, `ruleset.publish`/
`ruleset.manage`, `run.reopen`, `exception.waive`, `bank_account.manage`/`deactivate`, `analytics.export`,
`platform.administer`); manual override + unmatch require their privileged permissions; there is no vague
`reconciliation.admin`. Cross-tenant reads/lists/actions are denied through the non-owner `finapp_app` role; FORCE
RLS binds it. Enforcement lives server-side in the services (not only controllers).

## 7. Audit & events

**28** `RECON_` audit codes (all ≥ 3 segments) written through the m03 AUDIT port in the business transaction;
`registered_code_count` = **548** = len(codes). One event family `reconciliation.lifecycle` (**24** types, v1)
published on the **single m06 outbox** (ordering key = aggregate id `recordId`; consumers dedupe on `eventId`);
`DOMAIN_EVENT_FAMILIES` = **17**. State change + audit + event publication commit atomically. The services spec
proves audit/event payloads carry no full account numbers, no raw statement narratives and no float.

## 8. API certification

The `/api/v1/reconciliation` surface — **20** mutating routes (each `@Endpoint` permission + RECON_ audit code) +
**22** read routes — was exercised by booting the REAL AppModule over HTTP: register bank account → create + publish
a ruleset → import statement + ledger lines → create a run → run deterministic matching → read the auto-proposed
match + confirm it; money reads back as strings; plus 401/403 + cross-tenant 404 + optimistic-concurrency + import
idempotency. Validation + conflict handling map through the services.

## 9. Boundary certification

M15 owns **only** bank reconciliation, matching, exceptions, rules, manual review and run summaries. It owns
**none** of: chart of accounts (M19), GL reconciliation (M20), journals/postings (M21), approvals (M22),
integration (M23), payments, receivables, payables, cash management, or AI (M27). Every real SQL table reference is
`recon_*`; m19/m09 are referenced by opaque id; m15a-matching owns 0 tables.

## 10. Repository-derived counts

| Item | Count |
| --- | --- |
| Migrations (m15 / replayed) | **2** / **34** |
| Tables (m15-recon / m15a) | **18** / **0** |
| FORCE RLS tables | **18** |
| Append-only ledgers | **8** |
| Composite FKs (single-column) | **19** (**0**) |
| Float columns | **0** (bigint minor units) |
| Permissions (privileged) | **29** (**11**) |
| Audit codes (m15) | **28** |
| Registered audit codes (total) | **548** |
| Event types (`reconciliation.lifecycle`) | **24** |
| Event families | **17** |
| Mutating routes / read routes | **20** / **22** |
| ADRs | **4** (ADR-081…084) |
| Smoke suites / assertions | **23** / **4407** |
| Conformance assertions | **2400** |
| DB + API specs / assertions | **46** / **1494** |

## 11. Authoritative CI (PostgreSQL 16)

Implementation PR #38 (head `640c008`, merge `46880e7`): **Smoke lane ✅ success** + **DB lane (PostgreSQL 16) ✅
success** on the full head SHA. The certification PR re-runs both lanes on the certification head — recorded green
before this record is considered final.

## 12. Contamination verdict — CLEAN

Only `m15-recon` + `m15a-matching` (+ their API wiring, registries, contracts family, tests, docs) are present. No
chart-of-accounts / GL-recon / journal / posting / approval / integration / payments / AR/AP / cash / AI
implementation; every SQL table reference is `recon_*`; m15a owns 0 tables; no historical migration edited; no
duplicated shared service; no second outbox. On the certification branch the only changes are this report + the
manifest certification record.

## Verdict

**CERTIFIED ON BRANCH.** All gates green from a clean checkout of merged `main`; tree byte-identical to the
reviewed head; database, matching-engine determinism, security, tenancy, audit, event, API, boundary and
contamination checks all pass. The certification PR is open and **not merged**.
