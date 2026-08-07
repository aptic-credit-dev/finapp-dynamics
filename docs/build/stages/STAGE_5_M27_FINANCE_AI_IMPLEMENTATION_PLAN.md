# Stage 5 — M27 Finance AI — Implementation Plan

Reviewable units (all landed on `feature/stage-5-m27-finance-ai`):

1. **Architecture / ADRs / readiness** — ADR-109, ADR-110; architecture, readiness, implementation-plan docs.
2. **Migrations / domain** — `0001_finance_ai.sql` (12 tables, RLS FORCE, no-autopost/no-automatch/explainability CHECKs, permission seeds), `0002_grant_application_role.sql` (no DELETE; append-only INSERT+SELECT); pure `domain.ts` (vocabularies, state machines, `evaluateReviewGate`, money/confidence guards).
3. **Services & the M24/M15/M20 ports** — `gateway.ts` (`AiGatewayPort`/`M24AiGateway`), `repository.ts`, `config/analysis/suggestion/review/evidence` services, `emit.ts` (audit only).
4. **Tests** — `m27-finance-ai.smoke.ts`, `m27-finance-ai.db-spec.ts`, `m27-services.db-spec.ts`.
5. **Permissions / audit / manifest** — permission-registry (`ai.*` +5), audit-code-registry (13 `AI_FINANCE_*`, count 732), module-registry + implementation-manifest status → implemented, root tsconfig ref.
6. **Completion documentation** — README + completion report.

## Quality gates (run sequentially, all green)
format → lint → build → smoke → conformance → migration replay → fresh PostgreSQL DB spec → services DB spec → complete DB/API lane → RLS/grants/permission/audit checks → explainability/no-autopost/no-automatch/money-safety/idempotency/concurrency/privacy tests → contamination scan.
