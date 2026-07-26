# m07-rules — Versioned explainable decision-rules engine

**Stage 2.3.** The generic enterprise decision-rules engine: authored, versioned, immutable-after-publish rule
sets delivering **deterministic, explainable** decisions via decision tables + structured typed conditions.
Reusable by Feedback, Cases, Finance, Credit, Pricing, Fraud, Reconciliation.

See `docs/build/stages/STAGE_2_3_M07_RULES_*.md` and ADR-032…037.

## Reuses (never duplicates)
`DB` / `AUTHZ` (RbacAuthz) / `AUDIT` (m03 AuditService) via kernel tokens; **`OUTBOX` = the one durable
WorkflowOutbox m06 owns** (m07 publishes through it, never a second outbox). m07 does NOT import m06 internals.

## Safety (ADR-033)
Conditions are STRUCTURED typed JSON — never free-text — so there is no host-code interpreter to attack:
no eval/Function/vm/require/SQL/shell/filesystem/network/reflection. Money is decimal-safe (BigInt, no float).
Deterministic: no clock/random/env; "now" comes from `context.evaluatedAt`. Hard limits fail closed.

## Layout
- `src/domain/` — PURE: decimal, conditions, decision-table (FIRST/UNIQUE/COLLECT/PRIORITY), lifecycles,
  ruleset (+ RULE_LIMITS), validator, evaluate (+ structured Explanation, inputHash). No I/O; unit-tested.
- `src/repository.ts` · `src/*.service.ts` · `src/emit.ts` — persistence + tenant-tx services (audit+outbox).
- `migrations/` — 5 tables (RLS FORCE, append-only evidence, permission seed).
- `test/` — PURE smoke + DB integration spec (`DATABASE_APP_ROLE=finapp_app`).
