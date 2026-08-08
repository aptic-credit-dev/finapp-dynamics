# Stage 5 — M28 Executive AI / Executive Copilot — Completion Report

**Module:** `m28-executive-ai` · **Branch:** `feature/stage-5-m28-executive-ai` · **Status:** implemented (on branch).
**Governance:** PR #67 merged to `main` = `dceb5665b452b0bab10d24d5c109020ad3794b2c`. **Baseline:** same SHA.
**ADRs:** ADR-111, ADR-112.

## Metrics (verified on PostgreSQL, non-owner application role)

| Metric | Value |
|--------|-------|
| M28 migrations | 2 (`0001_executive_ai.sql`, `0002_grant_application_role.sql`) |
| Total migrations (repo) | 54 |
| M28 tables | 7 (`copilot_config/session/query/response/citation/feedback/idempotency`) |
| Tables with RLS ENABLE+FORCE | 7 / 7 |
| `tenant_isolation` policies | 7 / 7 |
| Composite FKs (within m28) | 5 · unsafe tenant FKs: **0** |
| DELETE grants | **0** · append-only ledgers (INSERT+SELECT only): **3** |
| Governance CHECK constraints | 32 (incl. read_only / citations / cited / granted-citation) |
| Float columns | **0** · secret/credential columns: **0** |
| Confidence columns | integer basis points, bounded 0..10000 |
| Permissions | 7 `ai.copilot.*` (shared `ai.*` namespace) · privileged: **4** (export/sensitive/configure/platform) |
| Audit codes | 9 `AI_COPILOT_*` (shared `AI_` prefix) · registered total 732 → **741** |
| Events reused | 3 M24 families (`ai.request_lifecycle`, `ai.output_lifecycle`, `ai.governance_lifecycle`) · **new families: 0** |
| Outboxes | 1 (m06) · m28 owns **none** |
| HTTP routes | 14 total — 6 mutating (`@Endpoint` permission+audit) + 8 reads; **0 business-mutation routes** |

## Tests (all green locally)

| Suite | Assertions |
|-------|-----------|
| `m28-executive-ai` smoke (pure) | 83 |
| `m28-executive-ai` DB spec (schema/governance) | 32 |
| `m28-services` DB spec (end-to-end via M24) | 25 |
| `api-copilot` DB spec (HTTP) | 24 |
| **Full smoke lane** | 33 suites, **5824** assertions, 0 failures |
| **Full DB/API lane** (fresh PostgreSQL replay) | 69 specs, **2167** assertions, 0 failures |
| format:check | pass |
| lint | 0 errors (68 pre-existing baseline warnings; m28 adds none) |
| migrate dry-run (ordering + checksums) | pass (m28 ordered after m27) |

## Behaviour verdicts

| Aspect | Verdict |
|--------|---------|
| Read-only enforcement (5 layers) | PASS — gate + injection screen + service authz + no-mutation API + DB CHECK/grants |
| M24 boundary (BY CONTRACT) | PASS — opaque ids only; no provider/DLP/routing duplication; never auto-approves M24 output |
| M32 deferred read-only port | PASS — fixture double + fail-closed unavailable port; m32 not built |
| Cited answers | PASS — completed ⇒ citation (`copilot_response_cited_ck`); else `review_required`; no fabricated citation |
| Row/RLS masking | PASS — tenant ∧ scope ∧ sensitivity ∧ entitlement intersection; masked evidence dropped |
| Cross-domain entitlement intersection | PASS — unentitled caller ⇒ 0 sources ⇒ review_required (no leakage) |
| Prompt-injection defence | PASS — jailbreak/exfiltration/fabrication refused; server-side authz never overridden |
| Confidence | PASS — integer basis points, bounded; below floor ⇒ review_required |
| Human review | PASS — AI never approves/posts; the reading executive is the human decider; export gated on complete |
| Idempotency / concurrency | PASS — replayed key ⇒ same query; optimistic version on every transition |
| Privacy (audit/events) | PASS — no question/answer/secret in any audit entry; content behind M09 refs |

## Boundary & contamination verdict: **CLEAN**

No M24 duplication · no M32 implementation · no M29 · no production provider · no network · no business-domain mutation ·
no posting/approval/payment/reconciliation · no case/legal mutation · no new event family · no second outbox · no
historical migration edit · no permission bypass.

## Known limitations

- Cross-domain and analytics evidence is served by **deterministic fixture doubles** (no production integrations). The
  real m19/m12/m13/m14/m09 read adapters and the real **m32** analytics drop in behind their read-only ports unchanged;
  M32 remains a **deferred production dependency**.
- Generation uses M24's **deterministic offline provider double** (no real model, no network) — the honest status.
- The MVP surfaces an executive summary/answer panel over the existing dashboards; deeper narrative composition and
  additional intent classes can extend the controlled vocabulary without schema change.
