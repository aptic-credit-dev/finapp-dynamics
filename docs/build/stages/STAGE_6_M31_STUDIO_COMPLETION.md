# Stage 6B — M31 Studio — Implementation Completion

**Module:** `m31-studio` · **Status:** IMPLEMENTED (branch `feature/stage-6-m31-studio`) · **Date:** 2026-08-08.
**ADRs:** ADR-117 (design-time ownership + forms + no arbitrary code), ADR-118 (studio.* namespace + integration
deferral + secrets + events + no API).

## A. Baseline

| Item | Value |
|------|-------|
| Governance PR | #76 — merged → `main` `e0acc87` (m31-studio `status: approved_for_build`) |
| Implementation baseline | `e0acc87` (current origin/main; M30 certification present) |
| Implementation branch | `feature/stage-6-m31-studio` |

## B. What M31 is (and is NOT)

M31 is the **DESIGN-TIME authoring Studio** for Workflow/BPM, Rules and reusable Forms — author → validate → version →
review → **publish** → bind. **It is NOT a second runtime engine.** The canonical engines are unchanged: **m06** owns
`workflow_definition/_version` + execution, **m07** owns `rule_set/_version` + evaluation, **m08** notifications, **m30**
config/feature-flags/secret-reference seam, **m06** the ONE outbox, **m02** RBAC, **m03** audit. A validated + approved
workflow/rule design is **compiled to the canonical engine through a port** (`M06WorkflowDefinitionAdapter` wrapping
`DefinitionService`, `M07RuleDefinitionAdapter` wrapping `RuleSetService`) and M31 stores only the **opaque binding tuple**
`(definitionId, versionId, versionNo, code, contentHash)` — no duplicate table, no engine, no runtime state. M31 is the
**canonical owner of reusable declarative FORM definitions** (`kind: form`) — FORM DEFINITION ≠ BUSINESS RECORD (no
submitted form data is stored).

## C. Governance gaps — resolved

| Gap | Resolution |
|-----|-----------|
| **M31-1 Studio ownership** | ADR-117 + SHARED_SERVICE_OWNERSHIP: design-time only; binds to m06/m07; no duplicate engine/table |
| **M31-2 Forms** | ADR-117 + SHARED_SERVICE_OWNERSHIP: m31 canonical owner of reusable declarative form definitions; m12 questionnaires stay m12; no submitted-data table |
| **M31-3 Permissions** | ADR-118: `studio.*` (9 codes, 5 privileged, all 3-segment); `studio.control.administer` control-plane; no `studio.admin`/wildcard; publish/archive/bind privileged |
| **M31-4 No arbitrary code** | declarative metadata only; reuses m06 `compileExpression` sandbox + m07 structured `validateRuleSet`; a deep scan rejects eval/Function/require/SQL/shell/template; fail closed |
| **M31-5 Integration** | m33 UNBUILT → `IntegrationCapabilityCatalogPort` with `UnavailableIntegrationCatalog` (fail closed) + deterministic double; opaque capability refs only |
| **M31-6 Secrets** | secret-bearing design values are opaque `secretref:` pointers (m30 seam); a raw secret value fails validation; 0 secret-value columns |

## D. Publishing is a controlled action (maker-checker / SoD)

Enforced in **three layers**: the pure gates (`evaluatePublishGate`/`evaluateSodGate`/`isHumanActor` — passing
validation + a HUMAN approver who is NOT the requester + a valid binding; a null/`system`/`ai`/`automation` actor is
never human, fail closed); the service (authz + fail-closed capability check + version CAS + a durable-audit-then-403
refusal); and the **database** (`studio_review_sod_ck`: `decided_by <> requested_by`; `studio_review_decider_ck`: an
approved/rejected decision needs a decider; `studio_artifact_version_evidence_ck`: no published/validated state without a
passing validation; the `studio_artifact_version_immutable` trigger: a published version can never be mutated). **AI
never approves.**

## E. Local gates (clean build; PostgreSQL 15.2 throwaway, non-owner `finapp_app` role)

| Gate | Result |
|------|--------|
| format:check | pass |
| lint | **0 errors** (68 baseline warnings; m31 adds none) |
| build | pass |
| smoke lane | 36 suites, **6157** assertions, 0 failures (m31-studio 92 · conformance **3274**) |
| migration replay | 60 migrations applied (m31 = 2; no historical migration edited) |
| DB/API lane | 75 specs, **2332** assertions, 0 failures (m31-studio 32 · m31-services 19; all api-* green) |

Note: authoritative CI is **PostgreSQL 16**; the local lane ran on PG 15.2 (honest — no PG16 claimed locally).

## F. Database — live catalogue evidence (9 studio_* tables, non-owner role)

9 tables · **9/9 RLS ENABLE + FORCE + tenant_isolation** · **7 composite tenant-safe FKs · 0 unsafe single-column FKs** ·
**0 DELETE grants** · 6 append-only ledgers (INSERT+SELECT only) · **21 governance CHECK constraints** · 3 version columns
(the 3 mutable aggregates) · **0 float** · **0 secret-value columns** · **0 submitted-form-data tables** · 1 immutability
trigger (published version frozen) · **1 outbox (m06 — m31 owns none)** · 9 `studio.*` permissions (5 privileged, all
3-segment) · 14 `STUDIO_` audit codes · `studio.lifecycle` (6 event types) · **0 REST routes** (`api_prefixes: []`).

## G. Reconciliation (honest)

`module-registry` lists `reference_tables: 25` for m31 (the full reference-implementation baseline). The governed Stage-6B
core implements **9 tables** (project, artifact, artifact_version, dependency, validation_result, review, binding,
artifact_history, idempotency) — a design-time authoring layer that BINDS to the canonical m06/m07 runtime rather than
re-shredding it. Recorded in module-registry + implementation-manifest (not hidden).

## H. Contamination

**CLEAN.** Only `packages/m31-studio/*` + the `studio.lifecycle` contracts family + registries/manifests/docs changed.
No m32–m42 implementation (they remain README placeholders); no m06/m07/m08/m09/m30 private-table modification; no second
engine/outbox/RBAC/audit/feature-flag/secrets-manager; no historical migration edited; no production connector; no network.

## I. Known limitations

- `mvp:false`. Reference tables reconciled 25 → 9 (documented).
- The real m06/m07 binding adapters are wired but exercised in tests through deterministic offline doubles
  (`FixtureWorkflowDefinitionPort`/`FixtureRuleDefinitionPort`); the real engines drop in behind the ports unchanged.
- m33-integration is UNBUILT; connector/action capabilities are opaque references resolved behind a fail-closed port.
- No REST surface (`api_prefixes: []`); a Studio UI/HTTP surface is a later naming-governance change (an M04-style console
  orchestrating M31's contracts).

## Status: **IMPLEMENTED — pending PostgreSQL 16 CI + post-merge certification**
