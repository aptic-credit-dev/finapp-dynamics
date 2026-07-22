# Stage 2.1 — M03 Enterprise Audit Foundation (m03-audit) — Completion Report

## STATUS: IMPLEMENTED ON A FEATURE BRANCH, REBASED ONTO CERTIFIED MAIN — smoke + DB green locally — PR pending, NOT CI-certified, NOT merged (originally 2026-07-19; rebased 2026-07-22)

## 1. Baseline status (honest)

| Fact | Value |
|---|---|
| This branch | `feature/stage-2-1-m03-audit` |
| Originally created from | `feature/stage-1d-rbac-authorization` (`cb7e5d8`) — the then-unmerged Stage 1D implementation branch |
| Rebased onto | `main` `56b7d3ea9cba42a81685fb6aefa1735fe8d314b3` — **certified Stage 1D** (implemented via PR #7 squash `beea0d9`, certified via PR #8 `56b7d3e`). Contains Stage 1D; m03 is added by this branch. |
| Stage 1D status | **Merged and certified** on main. Smoke + DB (PostgreSQL 16) lanes passed on PR #7 head `4669cca`; certification merged via PR #8. |
| m03 before this stage | `packages/m03-audit/README.md` only — a placeholder, no code. |

This branch was **originally stacked** on unmerged Stage 1D and has been **rebased onto certified main**, so it now depends only on merged, certified Stage 1D code (persistent RBAC / `RbacAuthz`, which the audit query API enforces against). m03 itself is still **not CI-certified and not merged** — that awaits its own PR CI going green.

## 2. Branch and commits

`feature/stage-2-1-m03-audit`, focused Conventional Commits (see git log). No push, no PR, no merge.

## 3. Implementation summary

The single authoritative, persistent, tenant-aware, tamper-evident audit spine (ADR-029..031), replacing the in-memory `RecordingAudit` stand-in in production. It keeps the unchanged kernel `AUDIT` port (`write(tx, ctx, entry)`) so every existing call site now records into the durable spine inside its own transaction, and adds explicit failure/denial recording, redaction, hash-chaining, and an authorized investigation API.

## 4. Architecture

- **Port-preserving:** `AuditService implements Audit`. All ~30 existing `audit.write(tx, ctx, …)` call sites are untouched; they now persist.
- **Scope from the session, actor from the context:** the audit row's tenant/platform scope is read from the transaction's GUCs (what RLS actually checks), so a service may legitimately write a system-actor event inside a tenant transaction (e.g. an SoD conflict during a grant) — recorded correctly as a tenant event with a system actor. The acting principal comes from the trusted `RequestContext`/`SystemContext`, never a client claim.
- **Three recording modes** (ADR-031): transactional `write` (success, same tx as the change); independent `recordFailure`/`recordAuthorizationDecision`/`recordSuccess` (own tx, survives a rolled-back business tx).
- **Tamper-evidence** (ADR-030): per-scope sha-256 hash chain, gap-free `seq` under a per-scope advisory lock; `verifyChain` detects any edit/deletion/reorder.
- **Read side:** `AuditQueryService` enforces `audit.*` permissions (service-level, like every module); tenant reads are RLS-bounded; platform reads need the separate `audit.platform.view`.

## 5. Database objects (migrations `0001_audit.sql`, `0002_grant_application_role.sql`)

- **`audit_events`** — the append-only spine. Mixed scope (tenant + PLATFORM), RLS FORCE + `tenant_isolation`; append-only enforced by (a) INSERT+SELECT-only grants and (b) `BEFORE UPDATE/DELETE/TRUNCATE` triggers that reject for every role including superuser; hash-chain columns (`seq`, `previous_event_hash`, `event_hash`, `integrity_version`); investigation indexes on tenant+time, actor, resource, action, module, outcome, correlation, and a global time index; rich columns (actor/impersonator, module/action/category, outcome/reason, before/after snapshots, changed_fields, request/correlation/causation/session, source system/ip/user_agent, occurred_at/recorded_at).
- **`audit_retention_policy`** — the retention policy model (platform default seeded ~7 years; per-tenant/per-category overrides; a `min_retain_days` floor).
- **`audit_legal_hold`** — legal/regulatory holds suspending retention deletion.

## 6. API surface (`/api/v1/audit`)

`GET /audit/events` (tenant search), `GET /audit/events/:id`, `GET /audit/platform/events` (platform-scoped, separate grant), `POST /audit/exports` (audited export), `POST /audit/integrity/verify` (audited chain verification). Pagination bounded (≤200), stable ordering (occurred_at desc, seq desc), tenant isolation by RLS, export permission separate from view.

## 7. Permission changes

Namespace `audit.*` registered (owner m03-audit, 7 codes): `event.view/search/export`, `platform.view`, `retention.manage`, `integrity.verify`, `configuration.manage`. **`audit.platform.view` is deliberately separate** so a tenant administrator never reads platform-wide events. No wildcards. Granted through m02-rbac roles.

## 8. Audit integrations completed

`AUDIT` bound to the persistent `AuditService` in `platform.module` (the same singleton also exposed as `AuditService` for the query module's export/integrity recording). Every existing module (m01 tenant, m02 identity/auth/rbac) now writes durable audit through the unchanged port — verified by the whole DB lane passing against the real spine. `RecordingAudit` remains only as a test double. 8 `AUDIT_` codes registered (the audit service's own controlled actions — export, integrity, retention, legal-hold; the watchers are watched); `registered_code_count` 63 → 71.

## 9. Security controls

Append-only (grants + triggers, superuser-proof); default tenant isolation with platform events separated; actor/scope from trusted context+session (no client spoof channel); server-only timestamps; recursive redaction of secrets, string truncation, payload ceiling, binary rejection; failure/denial recording in an independent transaction (no silent loss); export and integrity verification themselves audited.

## 10. Integrity design

Per-scope hash chain (tenant chains + a PLATFORM chain), `event_hash = sha256(version ‖ prev ‖ canonical(fields))`, contiguous `seq` under an advisory lock, `verifyChain` returning the first break. **Honest claim: tamper-EVIDENCE, not non-repudiation** — external chain-head anchoring (`chain_anchors`) is a documented follow-on.

## 11. Retention design

Policy model shipped (`audit_retention_policy` + `audit_legal_hold`) with a platform minimum floor; **the retention-enforcement worker is a documented deferral** (ADR-031). No unrestricted user deletion exists — deletion is impossible through ordinary paths by construction.

## 12. Testing results (local)

- **Smoke:** 10 suites, **1256 assertions**, 0 failures — incl. the new `m03-audit` pure suite (vocabularies, redaction incl. secrets/oversize/binary/cyclic, hash-chain verify + tamper + gap detection).
- **DB (PostgreSQL 15.2 throwaway):** 10 specs, **356 assertions**, 0 failures — incl. the new `m03-audit` DB spec (persistence, actor-from-context, tenant isolation, platform separation, redaction-before-storage, failure/denial recording, chain verification, and append-only rejection of UPDATE/DELETE **even for a superuser**). The entire pre-existing DB lane passes against the real persistent spine (proving the audit swap did not break any module).
- **Lint:** 0 errors (6 pre-existing style warnings).

CI has **not** run (branch not pushed; the required DB lane runs on PostgreSQL 16).

## 13. Known limitations

- Depends on Stage 1D (persistent RBAC), now **merged and certified** on main; this branch is rebased onto that certified baseline.
- Finer platform-actor attribution: platform-scoped human actions record `system_process` (SystemContext carries no identity) — boundary enrichment to carry actor/ip/user_agent/session/causation is a follow-on; the columns exist and are populated when present.
- Audit-of-audit for plain reads is limited to export + integrity (search/view are not individually audited, to avoid unusable noise) — matches "define which decisions are always audited vs summarised".

## 14. Deferred work (documented)

Monthly range partitioning; DB-backed `audit_code_registry` table (YAML remains authoritative); `chain_anchors` external anchoring; retention-enforcement worker; operational-metrics/health endpoints; some negative tests reachable only by privileged bypass.

## 15. CI status

**Pending.** Rebased onto certified main and pushed; PR to be opened. GitHub Actions runs on the PR.

## 16. Merge status

**Not merged.** Stage 1D is merged/certified; m03 must not merge until its own PR CI (Smoke + PostgreSQL 16 DB) is green and it is approved.

## 17. Certification status

**Not certified.** Manifest records `certification_2_1: implemented_on_feature_branch / ci_certification: pending / not_merged`.
