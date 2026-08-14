# Stage 6D-5 — M37 Integration Governance/QA/Release — Certification

**Module:** `m37-govrelease` · **Verdict:** **CERTIFIED ON BRANCH** · **Date:** 2026-08-14. **Eighth Stage-6 module certified.**
**ADR:** ADR-124 (governs release promotion but executes no release; human/maker-checker approval over a passing QA evidence gate; released-immutable; consumes M33–M36 by opaque contract; signatures are opaque `secretref:` only; `govrelease.*` closes GAP-4; a DISTINCT `GOVRELEASE_` audit prefix — not M33's `INTEGRATION_`; `govrelease_*` prefix).

## A. Merge & baseline

| Item | Value |
|------|-------|
| Governance PR | #94 — merged → `main` `6d28384` (m37 `approved_for_build`) |
| Implementation PR | #95 — closed, merged, merged_at `2026-08-14T05:30:03Z` |
| Reviewed implementation head | `d3d68ca` |
| Implementation merge SHA | `54e10620a2bede13c327cee30218594572f9303e` (single parent `6d28384` = squash) |
| Tree equivalence | `git diff d3d68ca 54e1062` = **EMPTY** (byte-identical) |
| Current `main` / certification baseline | `54e10620a2bede13c327cee30218594572f9303e` |
| Certification branch | `cert/stage-6-m37-govrelease` (from `54e1062`) |
| Implementation CI (reviewed head `d3d68ca`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |
| Implementation CI (merge commit `54e1062`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |

## B. Scope confirmed

module `m37-govrelease` · Stage 6D-5 · **Integration Governance / QA / Release** (governed promotion of an integration
artifact — an M33 connector, an M34 marketplace listing, an M35 API product, an M36 webhook/stream — through QA gates to a
released state, per target environment) · **mvp:false** · **M37 RECORDS + GOVERNS the release decision + QA evidence; it
EXECUTES no release** (the runtime stays with the owning module) · **not a duplicate connector/marketplace/devportal/events
engine, not a secrets manager, no arbitrary code, no runtime deployment** · **`/api/v1/releases`** · `govrelease.*`
permissions · audit prefix **`GOVRELEASE_`** (distinct from M33's `INTEGRATION_`) · event family `govrelease.lifecycle` · one
m06 outbox · consumes M33/M34/M35/M36 through a fail-closed `ArtifactRegistryPort` · uses the **`govrelease_*`** table prefix
(no collision with M23 `integration_*`, M33 `connector_*`, M34 `marketplace_*`, M35 `devportal_*`, M36 `webhook_/eventstream_/
events_`) · **a HARD dependency of m42-certification (6I)** · M41 real secrets deferred behind a fail-closed port.

## C. Local certification gates (clean checkout on baseline `54e1062`, PostgreSQL 15.2 throwaway, non-owner `finapp_app`)

| Gate | Result |
|------|--------|
| generated-output cleanup (`tsc --build --clean`) | done |
| format:check | pass |
| lint | **0 errors** (68 pre-existing baseline warnings; m37 adds none) |
| build | pass |
| smoke lane | 42 suites, **7026** assertions, 0 failures (m37-govrelease 82 · conformance **3597**) |
| migration ordering + checksums (dry-run) | pass (`24d015d78e39`, `8730570011eb`) |
| fresh migration replay | **72** migrations applied (m37 = 2; no historical migration edited) |
| DB/API lane (fresh DB) | **87** specs, **2655** assertions, 0 failures |
| — `m37-govrelease` DB spec | 31 |
| — `m37-services` DB spec | 17 |

Authoritative CI is **PostgreSQL 16**; the local lane ran on PG 15.2 (honest — no PG16 claimed locally). The implementation
PR's PG16 DB lane, the merge commit's PG16 DB lane, and this cert PR's lanes are the authoritative PG16 evidence.

## D. Database — live catalogue evidence (m37-owned 9 govrelease_* tables, non-owner application role)

9 tables · **9/9 RLS ENABLE · 9/9 FORCE · 9/9 `tenant_isolation`** · **5 composite tenant-safe FKs · 0 unsafe single-column
tenant FKs** · **0 DELETE grants** · 5 append-only ledgers (INSERT+SELECT: `govrelease_check`, `_review`, `_evidence`,
`_history`, `_idempotency`) · 4 mutable aggregates (INSERT+SELECT+UPDATE: `govrelease_artifact`, `_environment`, `_release`,
`_gate`) · **22 governance CHECK constraints** · 4 version columns · **0 float** · **0 secret-value columns**
(`govrelease_evidence.signature_ref` is a `text` opaque pointer with a `secretref:` shape CHECK) · **1 released-immutability
trigger** (`govrelease_release`) · **1 outbox (m06 `workflow_event_outbox` — m37 owns none)** · 8 `govrelease.*` permissions
(3 privileged, all 3-segment, no wildcard) · 16 `GOVRELEASE_` audit codes · `govrelease.lifecycle` (6 event types) · **72
total migrations**. reference_tables reconciled **12 → 9** (documented in module-registry + implementation-manifest — the 12
was the full reference-implementation baseline; this Stage-6D-5 core is the governed governance/QA/release layer).

## Verdicts

| Aspect | Verdict |
|--------|---------|
| **Governs, does not execute** — M37 records the governed release DECISION + QA evidence; there is no deployment/runtime execution in source (no eval/`Function`/`vm`/shell/`child_process`/network/`fetch`); the actual release stays with the owning module | **PASS** |
| **QA evidence gate before approval** — a release cannot enter review/released without every REQUIRED gate `passed`/`waived` (`evaluateQaGate`; DB `govrelease_release_evidence_ck`: state in (review_pending, released) ⇒ `qa_passed`); a failed/pending required gate blocks approval (proven in the services DB spec) | **PASS** |
| **Maker-checker / SoD; AI/system/automation cannot approve or release** — promotion to released requires a HUMAN approver ≠ the requester (`evaluateApprovalGate` + `govrelease_review` `decided_by <> requested_by` + `_decider_ck`); the requester cannot self-approve; `ai`/`system`/`automation`/null are refused (`isHumanActor`) | **PASS** |
| **Released immutability / no silent overwrite** — a released record is immutable (trigger; only → rolled_back; key/artifact/environment/version/hash frozen once past draft); one released per artifact/environment (a prior released is superseded → rolled_back, recorded); stale-version writes rejected (optimistic CAS) | **PASS** |
| **Consumes M33/M34/M35/M36 by contract (no duplicate engine)** — an artifact is an OPAQUE `(kind, ref)`; releasability is checked only through the fail-closed `ArtifactRegistryPort` (`ArtifactRegistryAdapter` wraps read-only M33 `getConnector` + M34 `getListing`); m37 source reads NO owning-module table and mutates no source-module state; where an artifact reader is unwired (M35/M36) it fails closed | **PASS** |
| **Audit-prefix separation (G-b)** — M37 declares a DISTINCT `GOVRELEASE_` prefix (16 codes, registered under m37); M33 keeps `INTEGRATION_` (no m37 code carries `INTEGRATION_`); source↔registry parity 16/16, registry **881** | **PASS** |
| **Not a secrets manager (M30 seam / M41 boundary)** — a release signature is an opaque `secretref:` pointer (`govrelease_evidence_sig_shape_ck`; the m30 seam); **0 secret-value columns**; real resolution deferred to M41 behind a fail-closed port | **PASS** |
| **Events / outbox** — `govrelease.lifecycle` registered once (m37-owned, newest tail), 6 event types, privacy-safe payloads (ids/kinds/keys/versions/statuses/reason codes only — never a signature, a QA report body or personal data); one m06 outbox (m37 owns none) | **PASS** |
| **Permissions** — `govrelease.*`, 8 codes all 3-segment, 3 privileged (`release.approve`, `release.execute`, `control.administer`); `release.execute` = authorization of the rollback decision (no runtime deployment); no `govrelease.admin`/wildcard; default deny; a request header/param grants no platform authority (platform scope requires `control.administer`) | **PASS** |
| **Idempotency / concurrency** — `govrelease_idempotency` unique key; version CAS rejects stale writes; idempotent register/request; a simultaneous approval has one winner (CAS) | **PASS** |
| **Tenancy / privacy** — FORCE RLS across artifacts/environments/releases/gates/checks/reviews/evidence; cross-tenant invisible; composite tenant-safe FKs; no secret persistence; bounded evidence; no cross-tenant inference | **PASS** |
| **No REST bypass** — every mutating `/api/v1/releases` route authorizes a `govrelease.*` permission via `@Endpoint` (13 guarded routes across 2 controllers); no route executes a deployment; reads default-deny in-service | **PASS** |
| Contamination | **CLEAN** |

## Metrics

migrations 2 (total 72) · tables 9 · FORCE RLS 9 · policies 9 · composite FKs 5 · unsafe tenant FKs 0 · DELETE grants 0 ·
append-only ledgers 5 · mutable aggregates 4 · governance CHECKs 22 · version columns 4 · float 0 · secret-value columns 0 ·
immutability triggers 1 · permissions 8 (privileged 3) · audit codes 16 (registry 881) · event families 1
`govrelease.lifecycle` (6 types) · outboxes 1 (m06) · routes: `/api/v1/releases` · smoke 7026/42 · conformance 3597 · DB/API
2655/87 (m37-govrelease 31 · m37-services 17).

## Contamination — CLEAN

Only `packages/m37-govrelease/*` + the `govrelease.lifecycle` contracts family + `apps/api/src/releases/*` + registries/
manifests/docs were added on the implementation branch. **m23/m28/m30/m31/m32/m33/m34/m35/m36 source untouched** (M33/M34
consumed by contract, not read/modified; the m06 outbox is consumed by contract, not read — m37 owns no outbox; no
`integration_*`/`connector_*`/`marketplace_*`/`devportal_*`/`webhook_*` collision — m37 uses `govrelease_*`; no reuse of M33's
`INTEGRATION_` audit prefix); no m38+/m41 implementation; no second connector/marketplace/devportal/events/RBAC/audit/outbox/
secrets/scheduler/notification engine; no production network/provider dependency; no arbitrary-code runner; **no runtime
deployment/release execution**; no historical migration edited; no permission/RLS bypass.

## Documented limitations

- `mvp:false`. reference_tables reconciled **12 → 9** — the governed governance/QA/release core.
- The M33/M34 artifact consumption and the M41 secret backend are deterministic offline doubles / fail-closed ports; the real
  owning-module readers and the real M41 drop in behind the ports unchanged. **The M35 (API product) and M36 (webhook/stream)
  artifact readers are not yet wired** — those artifact kinds are checked fail-closed (unavailable) until their readers drop
  in; documented honestly.
- Scheduler/automation/extensions (m38), commercial SaaS (m39) and security/secrets (m41) are deferred (not this module).
  M37 is a HARD dependency of **m42-certification (6I)**, which assesses the governed release trail.

## Report path

`docs/build/stages/STAGE_6_M37_GOVRELEASE_CERTIFICATION.md` (this file); implementation evidence lives in PR #95.

## Verdict: **CERTIFIED ON BRANCH**

Evidence-only certification. No runtime code, migration, test, registry or contract was changed on this branch.
