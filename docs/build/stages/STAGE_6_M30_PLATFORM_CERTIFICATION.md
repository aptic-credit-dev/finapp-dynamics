# Stage 6A — M30 Platform Foundation — Certification

**Module:** `m30-platform` · **Verdict:** **CERTIFIED ON BRANCH** · **Date:** 2026-08-08. **First Stage-6 module certified.**
**ADRs:** ADR-115 (GAP-5 ownership + GAP-2 namespace), ADR-116 (secrets seam / events / no API).

## A. Merge & baseline

| Item | Value |
|------|-------|
| Governance PR | #73 — merged → `main` `3fc66fb8dfb5d312cd642ed1c24dd72e9e5d9fc1` |
| Implementation PR | #74 — closed, merged, merged_at `2026-08-08T12:59:22Z` |
| Reviewed implementation head | `98c4331f7cb54792c678e223d5702df310ca9c96` |
| Implementation merge SHA | `2acb1700a8e89f3f9747cb1a7c152eb3dcdbfff8` (single parent `3fc66fb` = squash) |
| Tree equivalence | `git diff 98c4331 2acb170` = **EMPTY** (byte-identical) |
| Current `main` / certification baseline | `2acb1700a8e89f3f9747cb1a7c152eb3dcdbfff8` |
| Certification branch | `cert/stage-6-m30-platform` (from `2acb170`) |
| Implementation CI (reviewed head `98c4331`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |

## B. Scope confirmed

module `m30-platform` · Stage 6A · Platform Foundation · **mvp:false** · canonical owner of metadata + configuration +
feature flags + the secret-reference seam · **no REST API** (`api_prefixes: []`) · `platform.*` permissions · audit
prefix `PLATFORM_` · event family `platform.lifecycle` · one m06 outbox · **m41-security owns real secrets/key
management** · **m04-admin is orchestration/consumer, not a feature-flag engine**.

## C. Local certification gates (clean checkout on baseline `2acb170`, PostgreSQL 15.2 throwaway)

| Gate | Result |
|------|--------|
| generated-output cleanup (`tsc --build --clean`) | done |
| format:check | pass |
| lint | **0 errors** (68 pre-existing baseline warnings; m30 adds none) |
| build | pass |
| smoke lane | 35 suites, **6016** assertions, 0 failures (m30 41 · conformance **3227**) |
| migration ordering + checksums (dry-run) | pass (m30 first Stage-6; `ef93413e3afa`, `74667c981618`) |
| fresh migration replay | 58 migrations applied |
| DB/API lane | 73 specs, **2281** assertions, 0 failures |
| — `m30-platform` DB spec | 32 |
| — `m30-services` DB spec | 23 |

## D. Database — live catalogue evidence (m30-owned 10 tables, non-owner application role)

10 tables · **10/10 RLS ENABLE · 10/10 FORCE · 10/10 `tenant_isolation`** · 3 composite tenant-safe FKs · **0** unsafe
tenant FKs · **0** DELETE grants · **0** UPDATE on the 4 append-only ledgers · 25 governance CHECK constraints · 6 version
columns · **0** float · **0** secret-value columns · 58 total migrations (m30 = 2; no historical migration edited) · PG16
compatible. reference_tables reconciled **26 → 10** (documented in module-registry + completion report — the 26 was the
full reference-implementation baseline; this Stage-6A foundation implements the governed core).

## E. Secret-reference seam (ADR-116) — PASS

**0 secret-VALUE columns.** The only secret-related columns are `platform_config_definition.secret_bearing` (boolean
flag), `platform_config_value.secret_ref` (text — opaque pointer) and `platform_secret_reference.secret_ref` (text —
opaque pointer). Semantic inspection: references/flags, never values. A secret-bearing config value carries a
`secretref:`-shaped reference XOR a plain value (`platform_config_value_secret_ck`, `*_ref_shape_ck`); a malformed
reference / raw secret is rejected (DB CHECK + service). Runtime resolution is behind a fail-closed `SecretResolver` port
(deterministic double only; no network); an unavailable resolver fails closed. No m41 private implementation; **m41
remains the real secrets/key-management owner**.

## Verdicts

| Aspect | Verdict |
|--------|---------|
| **GAP-5 feature ownership** — M30 canonical; m04 has 0 feature tables + unmodified; consumes by contract; no duplicate engine | **PASS** |
| **GAP-2 permissions** — `platform.*`, 9 codes all 3-segment, 6 privileged, `platform.control.administer` control-plane, no `platform.admin`/wildcard, default deny | **PASS** |
| **Secret seam** — 0 secret-value columns; opaque refs; fail-closed resolver; m41 owns real key mgmt | **PASS** |
| Metadata governance — controlled categories (not a tenant/identity mirror), scope, versioning, audit | **PASS** |
| Configuration governance — scope, versioning, history, validation, idempotency, concurrency, secret-bearing = reference | **PASS** |
| Feature governance — definitions/defaults/overrides/evaluation/history/versioning/authz | **PASS** |
| **RBAC-vs-feature** — a flag never grants authority (RBAC DENY + FEATURE ENABLED = DENY) | **PASS** |
| **Absolute-control override** — a tenant override can never weaken a platform-absolute control | **PASS** |
| M04 boundary — orchestration-only; no competing engine | **PASS** |
| M02 / M03 / M06 boundaries — RBAC/audit/outbox canonical; no second engine; one outbox | **PASS** |
| Events — `platform.lifecycle` registered once (m30-owned), 8 event types, privacy-safe payload, one m06 outbox | **PASS** |
| Audit — 11 `PLATFORM_*` codes, registry 768, source↔registry parity, no secret/value content | **PASS** |
| No REST API — `api_prefixes: []`; 0 routes; 0 controllers | **PASS** |
| Idempotency / concurrency | **PASS** |
| Tenancy / platform authority — FORCE RLS; cross-tenant denied; platform-scope requires control-plane permission | **PASS** |
| Privacy / safe data — no secret persistence/leakage; bounded metadata/config | **PASS** |
| Contamination | **CLEAN** |

## Metrics

migrations 2 (total 58) · tables 10 · FORCE RLS 10 · policies 10 · composite FKs 3 · unsafe tenant FKs 0 · DELETE grants
0 · append-only ledgers 4 · governance CHECKs 25 · version columns 6 · float 0 · secret-value columns 0 · permissions 9
(privileged 6) · audit codes 11 (registry 768) · event families 1 `platform.lifecycle` (8 types) · outboxes 1 · routes 0 ·
smoke 6016/35 · conformance 3227 · DB/API 2281/73 (m30 32 · services 23).

## Documented limitations

- `mvp:false`. **reference_tables reconciled 26 → 10** — the 26 was the full reference-implementation baseline; this
  Stage-6A foundation implements the governed core (metadata/config/feature-flags/secret-reference seam), documented in
  module-registry + completion report (not hidden).
- Secret resolution is a fail-closed deterministic port double; the real backend is **m41-security** (Stage 6H), which
  drops in behind the `SecretResolver` port unchanged. M30 stores no secret value.
- No REST surface; administrative HTTP is m04-admin's job (orchestrating over M30's public contracts).

## Verdict: **CERTIFIED ON BRANCH**

Evidence-only certification. No runtime code, migration, test, registry or contract was changed on this branch.
