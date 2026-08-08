# Stage 5 — M29 AI Governance & Release — Certification

**Module:** `m29-ai-governance` · **Verdict:** **CERTIFIED ON BRANCH** · **Date:** 2026-08-08.
**ADRs:** ADR-113 (event ownership), ADR-114 (no AI self-approval). **The FINAL Stage-5 AI module — Stage-5 AI (m24…m29) is now complete + certified on branch.**

## A. Merge & baseline

| Item | Value |
|------|-------|
| Governance PR | #70 — merged → `main` `667c7855e92bf129b950a964c7bc4594347d6e11` |
| Implementation PR | #71 — closed, merged, merged_at `2026-08-08T11:30:17Z` |
| Reviewed implementation head | `4841111c6ab231595ccd6dcb595c0392090940e4` |
| Implementation merge SHA | `f00db24fa2c42ca9563f3146c97a9a52c00caad4` (single parent `667c785` = squash) |
| Tree equivalence | `git diff 4841111 f00db24` = **EMPTY** (byte-identical) |
| Current `main` / certification baseline | `f00db24fa2c42ca9563f3146c97a9a52c00caad4` |
| Certification branch | `cert/stage-5-m29-ai-governance` (from `f00db24`) |
| Implementation CI (reviewed head `4841111`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |

## B. Scope confirmed

module `m29-ai-governance` · capability AI Governance & Release · Stage 5 · **mvp:false** · dep **m24** (certified) ·
reference tables 7 · **API roots []** (no REST surface) · permission namespace `ai.*` · audit prefix `AI_` · event family
reused `ai.governance_lifecycle` (m24-owned) · no new event family · no production provider · no runtime-deployment
authority · no autonomous controlled action.

## C. Local certification gates (clean checkout on baseline `f00db24`, PostgreSQL 15.2 throwaway)

| Gate | Result |
|------|--------|
| generated-output cleanup (`tsc --build --clean`) | done |
| format:check | pass |
| lint | **0 errors** (68 pre-existing baseline warnings; m29 adds none) |
| build | pass |
| smoke lane | 34 suites, **5932** assertions, 0 failures (m29 69 · conformance **3186**) |
| migration ordering + checksums (dry-run) | pass (m29 after m28; `0eb3c557e188`, `6623834054b7`) |
| fresh migration replay | 56 migrations applied |
| DB/API lane | 71 specs, **2226** assertions, 0 failures |
| — `m29-ai-governance` DB spec | 33 |
| — `m29-services` DB spec | 26 |

## D. Live catalogue evidence (m29-owned 7 tables, non-owner application role)

7 tables · **7/7 RLS ENABLE · 7/7 FORCE · 7/7 `tenant_isolation`** · 3 composite tenant-safe FKs · **0** unsafe tenant FKs ·
**0** DELETE grants · **0** UPDATE on the 4 append-only ledgers · 26 governance CHECK constraints · **0** float · **0**
secret/credential columns · 3 version columns · 56 total migrations (m29 = 2; no historical migration edited) · PG16
compatible.

## E. No AI self-approval — the load-bearing control (3 layers, PASS)

- **Pure gates:** `evaluateSodGate`/`evaluateReleaseGate`/`evaluateWaiverGate` + `isHumanActor` (null/blank/`system`/`ai`/
  `automation` are never human; proposer ≠ approver), fail closed.
- **Services:** explicit human-actor guard + gate before every approval (default-deny `ai.governance.*`).
- **Database (verified present):** `ai_governance_release_human_ck` (approved/released ⇒ `approved_by` NOT NULL),
  `ai_governance_release_sod_ck` (`approved_by <> proposed_by`), `ai_governance_release_evidence_ck` (non-waiver ⇒
  `evaluation_passed`), `ai_governance_decision.decider` NOT NULL, `ai_governance_policy_human_ck`/`_eval_ck`/
  `_restricted_ck`, `ai_governance_use_case_noaction_ck`.
- Proven by the services DB spec: a self-approval (proposer==approver), an AI/`system` approver and a `null` approver are
  all refused; only an independent human approves; a non-waiver release with no passing evaluation cannot be submitted;
  an absolute control can never be waived; confidence never substitutes for approval.

## L. Event ownership (ADR-113, PASS)

M24 remains the canonical owner of `ai.governance_lifecycle` (declared in `contracts/ai-events.ts`; registered once in
`event-registry.yaml`). M29 is an **authorized emitter** reusing the existing `GovernanceControlUpdated` type on the one
m06 outbox. `git diff 667c785 f00db24 -- packages/contracts manifests/event-registry.yaml` = **EMPTY** — no new family,
no schema fork, no second outbox, one registry entry; conformance green.

## Verdicts

| Aspect | Verdict |
|--------|---------|
| No AI self-approval (3 layers) | **PASS** |
| Maker ≠ checker (SoD) | **PASS** |
| Release governance (no draft→released/assessment→approved jumps; review before approval; reason-required suspend/withdraw; append-only history) | **PASS** |
| Evaluation-evidence (no synthetic pass; failed/absent evaluation blocks approval) | **PASS** |
| Use-case governance (opaque m24 refs; no AI-executed action) | **PASS** |
| Waiver / override (requester≠approver; AI/system can't approve; absolute controls never waivable) | **PASS** |
| Suspend / withdraw / supersede (human-decided; no deployment/provider/runtime action) | **PASS** |
| M24 boundary (opaque refs only; no private-table/provider/credential/DLP) | **PASS** |
| Permissions (3 privileged approve/override/export; registry↔source parity; no ai.admin; default deny) | **PASS** |
| Audit (16 `AI_GOVERNANCE_*`; registry 757; safe payloads only) | **PASS** |
| No REST API (`api_prefixes: []`; 0 routes; 0 controllers) | **PASS** |
| Idempotency / concurrency (replayed proposal ⇒ same release; stale version rejected; one-winner) | **PASS** |
| Tenancy / privacy (FORCE RLS; cross-tenant read denied; no prompt/output/secret in audit/events) | **PASS** |
| Contamination | **CLEAN** |

## Metrics

migrations 2 (total 56) · tables 7 · FORCE RLS 7 · policies 7 · composite FKs 3 · unsafe tenant FKs 0 · DELETE grants 0 ·
append-only ledgers 4 · governance CHECKs 26 · float 0 · secret 0 · new permissions 3 (all privileged) · audit codes 16
(registry 757) · events reused 1 family / new 0 · outboxes 1 · routes 0 · smoke 5932/34 · conformance 3186 · DB/API
2226/71 (m29 33 · services 26).

## Documented limitations

- Governance references M24 assets + evaluation results by **opaque id** and recorded evidence; no live M24
  model-registry read-back and no runtime deployment control (deferred to downstream/runtime integration).
- `mvp:false` — post-MVP governance/release oversight; evaluation inputs are recorded evidence, not an executed harness.

## Verdict: **CERTIFIED ON BRANCH**

Evidence-only certification. No runtime code, migration, test or registry was changed on this branch.
