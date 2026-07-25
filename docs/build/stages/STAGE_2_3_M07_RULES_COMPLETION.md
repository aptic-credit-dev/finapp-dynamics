# Stage 2.3 — M07 Versioned Explainable Rules Engine — Completion Report

**Module:** `m07-rules` · **Branch:** `feature/stage-2-3-m07-rules` · **Baseline:** certified Stage 2.2 main
`130c28447a8e6f548b2f3048fdb9a0504470a2cd` (PR #13). **Status:** implemented on branch; implementation PR open,
CI green, **not merged** (awaiting review + certification).

## What was built

The generic enterprise **decision-rules engine**: authored, versioned, immutable-after-publish rule sets that
deliver **deterministic, explainable** decisions through decision tables and structured typed conditions.
Reusable by Feedback, Cases, Finance, Credit, Pricing, Fraud and Reconciliation without any of them embedding
rule logic.

### Layers

- **PURE domain** (`src/domain/`, no I/O, 156 unit assertions): decimal-safe numerics (BigInt, no float);
  structured typed condition AST (compare/in/range/present/absent/string/date/and/or/not); decision tables with
  four hit policies (FIRST / UNIQUE / COLLECT+aggregate / PRIORITY); the rule-set-version lifecycle
  (DRAFT→VALIDATED→PUBLISHED→ACTIVE→RETIRED→ARCHIVED, frozen at PUBLISHED); the fail-closed definition
  validator; and the evaluation engine producing a structured `Explanation` (outputs, matched ids, machine
  reason codes, traces) plus a canonical SHA-256 input hash.
- **Persistence** (`0001_rules.sql`, five tables, all RLS ENABLE+FORCE + `tenant_isolation`, composite
  `(tenant_id,id)` keys and composite FKs): `rule_set`, `rule_set_version` (immutable `spec` jsonb, `content_hash`
  frozen at publish, partial unique index = one ACTIVE per set), `rule_evaluation` (append-only evidence:
  input hash + redacted outcome, idempotency unique index), `rule_test_case`, `rule_set_history` (append-only).
  `0002_grant_application_role.sql`: NO DELETE anywhere; evidence + history INSERT+SELECT only.
- **Services** (permissioned, transactional): `RuleSetService` (authoring/versioning/lifecycle through the PURE
  transition checker; publish freezes content; optimistic-lock guarded; append-only history), `EvaluationService`
  (deterministic evaluation of the ACTIVE version; append-only evidence; idempotent per key; hash-verified
  non-mutating replay; dry-run simulate; audited export), `TestService` (stored synthetic tests that actually
  assert). One `M07Emitter` writes audit (m03) + events on the **one outbox m06 owns**, in the business tx.
- **API** (`/api/v1/rules`): rule-set authoring + lifecycle, evaluate/replay/simulate/export, and tests. Every
  mutating route is an audited `@Endpoint` with a permission enforced server-side (default deny).

## Governance honoured

| Guarantee | How |
|---|---|
| Tenant isolation | RLS ENABLE+FORCE + `tenant_isolation` on all five tables; asserted through the non-owner app role. |
| Authorization | Default-deny; every mutation `authz.require`s its 3-segment permission in the service; a header cannot grant authority (proven). |
| Determinism | Structured typed conditions, no clock/random/env; "now" comes from `context.evaluatedAt`; no eval/Function/vm (ADR-033). |
| Explainability | Structured `Explanation` + machine reason codes returned; redacted version persisted as evidence. |
| Version immutability | Published `spec` never updated; `content_hash` frozen; a change is a new version (ADR-032). |
| Decimal-safe money | BigInt-backed decimal; float rejected (`add("0.10","0.20")="0.30"`). |
| Sensitive-data minimisation | Evidence + events carry the input HASH and redacted outcome, never raw inputs (ADR-035). |
| Idempotency + replay | Partial unique index de-dupes governed evaluations; replay re-runs the original immutable version and verifies the re-supplied input's hash. |
| Transaction integrity | State + audit + outbox commit atomically; stale writes 409 via optimistic lock. |
| Single outbox | m07 owns no outbox; publishes `rules.lifecycle` through m06's WorkflowOutbox (ADR-004/036). |

## Registries + docs

- Permissions: 13 `rules.*` codes (publish/activate/retire + `rules.platform.administer` privileged; no vague
  `rules.admin`) — registered and seeded by the migration.
- Audit codes: 17 `RULES_*` codes registered (`registered_code_count` bumped to 119).
- Events: `rules.lifecycle` family registered; added to the contracts `DomainEvent` union (6 families).
- ADRs: ADR-032 (immutable spec JSON), ADR-033 (safe structured execution), ADR-034 (hit policies), ADR-035
  (evidence + input-hash minimisation), ADR-036 (m06 integration), ADR-037 (platform-vs-tenant scope).

## Verification (authoritative gate)

- Build: `tsc --build` clean. Lint: 0 errors. Format: clean.
- Smoke lane: **13 suites, 1869 assertions, 0 failed** — including `m07-rules` (156) and `conformance` (602,
  which validates every `@Endpoint` permission + audit code against the registries and the RLS convention over
  the new migrations).
- DB lane (real PostgreSQL, non-owner `finapp_app` role so RLS is enforced): **16 specs, 473 assertions, 0
  failed** — `m07-rules` (22), `m07-services` (25), `api-rules` (18), and the whole prior baseline still green.

## Scope discipline

Only `m07-rules` was built. No m08/m09/m12/m13/m15/m19/m22 work. No shared platform service was duplicated; no
architecture, RLS, authorization, audit, determinism, explainability, immutability, or test guarantee was
weakened. The implementation PR is open and green; it is **not merged**.
