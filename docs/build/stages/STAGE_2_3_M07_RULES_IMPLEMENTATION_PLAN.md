# Stage 2.3 — M07 Rules Engine — Implementation Plan

**Baseline:** certified main `130c284`. **Branch:** `feature/stage-2-3-m07-rules`.

## Package skeleton (mirror m06)
```
packages/m07-rules/
  package.json  # exports source->types->default; files [dist,migrations]; deps contracts/kernel/m01/m02/m03; dev test-runner
  tsconfig.json # references kernel,contracts,m01-tenant,m02-identity,m02-rbac,tools/test-runner
  src/
    permissions.ts (13) · audit-codes.ts (17) · errors.ts (RuleError + RFC-9457 helpers)
    domain/ (PURE): decimal, conditions, decision-table, lifecycles, ruleset, validator, evaluate
    repository.ts · emit.ts (M07Emitter over AUDIT+OUTBOX)
    ruleset.service.ts (authoring/lifecycle) · evaluation.service.ts (evaluate/replay/idempotency) ·
    test.service.ts (test-case CRUD + run + simulate)
    index.ts · README.md
  migrations/ 0001_rules.sql (5 tables, RLS FORCE, +permission seed) · 0002_grant_application_role.sql
apps/api/src/rules/ (controllers + rules.module) ; packages/contracts/src/rules-events.ts (done)
```

## Commit sequence (focused, gated)
1. **Commit 1** (this): finalize Stage 2.2 cert; planning docs; ADR-032..037; registries (perms/audit/events);
   naming-map GAP-2; contracts rules-events + union; manifest m07 prep. *(no engine code)*
2. **Commit 2**: package skeleton + PURE domain (decimal, conditions, decision-table, lifecycles, ruleset,
   validator, evaluate) + PURE smoke. *(the deterministic safe engine)*
3. **Commit 3**: migrations (5 tables, RLS/FORCE/grants, permission seed) + repository + DB spec (RLS,
   append-only, optimistic lock, idempotency).
4. **Commit 4**: services (authoring/lifecycle, evaluation+replay+idempotency, test/simulate) + M07Emitter
   (audit + outbox) + services DB spec (default-deny, maker-checker, immutability, evidence).
5. **Commit 5**: API `/api/v1/rules` + platform wiring + api-rules HTTP spec (authz, tenant-isolation,
   stable errors, no-header-authority).
6. **Commit 6**: completion report + manifest update.
7. **Commit 7**: formatting-only if needed.

## Gating
Targeted per layer (build + relevant suite). Full authoritative set (format/lint/build/smoke/conformance/
migrations/fresh-apply/DB/API/security-negative) before push. `DATABASE_APP_ROLE=finapp_app` (never superuser).

## Acceleration
PURE engine (Workstream A) drafted by a reviewed agent; migration+repo (B) and API+tests (D) parallel after
the domain contract stabilizes; separate files, reviewed before integration; main branch authoritative.

## Acceptance
Deterministic evaluation; immutable published versions; tenant isolation (RLS FORCE); default-deny server-side;
decimal-safe; structured explanations + machine reason codes; append-only evidence (input hash, no raw
sensitive); idempotency + replay (original version, no mutation); atomic state+audit+outbox; no eval/injection;
all PURE/DB/API/security-negative tests + CI Smoke+DB (PG16) green.
