# Stage 5 — M28 Executive AI / Executive Copilot — Certification

**Module:** `m28-executive-ai` · **Verdict:** **CERTIFIED ON BRANCH** · **Date:** 2026-08-08.
**ADRs:** ADR-111 (read-only/cited/masked + GAP-4), ADR-112 (M24 gateway + M32 deferral).

## A. Merge & baseline

| Item | Value |
|------|-------|
| Governance PR | #67 — merged → `main` `dceb5665b452b0bab10d24d5c109020ad3794b2c` |
| Implementation PR | #68 — closed, merged, merged_at `2026-08-08T10:25:17Z` |
| Reviewed implementation head | `891fe66517c0326898bde585df72d2ee6fa0aa9d` |
| Implementation merge SHA | `47c4b79fa50ffd570730d4a174ecaa917cfd0142` (single parent `dceb566` = squash) |
| Tree equivalence | `git diff 891fe66 47c4b79` = **EMPTY** (byte-identical) |
| Current `main` / certification baseline | `47c4b79fa50ffd570730d4a174ecaa917cfd0142` |
| Certification branch | `cert/stage-5-m28-executive-ai` (from `47c4b79`) |
| Implementation CI (reviewed head `891fe66`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |

## B. Scope confirmed (authoritative sources)

module `m28-executive-ai` · capability Executive Copilot · Stage 5 · mvp:partial · API `/api/v1/copilot` · 7
`ai.copilot.*` permissions (4 privileged) · audit prefix `AI_` (9 `AI_COPILOT_*` codes) · **no** m28 event family (reuses
M24 `ai.request_lifecycle`/`ai.output_lifecycle`/`ai.governance_lifecycle`) · **M32 deferred** behind a read-only port ·
hard rules **read_only, cited, rls_masking**.

## C. Local certification gates (from clean checkout on baseline `47c4b79`, PostgreSQL 15.2 throwaway)

| Gate | Result |
|------|--------|
| generated-output cleanup (`tsc --build --clean`) | done |
| format:check | pass |
| lint | **0 errors** (68 pre-existing baseline warnings; m28 adds none) |
| build | pass |
| smoke lane | 33 suites, **5824** assertions, 0 failures (m28 83 · conformance **3147**) |
| migration ordering + checksums (dry-run) | pass (m28 ordered after m27; checksums `73bdeabf73fe`, `6bfffadf0792`) |
| fresh migration replay | 54 migrations applied |
| DB/API lane | 69 specs, **2167** assertions, 0 failures |
| — `m28-executive-ai` DB spec | 32 |
| — `m28-services` DB spec | 25 |
| — `api-copilot` HTTP spec | 24 |

## D. Live catalogue evidence (non-owner application role)

7 tables · **7/7 RLS ENABLE · 7/7 FORCE · 7/7 `tenant_isolation`** · 5 composite tenant-safe FKs · **0** unsafe tenant
FKs · **0** DELETE grants · **0** UPDATE on the 3 append-only ledgers · 32 CHECK constraints (incl.
`copilot_query_readonly_ck`, `copilot_config_{readonly,citations,export_review}_ck`, `copilot_response_cited_ck`,
`copilot_citation_{ref,granted}_ck`, confidence `*_conf_ck`) · **0** float columns · **0** secret/credential columns ·
confidence = integer basis points · 54 total migrations (m28 = 2; no historical migration edited) · PostgreSQL 16
compatible.

## E. GAP-4 permission certification (ADR-111)

Shared **`ai.*`** namespace; 7 seeded codes with source/registry parity: `ai.copilot.read`, `ai.copilot.query`,
`ai.copilot.feedback` (unprivileged) · `ai.copilot.export`, `ai.copilot.sensitive`, `ai.copilot.configure`,
`ai.copilot.platform` (**4 privileged**). Every controller endpoint carries an explicit permission (6 mutating via
`@Endpoint`, reads authorized in-service); every service authorizes independently (default deny); a tenant read/query
permission cannot grant platform/sensitive scope (proven by `api-copilot`: forged `x-permissions` header ⇒ 403; platform/
restricted without the privileged code ⇒ 403); no `ai.admin`/`copilot.admin` bypass.

## Verdicts

| Aspect | Verdict |
|--------|---------|
| Read-only enforcement (5 layers) | **PASS** — command/intent gate + injection screen + service authz + no-mutation API + DB CHECK/grants (no grant on any business table) |
| M24 boundary | **PASS** — `CopilotAiGatewayPort` only; opaque ids; no provider/DLP/routing/network/secret; never auto-approves an M24 output |
| M32 boundary | **PASS** — unbuilt; no m32 tables/services/API; read-only `ExecutiveAnalyticsPort` (fixture double + fail-closed `UnavailableAnalyticsPort` ⇒ review_required); no write method |
| RLS / row-entitlement masking | **PASS** — tenant ∧ scope ∧ sensitivity ∧ entitlement intersection; masked evidence dropped; no hidden-count leakage; cross-tenant read ⇒ 404 |
| Citations | **PASS** — completed ⇒ cited (`copilot_response_cited_ck`); granted-only refs; else review_required; no fabricated/inaccessible citation |
| Prompt-injection defence | **PASS** — jailbreak/exfiltration/fabrication/SQL/shell refused; server authz never overridden |
| API | **PASS** — 14 routes (6 mutating copilot-owned-state, 8 reads), **0 business-mutation routes**; 401/403/404/409, idempotency, pagination |
| Audit | **PASS** — 9 `AI_COPILOT_*` codes; registry total **741** (= entries); safe payloads only (no question/answer/secret/content) |
| Events / outbox | **PASS** — no m28 family; reuses 3 M24 families; one m06 outbox; m28 owns none |
| Idempotency / concurrency | **PASS** — replayed key ⇒ same query; conflicting key rejected; optimistic version on every transition; one-winner |
| Tenancy / privacy | **PASS** — no raw question/answer/secret/cross-tenant/privileged/masked-row output |
| Contamination | **CLEAN** — no M24 dup, no M32, no M29, no production provider, no network, no business mutation, no new event family, no second outbox, no historical migration edit, no permission bypass |

## Metrics

migrations 2 (total 54) · tables 7 · FORCE RLS 7 · policies 7 · composite FKs 5 · unsafe tenant FKs 0 · DELETE grants 0 ·
append-only ledgers 3 · governance CHECKs 32 · float 0 · secret 0 · permissions 7 (privileged 4) · audit codes 9
(registry 741) · events reused 3 / new 0 · outboxes 1 · routes 14 (mutating 6, business-mutation 0) · smoke 5824/33 ·
conformance 3147 · DB/API 2167/69 (m28 32 · services 25 · api-copilot 24).

## Documented limitations

- Cross-domain and analytics evidence via **deterministic fixture doubles** (no production integrations). The real
  m19/m12/m13/m14/m09 read adapters and the real **m32** analytics drop in behind their read-only ports unchanged —
  **M32 remains a deferred production dependency**.
- Generation uses M24's **deterministic offline provider double** (no real model, no network).
- MVP surfaces an executive summary/answer panel over the existing dashboards.

## Verdict: **CERTIFIED ON BRANCH**

Evidence-only certification. No runtime code, migration, test or registry was changed on this branch.
