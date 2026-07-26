# Stage 2.3 — M07 Versioned Explainable Rules Engine — Architecture

**Status:** Implementation architecture (on the feature branch, part of the implementation PR).
**Date:** 2026-07-24 · **Module:** `m07-rules` · **Baseline:** certified main `130c284` (Stage 2.2 m06 merged+certified via PR #12/#13).

## 1. Purpose & ownership

m07 is the **generic enterprise decision-rules engine**: authored, versioned, immutable-after-publish rule
sets that deliver **deterministic, explainable** decisions via **decision tables** and structured conditions,
reusable by Feedback, Cases, Finance, Credit, Pricing, Fraud, and Reconciliation.

**Owns:** rule-set authoring/versioning/validation/immutable-publish/activate/retire; deterministic explainable
evaluation; decision tables; ordered rules; priority/salience; match/hit policies; input/output/context schema
validation; execution traces; reason codes; decision outcomes; rule test cases + simulation; safe (structured)
expression evaluation; evaluation idempotency + replay; persistent evaluation evidence; rule lifecycle audit +
events; tenant isolation; platform-vs-tenant scope (explicit).

**Does not own:** workflow orchestration (m06); approval-matrix administration (m22); notifications (m08);
documents (m09); feedback (m12); cases (m13); ACIS lending/pricing; accounting/journal/reconciliation; AI
inference; autonomous policy creation; **arbitrary script execution; external network; DB queries embedded in
rules**.

## 2. Reused contracts (not duplicated)

`DB` (withTenant/withSystem + Tx), `AUTHZ` (RbacAuthz, default-deny, server-resolved), `AUDIT` (m03
AuditService — same-tx `write`), **`OUTBOX` (the one durable WorkflowOutbox m06 owns — m07 publishes through
it, never a second outbox)**, `RequestContext`/`SystemContext`, `ProblemError` (RFC 9457), `@Endpoint`
(3-segment permission + registered `RULES_` audit). m07 does **not** import m06 internals; the expression model
is m07's own (ADR-033), not m06's float interpreter.

## 3. Determinism & safety (ADR-033)

Conditions are **structured typed JSON** (discriminated union), not free-text — so there is **no host-code
interpreter to attack**: no `eval`/`Function`/`vm`/`require`/dynamic-import/SQL/shell/filesystem/network/
reflection/prototype/constructor. Money/precision comparisons are **decimal-safe** (BigInt-scaled, no float).
No wall-clock/random/env/fs; any "now" comes from `context.evaluatedAt`; key iteration normalized. Identical
(spec, normalized input, context, engine version) ⇒ identical outcome/matches/reason-codes/outputs/trace order.
Hard limits (rules/rows/depth/nodes/string/collection/input-depth/output-size/instruction-budget) fail closed.

## 4. Domain model

- **Rule-set spec** (immutable JSON on the version, ADR-032): `{schemaVersion, code, name, inputSchema[],
  outputSchema[], contextSchema?[], decisionTables[], derived?[]}`. Field schemas carry type
  (string/number/decimal/boolean/date/enum), required, enum, maxLength, scale.
- **Condition** (structured AST): `compare` (eq/ne/lt/le/gt/ge, decimal-safe), `in`, `range`, `present`/
  `absent`, `string` (equals/startsWith/endsWith/contains, normalize), `date`, `and`/`or`/`not`.
- **Decision table**: `{id, name, inputFields, outputFields, hitPolicy, rows[], aggregate?}`. Row: `{id,
  priority?, enabled?, when: Condition, outputs, reasonCode, effectiveFrom?, effectiveTo?}`.
- **Hit policies** (ADR-034): FIRST / UNIQUE (violation on >1) / COLLECT (+decimal-safe aggregate) / PRIORITY.
- **Derived fields**: allow-listed ops (add/subtract/multiply/percent/concat/lower/upper/coalesce), decimal-
  safe, cycle-rejected at validate.
- **Explanation**: `{engineVersion, ruleSetCode, outcome, outputs, matchedRuleIds, reasonCodes, tableTraces,
  derivedValues, warnings}` — machine-readable reason codes mandatory.

## 5. Lifecycle (ADR-032)

`DRAFT → VALIDATED → PUBLISHED → ACTIVE → RETIRED (→ ARCHIVED)`. Drafts mutable; validate stores evidence; only
valid versions publish; **published versions immutable** (frozen `spec` + content_hash); activate selects one
eligible published version (one ACTIVE per rule-set); retire stops new evaluations but keeps history; a change
is a new version; **historical evaluations stay tied to their exact version**; publish and activate need
distinct permissions; maker-checker/no-self-approval where configured; m22 approval-policy deferred.

## 6. Database (ADR-032/035/037)

5 tables, tenant-scoped composite `(tenant_id, id)` PKs + composite FKs, RLS ENABLE+FORCE + `tenant_isolation`,
optimistic `version`, no DELETE grants:
- `rule_set` — logical set (code unique per tenant, status, version). Mixed-scope form supports global rules
  (nullable tenant_id + system escape) under `rules.platform.administer` (ADR-037).
- `rule_set_version` — immutable `spec` jsonb + `content_hash` + `validation` jsonb; one ACTIVE per set
  (partial unique index); status DRAFT..ARCHIVED.
- `rule_evaluation` — **append-only** evidence: `input_hash`/`context_hash` (not raw inputs, ADR-035), outcome,
  outputs jsonb, reason_codes text[], trace jsonb, subject ref, correlation/causation, duration, status,
  error_code, `idempotency_key` (UNIQUE per set) + a `simulation` flag separating simulation from real.
- `rule_test_case` — mutable test cases (input/context/expected).
- `rule_set_history` — append-only status history.

## 7. Permissions (13, seeded) & audit (17 `RULES_`)

Permissions: `rules.engine.{view,author,validate,publish,activate,retire,evaluate,simulate,test}`,
`rules.evaluation.{view,replay,export}`, `rules.platform.administer` — three-segment, registered **and seeded**
into the `permissions` catalogue (role_permissions FK). Default-deny, server-side, header cannot grant, authz
re-evaluated at execution, publish≠activate actors where configured, SystemContext not universal.
Audit codes: `RULES_SET_*`, `RULES_VERSION_*`, `RULES_EVALUATION_*`, `RULES_SIMULATION_EXECUTED`, `RULES_TEST_*`,
`RULES_EXPORT_REQUESTED`, `RULES_PLATFORM_CONFIGURED` — via m03 AuditService (no second audit store).

## 8. Events & outbox

`rules.lifecycle` family (9 types), payload v1, **hashes/ids only (never raw inputs)**, published through the
**single m06 WorkflowOutbox** in the same transaction as state (ADR-004/023). No direct m08 call.

## 9. Evaluation, idempotency, replay (ADR-035)

`evaluate` validates + normalizes input against inputSchema, computes derived fields, runs decision tables in
declared order, validates output, persists append-only evidence. **Idempotency:** same (tenant, version,
idempotency_key) returns the prior result; a conflicting payload with the same key → stable `RULE_IDEMPOTENCY_
CONFLICT`. **Replay** re-runs the **original version** (never silently the active one), never mutates the
original record, and reports whether the result matches. `evaluatedAt` comes from context (historical replay
uses the original instant).

## 10. API (`/api/v1/rules`, GAP-2 resolved)

Rule sets: create/view/list/update-draft/create-version/view-version/validate/publish/activate/retire/history.
Evaluation: execute/view/search/replay/export. Simulation+testing: simulate/test-case CRUD/execute/suite.
Every mutating route `@Endpoint`-declared + service-enforced. Stable RFC-9457 errors: `RULE_SET_NOT_FOUND`,
`RULE_VERSION_NOT_FOUND`, `RULE_VERSION_NOT_DRAFT`, `RULE_VERSION_INVALID`, `RULE_VERSION_IMMUTABLE`,
`RULE_VERSION_NOT_PUBLISHED`, `RULE_SET_NOT_ACTIVE`, `RULE_ACTIVATION_CONFLICT`, `RULE_INPUT_INVALID`,
`RULE_OUTPUT_INVALID`, `RULE_EXPRESSION_UNSAFE`, `RULE_LIMIT_EXCEEDED`, `RULE_UNIQUE_MATCH_VIOLATION`,
`RULE_NO_MATCH`, `RULE_EVALUATION_FAILED`, `RULE_IDEMPOTENCY_CONFLICT`, `RULE_REPLAY_VERSION_UNAVAILABLE`,
`RULE_TENANT_MISMATCH` (404, non-leaking), `RULE_FORBIDDEN`, `RULE_STALE_VERSION`. Tenant mismatch → 404.

## 11. m06 integration (ADR-036)

A stable contract lets m06 evaluate a pinned/active version, branch on outcome, store `evaluationId` + reason
codes, and raise an incident on engine failure — no circular dependency, atomic evidence, fail-closed, idempotent.
Minimal in this stage (the m06↔m07 wiring lands when a business module needs it).

## 12. Deferred

Full-input classified/redacted capture; global-rule override/admin surface (ADR-037 minimal); score-model
tuning UIs; m22 approval administration; a standing evaluation dispatcher/worker; advanced simulation/what-if.
Never: arbitrary scripting, external calls, autonomous policy creation.
