# Stage 5 — M26 Legal AI — Implementation Plan

Reviewable units (all landed on `feature/stage-5-m26-legal-ai`):

1. **Architecture / ADRs / readiness** — ADR-107, ADR-108; architecture, readiness, implementation-plan docs.
2. **Migrations / domain** — `0001_legal_ai.sql` (11 tables, RLS FORCE, CHECKs, permission seeds), `0002_grant_application_role.sql` (no DELETE; append-only INSERT+SELECT); pure `domain.ts` (vocabularies, state machines, `evaluateReviewGate`/`evaluateEthicalWall`).
3. **Services & the M24/M14 ports** — `gateway.ts` (`AiGatewayPort`/`M24AiGateway`), `repository.ts`, `config/analysis/evidence/review/suggestion` services, `emit.ts` (audit only).
4. **Tests** — `m26-legal-ai.smoke.ts`, `m26-legal-ai.db-spec.ts`, `m26-services.db-spec.ts`.
5. **Permissions / audit / manifest** — permission-registry (`ai.*` +6), audit-code-registry (14 `AI_LEGAL_*`, count 719), module-registry + implementation-manifest status → implemented, root tsconfig ref.
6. **Completion documentation** — README + completion report.

## Quality gates (run sequentially, all green)
format → lint → build → smoke → conformance → migration replay → fresh PostgreSQL DB spec → services DB spec → complete DB/API lane → RLS/grants/permission/audit checks → ethical-wall/citation/human-review/idempotency/concurrency/privacy tests → no-autonomous-legal-action + contamination scan.
