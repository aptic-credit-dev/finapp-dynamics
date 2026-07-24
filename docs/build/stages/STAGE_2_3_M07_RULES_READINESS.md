# Stage 2.3 — M07 Rules Engine — Readiness

**Date:** 2026-07-24 · **Baseline:** certified main `130c284` (Stage 2.2 m06 merged PR #12 + certified PR #13).

## Baseline
- Stage 2.2 m06 merged+certified; m06 owns the durable OUTBOX; `AUDIT→AuditService`, `AUTHZ→RbacAuthz`.
- m07-rules README-only before this stage; m08/m09/m12/m13/m15/m19/m22 README-only (and not touched here).
- Reserved axes: perms `rules.*`, audit `RULES_`; **GAP-2 resolved this stage** — API `/api/v1/rules`, event
  family `rules.lifecycle` registered.

## Dependency map
kernel (DB/AUDIT/AUTHZ/OUTBOX/ProblemError/@Endpoint) · m01 (tenant context/org) · m02 (RbacAuthz + permission
catalogue/seed) · m03 (AuditService) · **m06 (the one OUTBOX; a stable rules-integration contract — no circular
dep)**. m07 provides: the rules engine + a public evaluation contract for later modules.

## Pre-build decisions (resolved)
- **Rule storage (ADR-032):** immutable validated `spec` JSON on `rule_set_version` (Option A) — deterministic
  checksums, trivial replay, strong validation.
- **Safe execution (ADR-033):** structured typed conditions (no free-text host-code), decimal-safe — eliminates
  injection by construction; m07 does not import m06's float interpreter.
- **Hit policies (ADR-034):** FIRST/UNIQUE/COLLECT/PRIORITY.
- **Evidence (ADR-035):** input HASH, not raw sensitive inputs; append-only.
- **m06 integration (ADR-036):** stable contract, minimal in this stage.
- **Scope (ADR-037):** tenant-scoped default; explicit global scope, minimal admin surface.

## Risks
| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | Determinism drift (float, key order, clock) | decimal core (BigInt), normalized keys, evaluatedAt-from-context, replay tests |
| R2 | Injection via rules | structured conditions (no interpreter); allow-listed ops; abuse tests |
| R3 | Sensitive-data hoarding in append-only evidence | store input hash, redaction; ADR-035 |
| R4 | m06↔m07 circular dependency | stable contract; m07 does not import m06 |
| R5 | Global-scope ambiguity | explicit resolution, no implicit fallback (ADR-037) |
| R6 | Local PG 15.2 vs CI PG16 | CI PG16 authoritative |

## Verdict: **GO**
Architecture grounded in the real repository contracts; no material blocker. Build proceeds on this branch per
the implementation plan; the implementation PR (not a planning PR) carries these docs.
