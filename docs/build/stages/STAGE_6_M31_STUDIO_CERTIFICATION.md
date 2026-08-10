# Stage 6B — M31 Studio — Certification

**Module:** `m31-studio` · **Verdict:** **CERTIFIED ON BRANCH** · **Date:** 2026-08-10. **Second Stage-6 module certified.**
**ADRs:** ADR-117 (design-time ownership + forms + no arbitrary code), ADR-118 (studio.* namespace + integration deferral + secrets + events + no API).

## A. Merge & baseline

| Item | Value |
|------|-------|
| Governance PR | #76 — merged → `main` `e0acc872e6bef14f2cac06570e64cfb5428ec18e` (m31 `approved_for_build`) |
| Implementation PR | #77 — closed, merged, merged_at `2026-08-10T05:25:55Z` |
| Reviewed implementation head | `542e4e8` |
| Implementation merge SHA | `ffdcbcad0bf94171aec66449e2dd7ae08b703931` (single parent `e0acc87` = squash) |
| Tree equivalence | `git diff 542e4e8 ffdcbca` = **EMPTY** (byte-identical) |
| Current `main` / certification baseline | `ffdcbcad0bf94171aec66449e2dd7ae08b703931` |
| Certification branch | `cert/stage-6-m31-studio` (from `ffdcbca`) |
| Implementation CI (reviewed head `542e4e8`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |

## B. Scope confirmed

module `m31-studio` · Stage 6B · **Workflow/BPM/Forms/Rules Studio** · **mvp:false** · **DESIGN-TIME authoring layer only**
(author/validate/version/review/publish/bind) · **not** a runtime workflow/rules/notification/feature-flag engine · **no REST
API** (`api_prefixes: []`) · `studio.*` permissions · audit prefix `STUDIO_` · event family `studio.lifecycle` (design-time) ·
one m06 outbox · **canonical owner of reusable declarative FORM definitions** · **m33 integration deferred behind a
fail-closed port**.

## C. Local certification gates (clean checkout on baseline `ffdcbca`, PostgreSQL 15.2 throwaway, non-owner `finapp_app`)

| Gate | Result |
|------|--------|
| generated-output cleanup (`tsc --build --clean`) | done |
| format:check | pass |
| lint | **0 errors** (68 pre-existing baseline warnings; m31 adds none) |
| build | pass |
| smoke lane | 36 suites, **6157** assertions, 0 failures (m31-studio 92 · conformance **3274**) |
| migration ordering + checksums (dry-run) | pass (`d88cd72a35c5`, `90f3c5efa2c4`) |
| fresh migration replay | **60** migrations applied (m31 = 2; no historical migration edited) |
| DB/API lane | **75** specs, **2332** assertions, 0 failures |
| — `m31-studio` DB spec | 32 |
| — `m31-services` DB spec | 19 |

Authoritative CI is **PostgreSQL 16**; the local lane ran on PG 15.2 (honest — no PG16 claimed locally). The implementation
PR's PG16 DB lane is the authoritative PG16 evidence.

## D. Database — live catalogue evidence (m31-owned 9 tables, non-owner application role)

9 tables · **9/9 RLS ENABLE · 9/9 FORCE · 9/9 `tenant_isolation`** · **7 composite tenant-safe FKs · 0 unsafe single-column
tenant FKs** · **0 DELETE grants** · 6 append-only ledgers with **0 UPDATE** grants · **21 governance CHECK constraints** ·
3 version columns (the 3 mutable aggregates) · **0 float** · **0 secret-value columns** · **0 submitted-form-data tables** ·
**1 immutability trigger** (`studio_artifact_version_immutable_trg`) · 60 total migrations · PG16 compatible.
reference_tables reconciled **25 → 9** (documented in module-registry + implementation-manifest + completion report — the 25
was the full reference-implementation baseline; this Stage-6B core is the governed design-time layer that BINDS to the
canonical m06/m07 runtime rather than re-shredding it).

## Verdicts

| Aspect | Verdict |
|--------|---------|
| **Design-time vs runtime** — m31 owns authoring/validation/versioning/review/publication/binding metadata + reusable form definitions; m06 owns workflow definitions + runtime; m07 owns rule sets + evaluation | **PASS** |
| **No duplicate engine** — m31 creates NO `workflow_definition`/`workflow_definition_version`/`rule_set`/`rule_set_version`/instance/evaluation table (9 `studio_*` tables only); binds via m06 `DefinitionService` / m07 `RuleSetService` public contracts; no private-table access | **PASS** |
| **Forms ownership (ADR-117)** — canonical owner of reusable DECLARATIVE form definitions (`kind: form`); FORM DEFINITION ≠ BUSINESS RECORD (0 submission tables); m12 questionnaires untouched | **PASS** |
| **No arbitrary code (ADR-117)** — no eval/Function/vm/SQL/shell in executable source (the only `child_process` is the prohibited-pattern DENYLIST); workflow conditions compiled through the m06 sandbox (`compileExpression`); rules via m07 `validateRuleSet`; malicious/unsupported expressions fail closed (smoke-tested) | **PASS** |
| **Maker-checker / SoD** — three layers: pure gates (`evaluatePublishGate`/`evaluateSodGate`/`isHumanActor`), services (authz + version CAS + durable-audit-then-403), DB (`studio_review_sod_ck` decided_by≠requested_by, `studio_review_decider_ck`, `studio_artifact_version_evidence_ck`); self-approval + AI/null/system/automation approval refused; failed validation + stale version + missing binding + unauthorized actor all block publish | **PASS** |
| **Published-version immutability** — `studio_artifact_version_immutable_trg` (a published version cannot be mutated; a new edit is a new draft version) | **PASS** |
| **Workflow binding** — validates, binds via m06 public adapter, stores opaque tuple only, no runtime state, no private-table access; cross-tenant binding refused (composite FK) | **PASS** |
| **Rule binding** — validates via m07, binds via m07 public adapter, stores opaque metadata only, never evaluates rules itself, no duplicate engine | **PASS** |
| **Integration boundary** — m33 UNBUILT; `IntegrationCapabilityCatalogPort` + `UnavailableIntegrationCatalog` (fail closed) + deterministic double; opaque refs only; no connector/network/credential; no m33 implementation | **PASS** |
| **Secret-reference boundary** — 0 secret-value columns; raw secret values rejected in validation; opaque `secretref:` pointers (m30 seam); no secrets in audit/events; no m41 implementation | **PASS** |
| **Permissions** — `studio.*`, 9 codes all 3-segment, 5 privileged (project.manage/publish/archive/binding.manage/control.administer); `studio.control.administer` is control-plane; no `studio.admin`/wildcard; default deny; services authorize independently; request headers create no authority | **PASS** |
| **RBAC vs feature** — m02 authoritative; m31 has no feature-flag engine; a flag can never grant a studio permission RBAC denies | **PASS** |
| **Audit** — 14 `STUDIO_*` codes, registry **782**, source↔registry parity; controlled mutations + publication/review/binding audited; payloads carry ids/keys/kinds/states/reason codes only — no spec/form/secret/business content | **PASS** |
| **Events / outbox** — `studio.lifecycle` registered once (m31-owned, newest family tail), **6 event types**, design-time only, one m06 outbox (m31 owns none), privacy-safe payloads | **PASS** |
| **No REST API** — `api_prefixes: []`; 0 routes; 0 controllers; no `/api/v1/studio` | **PASS** |
| **Idempotency / concurrency** — idempotency ledger unique key; version CAS rejects stale writes; one published version per artifact (partial unique index); audit/event atomic with state change | **PASS** |
| **Tenancy / privacy** — FORCE RLS; cross-tenant reads invisible; cross-tenant binding refused; platform scope requires the control-plane permission; no secrets, no business data, bounded evidence | **PASS** |
| Contamination | **CLEAN** |

## Metrics

migrations 2 (total 60) · tables 9 · FORCE RLS 9 · policies 9 · composite FKs 7 · unsafe tenant FKs 0 · DELETE grants 0 ·
append-only ledgers 6 (0 UPDATE) · governance CHECKs 21 · version columns 3 · float 0 · secret-value columns 0 · submission
tables 0 · immutability triggers 1 · permissions 9 (privileged 5) · audit codes 14 (registry 782) · event families 1
`studio.lifecycle` (6 types) · outboxes 1 (m06) · routes 0 · smoke 6157/36 · conformance 3274 · DB/API 2332/75 (m31-studio 32
· m31-services 19).

## Contamination — CLEAN

Only `packages/m31-studio/*` + the `studio.lifecycle` contracts family + registries/manifests/docs were added on the
implementation branch. No m32–m42 implementation (they remain README placeholders); no m06/m07/m08/m09/m30 private-table
modification; no second workflow/rules/notification/feature-flag/RBAC/audit engine; no second outbox; no secrets manager; no
arbitrary-code runner; no production connector; no external network; no historical migration edited.

## Documented limitations

- `mvp:false`. reference_tables reconciled **25 → 9** — the 25 was the full reference-implementation baseline; this Stage-6B
  core is the governed design-time authoring layer that binds to the canonical m06/m07 runtime (documented, not hidden).
- The real m06/m07 binding adapters (`M06WorkflowDefinitionAdapter`/`M07RuleDefinitionAdapter`) are wired and compile against
  the public `DefinitionService`/`RuleSetService` contracts; the DB specs exercise the pipeline through deterministic offline
  doubles (`FixtureWorkflowDefinitionPort`/`FixtureRuleDefinitionPort`) — the real engines drop in behind the ports unchanged.
- m33-integration is UNBUILT; connector/action capabilities are opaque references resolved behind a fail-closed port.
- No REST surface (`api_prefixes: []`); a Studio UI/HTTP surface is a later naming-governance change (an M04-style console
  orchestrating M31's contracts).

## Report path

`docs/build/stages/STAGE_6_M31_STUDIO_CERTIFICATION.md` (this file); implementation completion report:
`docs/build/stages/STAGE_6_M31_STUDIO_COMPLETION.md`.

## Verdict: **CERTIFIED ON BRANCH**

Evidence-only certification. No runtime code, migration, test, registry or contract was changed on this branch.
